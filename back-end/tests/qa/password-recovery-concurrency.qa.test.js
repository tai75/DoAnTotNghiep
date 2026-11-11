import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import qaDatabase from '../../scripts/qa01-db.cjs'
import passwordRecovery from '../../src/services/passwordRecovery.service.js'

const enabled = process.env.RUN_PASSWORD_RECOVERY_QA_TESTS === '1'
const { assertQaDatabase } = qaDatabase
const {
  consumePasswordResetToken,
  hashResetToken,
  requestPasswordReset,
} = passwordRecovery

describe.skipIf(!enabled)('QA MySQL password recovery concurrency', () => {
  let prisma
  let user
  let syntheticEmail

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    await assertQaDatabase(prisma)
    syntheticEmail = `qa-password-recovery-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
    user = await prisma.user.create({
      data: {
        email: syntheticEmail,
        passwordHash: 'qa-password-recovery-initial-hash',
        fullName: 'QA Password Recovery',
        role: 'CANDIDATE',
      },
    })
  }, 30_000)

  afterAll(async () => {
    if (!prisma) return
    if (user) await prisma.user.deleteMany({ where: { id: user.id, email: syntheticEmail } })
    expect(await prisma.user.count({ where: { email: { startsWith: 'qa-password-recovery-' } } })).toBe(0)
    await assertQaDatabase(prisma)
    await prisma.$disconnect()
  }, 30_000)

  it('serializes issuance, enforces cooldown, hashes storage, and consumes once atomically', async () => {
    let tokenSequence = 0
    const delivered = []
    const sendResetLinkImpl = vi.fn(async (email, rawToken) => { delivered.push({ email, rawToken }) })
    const dependencies = {
      client: prisma,
      floorMs: 0,
      jitterMs: 0,
      waitImpl: async () => {},
      randomBytesImpl: () => Buffer.alloc(32, ++tokenSequence),
      sendResetLinkImpl,
    }

    const results = await Promise.all(Array.from({ length: 12 }, () => requestPasswordReset(syntheticEmail, dependencies)))
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1)
    await vi.waitFor(() => expect(sendResetLinkImpl).toHaveBeenCalledTimes(1))

    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).toBe(hashResetToken(delivered[0].rawToken))
    expect(JSON.stringify(rows)).not.toContain(delivered[0].rawToken)
    expect(delivered[0].email).toBe(syntheticEmail)

    await requestPasswordReset(syntheticEmail, dependencies)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sendResetLinkImpl).toHaveBeenCalledTimes(1)
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1)

    const refresh = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(`qa-refresh-${Date.now()}-${user.id}`),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const consumeResults = await Promise.allSettled([
      consumePasswordResetToken(delivered[0].rawToken, 'NewPassword123!', prisma, { hashPasswordImpl: async () => 'qa-password-recovery-new-hash' }),
      consumePasswordResetToken(delivered[0].rawToken, 'NewPassword123!', prisma, { hashPasswordImpl: async () => 'qa-password-recovery-new-hash' }),
    ])
    expect(consumeResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(consumeResults.filter((result) => result.status === 'rejected' && result.reason?.statusCode === 400)).toHaveLength(1)

    const [consumedToken, changedUser, revokedRefresh] = await Promise.all([
      prisma.passwordResetToken.findUnique({ where: { id: rows[0].id } }),
      prisma.user.findUnique({ where: { id: user.id } }),
      prisma.refreshToken.findUnique({ where: { id: refresh.id } }),
    ])
    expect(consumedToken.usedAt).not.toBeNull()
    expect(changedUser.passwordHash).toBe('qa-password-recovery-new-hash')
    expect(changedUser.tokenVersion).toBe(1)
    expect(revokedRefresh.revokedAt).not.toBeNull()
    await expect(consumePasswordResetToken(delivered[0].rawToken, 'AnotherPassword123!', prisma, {
      hashPasswordImpl: async () => 'must-not-be-used',
    })).rejects.toMatchObject({ statusCode: 400 })
  }, 30_000)

  it('rolls back token claim, password change, version increment, and session revocation together', async () => {
    const rawToken = `qa-rollback-${Date.now()}-${user.id}`
    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const refresh = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(`qa-rollback-refresh-${Date.now()}-${user.id}`),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const before = await prisma.user.findUnique({ where: { id: user.id } })
    const rollbackClient = {
      passwordResetToken: prisma.passwordResetToken,
      $transaction: (work, options) => prisma.$transaction(async (transaction) => {
        await work(transaction)
        throw Object.assign(new Error('synthetic reset rollback'), { code: 'P2034' })
      }, options),
    }

    await expect(consumePasswordResetToken(rawToken, 'RollbackPassword123!', rollbackClient, {
      hashPasswordImpl: async () => 'qa-password-recovery-rollback-hash',
    })).rejects.toMatchObject({ code: 'P2034' })

    const [storedToken, storedUser, storedRefresh] = await Promise.all([
      prisma.passwordResetToken.findUnique({ where: { id: resetToken.id } }),
      prisma.user.findUnique({ where: { id: user.id } }),
      prisma.refreshToken.findUnique({ where: { id: refresh.id } }),
    ])
    expect(storedToken.usedAt).toBeNull()
    expect(storedUser.passwordHash).toBe(before.passwordHash)
    expect(storedUser.tokenVersion).toBe(before.tokenVersion)
    expect(storedRefresh.revokedAt).toBeNull()
  })

  it('rejects an expired token without changing account state', async () => {
    const rawToken = `qa-expired-${Date.now()}-${user.id}`
    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() - 1_000),
      },
    })
    const before = await prisma.user.findUnique({ where: { id: user.id } })
    await expect(consumePasswordResetToken(rawToken, 'ExpiredPassword123!', prisma, {
      hashPasswordImpl: async () => 'must-not-be-used',
    })).rejects.toMatchObject({ statusCode: 400 })
    expect((await prisma.passwordResetToken.findUnique({ where: { id: resetToken.id } })).usedAt).toBeNull()
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      passwordHash: before.passwordHash,
      tokenVersion: before.tokenVersion,
    })
  })
})
