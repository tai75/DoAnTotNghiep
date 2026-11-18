import jwt from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/not_used'
process.env.JWT_SECRET = 'auth-session-unit-test-secret'
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d'

const authRoutesModule = await import('../../src/routes/auth.routes.js')
const authRoutes = authRoutesModule.default || authRoutesModule
const authMiddlewareModule = await import('../../src/middleware/auth.js')
const { accessSessionUser } = authMiddlewareModule.default || authMiddlewareModule

const future = () => new Date(Date.now() + 60_000)
const user = { id: 7, role: 'CANDIDATE', status: 'ACTIVE', tokenVersion: 3 }

function storedToken(sessionId = 'session-a', overrides = {}) {
  return {
    id: 1,
    userId: user.id,
    sessionId,
    tokenHash: 'hash',
    revokedAt: null,
    expiresAt: future(),
    user,
    session: { id: sessionId, userId: user.id, revokedAt: null, expiresAt: future() },
    ...overrides
  }
}

function transactionDatabase(stored, { claimCount = 1, sessionCount = 1 } = {}) {
  const transaction = {
    refreshToken: {
      findUnique: vi.fn().mockResolvedValue(stored),
      updateMany: vi.fn().mockResolvedValue({ count: claimCount }),
      create: vi.fn().mockResolvedValue({ id: 2 })
    },
    authSession: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: sessionCount })
    }
  }
  return {
    transaction,
    database: { $transaction: vi.fn((work) => work(transaction)) }
  }
}

describe('per-session authentication', () => {
  it('retries only retryable serializable transaction conflicts', async () => {
    const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' })
    const work = vi.fn()
    const database = { $transaction: vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ status: 'ok' }) }
    await expect(authRoutes.runSerializable(database, work)).resolves.toEqual({ status: 'ok' })
    expect(database.$transaction).toHaveBeenCalledTimes(2)

    const fatal = Object.assign(new Error('fatal'), { code: 'P2002' })
    const fatalDatabase = { $transaction: vi.fn().mockRejectedValue(fatal) }
    await expect(authRoutes.runSerializable(fatalDatabase, work)).rejects.toBe(fatal)
    expect(fatalDatabase.$transaction).toHaveBeenCalledOnce()
  })

  it('SESSION-01/02 revokes only the presented session and remains idempotent', async () => {
    const { database, transaction } = transactionDatabase(storedToken())
    await expect(authRoutes.revokeRefreshSession('token-a', database)).resolves.toMatchObject({ status: 'revoked' })
    await expect(authRoutes.revokeRefreshSession('token-a', database)).resolves.toMatchObject({ status: 'revoked' })

    expect(transaction.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-a', userId: 7, revokedAt: null }
    }))
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: 'session-a', revokedAt: null }
    }))
    expect(transaction.refreshToken.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 7 })
    }))
  })

  it('SESSION-03 keeps the stable session id during refresh rotation', async () => {
    const { database, transaction } = transactionDatabase(storedToken())
    const result = await authRoutes.rotateRefreshToken('token-a', database)
    expect(result).toMatchObject({ status: 'ok', sessionId: 'session-a' })
    expect(transaction.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 7, sessionId: 'session-a' })
    })
  })

  it('SESSION-04 scopes replay revocation to one session', async () => {
    const { database, transaction } = transactionDatabase(storedToken('session-a', { revokedAt: new Date() }))
    await expect(authRoutes.rotateRefreshToken('old-token-a', database)).resolves.toMatchObject({ status: 'replay' })
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-a', userId: 7, revokedAt: null }
    }))
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: 'session-a', revokedAt: null }
    }))
  })

  it('SESSION-05 cannot create a successor after logout wins the session claim', async () => {
    const { database, transaction } = transactionDatabase(storedToken(), { sessionCount: 0 })
    await expect(authRoutes.rotateRefreshToken('token-a', database)).resolves.toMatchObject({ status: 'invalid' })
    expect(transaction.refreshToken.create).not.toHaveBeenCalled()
  })

  it('SESSION-07/08 rejects another user session and legacy access tokens', async () => {
    const session = { id: 'session-a', userId: 8, revokedAt: null, expiresAt: future(), user: { ...user, id: 8 } }
    const database = { authSession: { findUnique: vi.fn().mockResolvedValue(session) } }
    await expect(accessSessionUser({ userId: 7, sid: 'session-a', tokenVersion: 3 }, database)).resolves.toBeNull()
    await expect(accessSessionUser({ userId: 7, tokenVersion: 3 }, database)).resolves.toBeNull()
  })

  it('SESSION-08 rejects legacy refresh tokens without a session id', async () => {
    const { database, transaction } = transactionDatabase(storedToken(null, { session: null }))
    await expect(authRoutes.rotateRefreshToken('legacy', database)).resolves.toMatchObject({ status: 'legacy' })
    expect(transaction.refreshToken.create).not.toHaveBeenCalled()
  })

  it('issues access tokens with sid and rejects revoked sessions immediately', async () => {
    const token = authRoutes.createToken(user, 'session-a')
    expect(jwt.decode(token)).toMatchObject({ userId: 7, sid: 'session-a', tokenVersion: 3 })
    const database = {
      authSession: { findUnique: vi.fn().mockResolvedValue({
        id: 'session-a', userId: 7, revokedAt: new Date(), expiresAt: future(), user
      }) }
    }
    await expect(accessSessionUser(jwt.decode(token), database)).resolves.toBeNull()
  })
})
