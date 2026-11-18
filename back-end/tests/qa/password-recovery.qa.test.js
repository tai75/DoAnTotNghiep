import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import appModule from '../../src/app.js'
import e2eDatabase from '../../scripts/e2e-db.cjs'

const enabled = process.env.RUN_E2E_AUTH_TESTS === '1'
const app = appModule.default || appModule
const { assertCanonicalDatabase, resetBusinessData, seed } = e2eDatabase
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

describe.skipIf(!enabled)('QA database password recovery', () => {
  let prisma
  let candidate
  const oldPassword = process.env.E2E_PASSWORD
  const newPassword = 'QA01-New-Password-2026!'

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL })
    globalThis.__JOB_CONNECT_TEST_PRISMA__ = prisma
    await assertCanonicalDatabase(prisma)
    await resetBusinessData(prisma)
    await seed(prisma)
    candidate = await prisma.user.findUnique({ where: { email: 'candidate@jobconnect.local' } })
  }, 30_000)

  afterAll(async () => {
    delete globalThis.__JOB_CONNECT_TEST_PRISMA__
    await prisma?.$disconnect()
  })

  it('returns the same response for existing and unknown accounts without storing the raw token', async () => {
    const existing = await request(app).post('/api/auth/password-reset/request').send({ email: candidate.email })
    const unknown = await request(app).post('/api/auth/password-reset/request').send({ email: 'unknown@jobconnect.local' })
    expect(existing.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(existing.body).toEqual(unknown.body)
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: candidate.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('rejects expired and invalid tokens', async () => {
    const expired = 'qa01-expired-reset-token-1234567890'
    await prisma.passwordResetToken.create({ data: { userId: candidate.id, tokenHash: hashToken(expired), expiresAt: new Date(Date.now() - 1_000) } })
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token: expired, password: newPassword })).status).toBe(400)
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token: 'qa01-invalid-reset-token-1234567890', password: newPassword })).status).toBe(400)
  })

  it('uses a valid token once, changes the password, and revokes the old refresh session', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: candidate.email, password: oldPassword })
    expect(login.status).toBe(200)
    const oldCookie = login.headers['set-cookie']?.[0]?.split(';')[0]
    const rawToken = 'qa01-valid-reset-token-12345678901234567890'
    await prisma.passwordResetToken.create({ data: { userId: candidate.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 60_000) } })

    const confirmed = await request(app).post('/api/auth/password-reset/confirm').send({ token: rawToken, password: newPassword })
    expect(confirmed.status).toBe(200)
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token: rawToken, password: 'ReplayPassword123!' })).status).toBe(400)
    expect((await request(app).post('/api/auth/refresh').set('Cookie', oldCookie)).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ email: candidate.email, password: oldPassword })).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ email: candidate.email, password: newPassword })).status).toBe(200)

    const refreshedCandidate = await prisma.user.findUnique({ where: { id: candidate.id } })
    expect(refreshedCandidate.tokenVersion).toBeGreaterThan(0)
    expect(await prisma.refreshToken.count({ where: { userId: candidate.id, revokedAt: null } })).toBe(1)
    expect((await request(app).post('/api/auth/login').send({ email: 'recruiter@jobconnect.local', password: oldPassword })).status).toBe(200)
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@jobconnect.local', password: oldPassword })).status).toBe(200)
  })
})
