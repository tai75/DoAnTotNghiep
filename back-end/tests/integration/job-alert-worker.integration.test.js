import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'alert-worker-test-secret'
process.env.NODE_ENV = 'test'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.API_PUBLIC_URL = 'http://localhost:5000'

const workerModule = await import('../../src/jobs/alertWorker.js')
const { buildEventKey, classifyEmailError, nextRetryAt } = workerModule.default || workerModule

describe('job alert worker durability helpers', () => {
  it('builds a stable event identity independent of job order', () => {
    expect(buildEventKey(7, [9, 3, 5])).toBe(buildEventKey(7, [5, 9, 3]))
    expect(buildEventKey(7, [3])).not.toBe(buildEventKey(7, [3, 5]))
  })

  it('classifies transient, permanent and unknown email outcomes', () => {
    expect(classifyEmailError({ code: 'EAI_AGAIN' })).toMatchObject({ kind: 'transient' })
    expect(classifyEmailError({ responseCode: 550 })).toMatchObject({ kind: 'permanent' })
    expect(classifyEmailError({ code: 'EMAIL_PROVIDER_REJECTED' })).toMatchObject({ kind: 'permanent' })
    expect(classifyEmailError({ code: 'ETIMEDOUT' })).toMatchObject({ kind: 'unknown' })
  })

  it('uses bounded exponential retry delays', () => {
    const now = new Date('2026-11-05T00:00:00.000Z')
    expect(nextRetryAt(now, 1).getTime() - now.getTime()).toBe(60_000)
    expect(nextRetryAt(now, 3).getTime() - now.getTime()).toBe(240_000)
    expect(nextRetryAt(now, 99).getTime() - now.getTime()).toBe(3_600_000)
  })
})
