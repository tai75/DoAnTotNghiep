import { describe, expect, it, vi } from 'vitest'
const recovery = require('../../src/services/passwordRecovery.service')

function timingClient({ known, advance }) {
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: 7 }]),
    passwordResetToken: {
      findFirst: vi.fn(async () => ({ id: 1 })),
      updateMany: vi.fn(),
      create: vi.fn()
    }
  }
  return {
    user: { findUnique: vi.fn(async () => { advance(known ? 40 : 5); return known ? { id: 7, email: 'known@example.test' } : null }) },
    $transaction: vi.fn(async (work) => work(transaction))
  }
}

describe('password recovery timing and privacy envelope', () => {
  it('gives controlled known and unknown samples the same bounded response distribution', async () => {
    async function samples(known) {
      const durations = []
      for (let index = 0; index < 20; index += 1) {
        let clock = 1_000
        const started = clock
        const dependencies = {
          client: timingClient({ known, advance: (milliseconds) => { clock += milliseconds } }),
          nowImpl: () => clock,
          waitImpl: async (milliseconds) => { clock += milliseconds },
          floorMs: 250,
          jitterMs: 50,
          randomIntImpl: () => index % 51,
          randomBytesImpl: () => Buffer.alloc(32, index + 1),
          sendResetLinkImpl: vi.fn(async () => {})
        }
        await recovery.requestPasswordReset(known ? 'known@example.test' : 'unknown@example.test', dependencies)
        durations.push(clock - started)
      }
      return durations
    }

    const known = await samples(true)
    const unknown = await samples(false)
    expect(known).toEqual(unknown)
    expect(Math.min(...known)).toBeGreaterThanOrEqual(250)
    expect(Math.max(...known)).toBeLessThanOrEqual(300)
  })

  it('keeps a generic response and sanitized logs when issuance fails', async () => {
    const rawBytes = Buffer.alloc(32, 9)
    const rawToken = rawBytes.toString('hex')
    const logger = { error: vi.fn() }
    const client = {
      user: { findUnique: vi.fn(async () => ({ id: 7, email: 'private@example.test' })) },
      $transaction: vi.fn(async () => { throw Object.assign(new Error(`failure ${rawToken} private@example.test`), { code: 'P5000' }) })
    }
    const result = await recovery.requestPasswordReset('private@example.test', {
      client, logger, randomBytesImpl: () => rawBytes,
      floorMs: 0, jitterMs: 0, waitImpl: async () => {}
    })

    expect(result).toEqual(recovery.GENERIC_RESET_RESPONSE)
    expect(logger.error).toHaveBeenCalledWith('[password-reset-issuance]', { name: 'Error', code: 'P5000' })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(rawToken)
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private@example.test')
  })

  it('uses a fragment reset link and never includes the token in the query string', () => {
    const link = new URL(recovery.resetLink('synthetic-reset-token'))
    expect(link.search).toBe('')
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe('synthetic-reset-token')
  })

  it('rechecks expiry at the atomic claim after password hashing', async () => {
    const expiresAt = new Date('2026-11-11T06:00:01.000Z')
    const updateMany = vi.fn(async ({ where }) => ({ count: where.expiresAt.gt < expiresAt ? 1 : 0 }))
    const client = {
      passwordResetToken: {
        findUnique: vi.fn(async () => ({ id: 1, userId: 7, usedAt: null, expiresAt })),
      },
      $transaction: vi.fn(async (work) => work({
        passwordResetToken: { updateMany },
        user: { update: vi.fn() },
        refreshToken: { updateMany: vi.fn() },
        authSession: { updateMany: vi.fn() },
      })),
    }
    const times = [new Date('2026-11-11T06:00:00.900Z'), new Date('2026-11-11T06:00:01.100Z')]

    await expect(recovery.consumePasswordResetToken('synthetic-token', 'NewPassword123!', client, {
      nowImpl: () => times.shift(),
      hashPasswordImpl: async () => 'synthetic-password-hash',
    })).rejects.toMatchObject({ statusCode: 400 })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ expiresAt: { gt: new Date('2026-11-11T06:00:01.100Z') } }),
    }))
  })

  it('SESSION-06 globally revokes refresh tokens and auth sessions after password reset', async () => {
    const now = new Date('2026-11-11T06:00:00.000Z')
    const userUpdate = vi.fn()
    const refreshUpdate = vi.fn()
    const sessionUpdate = vi.fn()
    const client = {
      passwordResetToken: { findUnique: vi.fn(async () => ({ id: 1, userId: 7, usedAt: null, expiresAt: new Date(now.getTime() + 60_000) })) },
      $transaction: vi.fn(async (work) => work({
        passwordResetToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
        user: { update: userUpdate },
        refreshToken: { updateMany: refreshUpdate },
        authSession: { updateMany: sessionUpdate },
      })),
    }

    await recovery.consumePasswordResetToken('synthetic-token', 'NewPassword123!', client, {
      now,
      hashPasswordImpl: async () => 'synthetic-password-hash',
    })

    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) }))
    expect(refreshUpdate).toHaveBeenCalledWith({ where: { userId: 7, revokedAt: null }, data: { revokedAt: now } })
    expect(sessionUpdate).toHaveBeenCalledWith({ where: { userId: 7, revokedAt: null }, data: { revokedAt: now } })
  })
})
