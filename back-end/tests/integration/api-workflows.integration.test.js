import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'integration-test-secret-that-is-not-used-outside-tests'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d'
process.env.GEMINI_API_KEY = ''
const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-upload-test-'))
process.env.UPLOADS_DIRECTORY = uploadDirectory

const database = vi.hoisted(() => {
  const methodNames = ['findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert', 'count']
  const modelNames = [
    'user', 'candidate', 'recruiter', 'company', 'refreshToken', 'passwordResetToken',
    'job', 'jobScreeningQuestion', 'jobView', 'application', 'applicationAnswer',
    'applicationStatusHistory', 'applicationNote', 'matchScore', 'matchScoreV2',
    'embeddingCache', 'notification', 'companyFollow', 'auditLog', 'conversation', 'recommendation',
    'message', 'candidateResume', 'jobAlert', 'skill', 'savedJob', 'talentInvitation'
  ]
  const prisma = Object.fromEntries(modelNames.map((name) => [
    name,
    Object.fromEntries(methodNames.map((method) => [method, vi.fn()]))
  ]))
  prisma.$transaction = vi.fn()
  return { prisma, state: { users: [], refreshTokens: [], resetTokens: [], nextUserId: 10, nextRefreshId: 1, nextResetId: 1 } }
})

const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }))
globalThis.__JOB_CONNECT_TEST_PRISMA__ = database.prisma
globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__ = mail.sendEmail

const appModule = await import('../../src/app.js')
const app = appModule.default || appModule

function tokenFor(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, tokenVersion: user.tokenVersion },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'job-connect-api', audience: 'job-connect-web', subject: String(user.id) }
  )
}

function cookieValue(response) {
  return response.headers['set-cookie']?.[0]?.split(';')[0]
}

function resetDatabase() {
  const { prisma, state } = database
  for (const model of Object.values(prisma)) {
    if (model && typeof model === 'object') {
      for (const method of Object.values(model)) method?.mockReset?.()
    }
  }
  prisma.$transaction.mockReset()
  mail.sendEmail.mockReset().mockResolvedValue(undefined)
  state.users = [
    { id: 1, email: 'candidate@example.test', fullName: 'Candidate', role: 'CANDIDATE', status: 'ACTIVE', tokenVersion: 0 },
    { id: 2, email: 'recruiter@example.test', fullName: 'Recruiter', role: 'RECRUITER', status: 'ACTIVE', tokenVersion: 0 },
    { id: 3, email: 'admin@example.test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0 },
    { id: 4, email: 'other@example.test', fullName: 'Other candidate', role: 'CANDIDATE', status: 'ACTIVE', tokenVersion: 0 }
  ]
  state.refreshTokens = []
  state.resetTokens = []
  state.nextUserId = 10
  state.nextRefreshId = 1
  state.nextResetId = 1

  prisma.user.findUnique.mockImplementation(async ({ where }) => state.users.find((user) =>
    (where.id !== undefined && user.id === where.id) || (where.email !== undefined && user.email === where.email)
  ) || null)
  prisma.user.create.mockImplementation(async ({ data }) => {
    if (state.users.some((user) => user.email === data.email)) {
      const error = new Error('unique constraint')
      error.code = 'P2002'
      throw error
    }
    const user = { id: state.nextUserId++, status: 'ACTIVE', tokenVersion: 0, ...data }
    state.users.push(user)
    return user
  })
  prisma.user.update.mockImplementation(async ({ where, data }) => {
    const user = state.users.find((item) => item.id === where.id)
    if (data.tokenVersion?.increment) user.tokenVersion += data.tokenVersion.increment
    Object.assign(user, { ...data, tokenVersion: user.tokenVersion })
    return user
  })
  prisma.candidate.create.mockImplementation(async ({ data }) => ({ id: 100 + data.userId, ...data }))
  prisma.company.create.mockImplementation(async ({ data }) => ({ id: 50, ...data }))
  prisma.recruiter.create.mockImplementation(async ({ data }) => ({ id: 60, ...data }))
  prisma.refreshToken.create.mockImplementation(async ({ data }) => {
    const item = { id: state.nextRefreshId++, revokedAt: null, ...data }
    state.refreshTokens.push(item)
    return item
  })
  prisma.refreshToken.findUnique.mockImplementation(async ({ where, include }) => {
    const item = state.refreshTokens.find((entry) => entry.tokenHash === where.tokenHash) || null
    if (!item || !include?.user) return item
    return { ...item, user: state.users.find((user) => user.id === item.userId) }
  })
  prisma.refreshToken.updateMany.mockImplementation(async ({ where, data }) => {
    const matches = state.refreshTokens.filter((entry) =>
      (where.id === undefined || entry.id === where.id) &&
      (where.userId === undefined || entry.userId === where.userId) &&
      (where.revokedAt === undefined || entry.revokedAt === where.revokedAt) &&
      (!where.expiresAt?.gt || entry.expiresAt > where.expiresAt.gt)
    )
    matches.forEach((entry) => Object.assign(entry, data))
    return { count: matches.length }
  })
  prisma.passwordResetToken.findUnique.mockImplementation(async ({ where }) => state.resetTokens.find((entry) => entry.tokenHash === where.tokenHash) || null)
  prisma.passwordResetToken.create.mockImplementation(async ({ data }) => {
    const item = { id: state.nextResetId++, usedAt: null, ...data }
    state.resetTokens.push(item)
    return item
  })
  prisma.passwordResetToken.updateMany.mockImplementation(async ({ where, data }) => {
    const matches = state.resetTokens.filter((entry) =>
      (where.id === undefined || entry.id === where.id) &&
      (where.userId === undefined || entry.userId === where.userId) &&
      (where.usedAt === undefined || entry.usedAt === where.usedAt) &&
      (!where.expiresAt?.gt || entry.expiresAt > where.expiresAt.gt)
    )
    matches.forEach((entry) => Object.assign(entry, data))
    return { count: matches.length }
  })
  prisma.$transaction.mockImplementation(async (work) => Array.isArray(work) ? Promise.all(work) : work(prisma))
}

beforeEach(resetDatabase)

afterAll(() => {
  for (const name of fs.readdirSync(uploadDirectory)) fs.unlinkSync(path.join(uploadDirectory, name))
  fs.rmdirSync(uploadDirectory)
  delete globalThis.__JOB_CONNECT_TEST_PRISMA__
  delete globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__
})

describe('authentication integration workflow', () => {
  it('registers, logs in, rotates refresh token, and invalidates the access token on logout', async () => {
    const registration = await request(app).post('/api/auth/register').send({
      email: 'new@example.test', password: 'Password123!', fullName: 'New Candidate', role: 'CANDIDATE'
    })
    expect(registration.status).toBe(201)
    expect(registration.body.data.user).not.toHaveProperty('passwordHash')
    expect(cookieValue(registration)).toContain('job_connect_refresh=')

    const login = await request(app).post('/api/auth/login').send({ email: 'new@example.test', password: 'Password123!' })
    expect(login.status).toBe(200)
    const oldCookie = cookieValue(login)

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie)
    expect(refresh.status).toBe(200)
    expect(cookieValue(refresh)).not.toBe(oldCookie)

    const logout = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${refresh.body.data.token}`)
    expect(logout.status).toBe(200)
    const rejected = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refresh.body.data.token}`)
    expect(rejected.status).toBe(401)
  }, 15_000)
})

describe('password recovery security workflow', () => {
  it('does not enumerate accounts and enforces expiry, single use, password replacement, and session revocation', async () => {
    const user = database.state.users[0]
    user.passwordHash = await bcrypt.hash('OldPassword123!', 4)
    database.state.refreshTokens.push({ id: 99, userId: user.id, tokenHash: 'old-session', expiresAt: new Date(Date.now() + 60_000), revokedAt: null })

    const existing = await request(app).post('/api/auth/password-reset/request').send({ email: user.email })
    const unknown = await request(app).post('/api/auth/password-reset/request').send({ email: 'missing@example.test' })
    expect(existing.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(existing.body).toEqual(unknown.body)
    expect(mail.sendEmail).toHaveBeenCalledOnce()
    expect(database.state.resetTokens).toHaveLength(1)
    expect(database.state.resetTokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/)

    const resetText = mail.sendEmail.mock.calls[0][0].text
    const rawToken = decodeURIComponent(new URL(resetText.match(/https?:\/\/\S+/)[0]).searchParams.get('token'))
    expect(resetText).not.toContain(database.state.resetTokens[0].tokenHash)

    const confirmed = await request(app).post('/api/auth/password-reset/confirm').send({ token: rawToken, password: 'NewPassword123!' })
    const replay = await request(app).post('/api/auth/password-reset/confirm').send({ token: rawToken, password: 'AnotherPassword123!' })
    expect(confirmed.status).toBe(200)
    expect(replay.status).toBe(400)
    expect(database.state.resetTokens[0].usedAt).toBeInstanceOf(Date)
    expect(database.state.refreshTokens[0].revokedAt).toBeInstanceOf(Date)
    expect(user.tokenVersion).toBe(1)

    const expiredRaw = 'expired-reset-token-value-1234567890'
    database.state.resetTokens.push({ id: 100, userId: user.id, tokenHash: crypto.createHash('sha256').update(expiredRaw).digest('hex'), expiresAt: new Date(Date.now() - 1_000), usedAt: null })
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token: expiredRaw, password: 'UnusedPassword123!' })).status).toBe(400)
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token: 'invalid-reset-token-value-123456789', password: 'UnusedPassword123!' })).status).toBe(400)

    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'OldPassword123!' })).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'NewPassword123!' })).status).toBe(200)
  })

  it('keeps the generic response when email delivery fails and does not log account or token data', async () => {
    const user = database.state.users[0]
    mail.sendEmail.mockRejectedValueOnce(new Error('controlled SMTP failure'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await request(app).post('/api/auth/password-reset/request').send({ email: user.email })
      expect(response.status).toBe(200)
      expect(response.body.message).toContain('Nếu email tồn tại')
      expect(errorLog).toHaveBeenCalledWith('[password-reset-email]', { name: 'Error' })
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(user.email)
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(database.state.resetTokens[0].tokenHash)
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('RBAC integration', () => {
  it('denies cross-role access for candidate, recruiter, and admin', async () => {
    const [candidate, recruiter, admin] = database.state.users
    const responses = await Promise.all([
      request(app).get('/api/admin/jobs').set('Authorization', `Bearer ${tokenFor(candidate)}`),
      request(app).get('/api/candidates/me').set('Authorization', `Bearer ${tokenFor(recruiter)}`),
      request(app).post('/api/applications/jobs/1').set('Authorization', `Bearer ${tokenFor(admin)}`).send({}),
      request(app).get('/api/conversations/unread-count').set('Authorization', `Bearer ${tokenFor(admin)}`)
    ])
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403])
  })
})

describe('matching version gating', () => {
  it('returns 410 for a candidate before legacy V2 reads matching data', async () => {
    const candidate = database.state.users[0]

    const response = await request(app).get('/api/jobs/1/match/v2')
      .set('Authorization', `Bearer ${tokenFor(candidate)}`)

    expect(response.status).toBe(410)
    expect(response.body).toMatchObject({
      success: false,
      details: { code: 'matching_version_disabled', version: 'v2' }
    })
    expect(database.prisma.candidate.findUnique).not.toHaveBeenCalled()
    expect(database.prisma.job.findFirst).not.toHaveBeenCalled()
    expect(database.prisma.embeddingCache.findUnique).not.toHaveBeenCalled()
  })

  it('preserves RBAC when legacy V2 is disabled', async () => {
    const recruiter = database.state.users[1]

    const response = await request(app).get('/api/jobs/1/match/v2')
      .set('Authorization', `Bearer ${tokenFor(recruiter)}`)

    expect(response.status).toBe(403)
  })
})

describe('V1 fallback and CV privacy', () => {
  it('returns V1 recommendations with rule explanations when Gemini is unavailable', async () => {
    const candidateUser = database.state.users[0]
    database.prisma.candidate.findUnique.mockResolvedValue({
      id: 11,
      userId: candidateUser.id,
      skills: [{ skillId: 1, skill: { id: 1, name: 'Node.js' } }]
    })
    database.prisma.job.findMany.mockResolvedValue([{
      id: 21,
      title: 'Backend Engineer',
      description: 'Build APIs',
      status: 'PUBLISHED',
      company: { id: 31, name: 'QA Company' },
      skills: [{ skillId: 1, isRequired: true, skill: { id: 1, name: 'Node.js' } }]
    }])
    database.prisma.application.findMany.mockResolvedValue([])
    database.prisma.matchScore.upsert.mockResolvedValue({ id: 91 })
    database.prisma.recommendation.upsert.mockResolvedValue({ id: 92 })

    const response = await request(app).get('/api/recommendations/jobs?limit=10')
      .set('Authorization', `Bearer ${tokenFor(candidateUser)}`)

    expect(response.status).toBe(200)
    expect(response.body.data[0].match).toMatchObject({
      score: expect.any(Number),
      explanation: expect.any(String)
    })
    expect(response.body.data[0].match.explanation.length).toBeGreaterThan(0)
  })

  it('does not expose a candidate CV to unrelated candidates or recruiters', async () => {
    const owner = database.state.users[0]
    const recruiter = database.state.users[1]
    const outsider = database.state.users[3]
    database.prisma.candidateResume.findUnique.mockResolvedValue({
      id: 81,
      candidateId: 11,
      fileName: 'private.pdf',
      path: 'private.pdf',
      mimeType: 'application/pdf',
      candidate: { id: 11, userId: owner.id }
    })
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 60, userId: recruiter.id, companyId: 30 })
    database.prisma.application.findFirst.mockResolvedValue(null)

    const [candidateResponse, recruiterResponse] = await Promise.all([
      request(app).get('/api/candidates/resumes/81/download')
        .set('Authorization', `Bearer ${tokenFor(outsider)}`),
      request(app).get('/api/candidates/resumes/81/download')
        .set('Authorization', `Bearer ${tokenFor(recruiter)}`)
    ])

    expect(candidateResponse.status).toBe(403)
    expect(recruiterResponse.status).toBe(403)
  })
})

describe('public job and company detail regressions', () => {
  it('returns a published job detail with the public response contract and a valid deadline OR filter', async () => {
    const publishedJob = {
      id: 21,
      companyId: 31,
      title: 'QA Published Job',
      description: 'Published detail',
      status: 'PUBLISHED',
      deadline: null,
      company: { id: 31, name: 'QA Company', logoUrl: null },
      skills: [],
      _count: { applications: 2 }
    }
    database.prisma.job.findFirst.mockImplementation(async ({ where }) => {
      if (where.deadline?.OR) throw new Error('Prisma DateTimeFilter does not accept OR')
      return publishedJob
    })
    database.prisma.jobView.findFirst.mockResolvedValue({ id: 1 })

    const response = await request(app).get('/api/jobs/21')

    expect(response.status).toBe(200)
    expect(database.prisma.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 21,
        status: 'PUBLISHED',
        OR: expect.arrayContaining([{ deadline: { gte: expect.any(Date) } }, { deadline: null }])
      })
    }))
    expect(response.body.data).toMatchObject({ id: 21, title: 'QA Published Job', applicantCount: 2 })
    expect(response.body.data).not.toHaveProperty('_count')
  })

  it.each(['DRAFT', 'PENDING', 'CLOSED', 'REJECTED'])('does not expose a non-public %s job through the public detail endpoint', async (status) => {
    database.prisma.job.findFirst.mockImplementation(async ({ where }) => {
      expect(where.status).toBe('PUBLISHED')
      return null
    })

    const response = await request(app).get('/api/jobs/22')

    expect(response.status).toBe(404)
    expect(database.prisma.jobView.create).not.toHaveBeenCalled()
  })

  it.each([
    { reviews: [], followerCount: 0 },
    {
      reviews: [{ id: 7, rating: 5, title: 'Great', pros: 'Team', cons: 'None', isAnonymous: false, status: 'APPROVED', createdAt: new Date('2026-01-01'), user: { id: 1, fullName: 'Candidate' } }],
      followerCount: 3
    }
  ])('returns company detail with reviews and followers while preserving its contract', async ({ reviews, followerCount }) => {
    database.prisma.company.findUnique.mockImplementation(async ({ include }) => {
      if (include.jobs?.select?.reviews || include.jobs?.select?._count?.select?.followers) {
        throw new Error('Company relations were nested under Job select')
      }
      return {
        id: 31,
        name: 'QA Company',
        jobs: [{ id: 21, title: 'QA Published Job', _count: { applications: 2 } }],
        reviews,
        _count: { followers: followerCount }
      }
    })

    const response = await request(app).get('/api/companies/31')

    expect(response.status).toBe(200)
    expect(database.prisma.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        jobs: expect.any(Object),
        reviews: expect.any(Object),
        _count: { select: { followers: true } }
      })
    }))
    expect(response.body.data.followerCount).toBe(followerCount)
    expect(response.body.data.jobs[0]).toMatchObject({ id: 21, applicantCount: 2 })
    expect(response.body.data.reviews).toHaveLength(reviews.length)
    if (reviews.length) expect(response.body.data.reviews[0].author).toEqual({ id: 1, fullName: 'Candidate' })
  })
})

describe('application and ownership workflows', () => {
  it('creates a job with skills and screening questions in one transaction', async () => {
    const recruiterUser = database.state.users[1]
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 6, userId: recruiterUser.id, companyId: 100 })
    database.prisma.job.create.mockResolvedValue({ id: 21, companyId: 100, title: 'Atomic job', status: 'DRAFT', company: {}, skills: [] })
    database.prisma.jobScreeningQuestion.createMany.mockResolvedValue({ count: 1 })

    const response = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${tokenFor(recruiterUser)}`)
      .send({
        title: 'Atomic job', description: 'A sufficiently detailed atomic job description.', status: 'DRAFT',
        skillIds: [1, 2], requiredSkills: [1],
        screeningQuestions: [{ type: 'TEXT', question: 'Why this role?', isRequired: true }]
      })

    expect(response.status).toBe(201)
    expect(database.prisma.$transaction).toHaveBeenCalledOnce()
    expect(database.prisma.job.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: 100, skills: { create: expect.arrayContaining([
        expect.objectContaining({ isRequired: true }), expect.objectContaining({ isRequired: false })
      ]) } })
    }))
    expect(database.prisma.jobScreeningQuestion.createMany).toHaveBeenCalledOnce()
  })

  it('updates job fields, replaces skills and replaces questions in one transaction', async () => {
    const recruiterUser = database.state.users[1]
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 6, userId: recruiterUser.id, companyId: 100 })
    database.prisma.job.findUnique.mockResolvedValue({ id: 22, companyId: 100, status: 'DRAFT' })
    database.prisma.job.update.mockResolvedValue({ id: 22, companyId: 100, title: 'Updated atomic job', status: 'DRAFT', company: {}, skills: [] })
    database.prisma.jobScreeningQuestion.deleteMany.mockResolvedValue({ count: 1 })
    database.prisma.jobScreeningQuestion.createMany.mockResolvedValue({ count: 1 })

    const response = await request(app).patch('/api/jobs/22')
      .set('Authorization', `Bearer ${tokenFor(recruiterUser)}`)
      .send({ title: 'Updated atomic job', skillIds: [2], screeningQuestions: [{ type: 'YES_NO', question: 'Available now?' }] })

    expect(response.status).toBe(200)
    expect(database.prisma.$transaction).toHaveBeenCalledOnce()
    expect(database.prisma.job.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skills: expect.objectContaining({ deleteMany: {}, create: expect.any(Array) }) })
    }))
    expect(database.prisma.jobScreeningQuestion.deleteMany).toHaveBeenCalledWith({ where: { jobId: 22 } })
    expect(database.prisma.jobScreeningQuestion.createMany).toHaveBeenCalledOnce()
  })

  it('validates before write and propagates required-skill or question write failures', async () => {
    const recruiterUser = database.state.users[1]
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 6, userId: recruiterUser.id, companyId: 100 })
    const authorization = `Bearer ${tokenFor(recruiterUser)}`

    const invalid = await request(app).post('/api/jobs').set('Authorization', authorization).send({ title: 'x', description: 'short' })
    expect(invalid.status).toBe(400)
    expect(database.prisma.$transaction).not.toHaveBeenCalled()

    database.prisma.job.create.mockRejectedValueOnce(new Error('injected required skill failure'))
    const skillFailure = await request(app).post('/api/jobs').set('Authorization', authorization).send({
      title: 'Skill failure', description: 'A sufficiently detailed job description.', skillIds: [999999]
    })
    expect(skillFailure.status).toBe(500)
    expect(database.prisma.jobScreeningQuestion.createMany).not.toHaveBeenCalled()

    database.prisma.job.create.mockResolvedValueOnce({ id: 23, companyId: 100, title: 'Question failure', status: 'PENDING', company: {}, skills: [] })
    database.prisma.jobScreeningQuestion.createMany.mockRejectedValueOnce(new Error('injected screening question failure'))
    const questionFailure = await request(app).post('/api/jobs').set('Authorization', authorization).send({
      title: 'Question failure', description: 'A sufficiently detailed job description.',
      screeningQuestions: [{ type: 'TEXT', question: 'Trigger controlled failure' }]
    })
    expect(questionFailure.status).toBe(500)
  })

  it('creates one application, rejects a duplicate, and lets its candidate withdraw it', async () => {
    const candidateUser = database.state.users[0]
    const candidate = { id: 11, userId: candidateUser.id, skills: [{ skill: { id: 1, name: 'Node.js' } }] }
    const job = { id: 21, companyId: 31, title: 'Backend Engineer', status: 'PUBLISHED', skills: [{ skill: { id: 1, name: 'Node.js' }, isRequired: true }], screeningQuestions: [] }
    let application = null
    database.prisma.candidate.findUnique.mockResolvedValue(candidate)
    database.prisma.job.findFirst.mockImplementation(async ({ where }) => {
      expect(where).toMatchObject({
        id: job.id,
        status: 'PUBLISHED',
        OR: expect.arrayContaining([{ deadline: { gte: expect.any(Date) } }, { deadline: null }])
      })
      expect(where.deadline).toBeUndefined()
      return job
    })
    database.prisma.application.findUnique.mockImplementation(async ({ where }) => {
      if (where.candidateId_jobId) return application
      return application?.id === where.id ? application : null
    })
    database.prisma.application.create.mockImplementation(async ({ data }) => {
      application = { id: 41, status: 'APPLIED', ...data }
      return application
    })
    database.prisma.application.update.mockImplementation(async ({ data }) => Object.assign(application, data))
    database.prisma.matchScore.upsert.mockResolvedValue({ id: 1 })
    database.prisma.recruiter.findMany.mockResolvedValue([])
    database.prisma.applicationStatusHistory.create.mockResolvedValue({ id: 1 })

    const authorization = `Bearer ${tokenFor(candidateUser)}`
    const created = await request(app).post('/api/applications/jobs/21').set('Authorization', authorization).send({ coverLetter: 'I am interested.' })
    const duplicate = await request(app).post('/api/applications/jobs/21').set('Authorization', authorization).send({})
    const withdrawn = await request(app).patch('/api/applications/41/withdraw').set('Authorization', authorization).send({})

    expect(created.status).toBe(201)
    expect(duplicate.status).toBe(409)
    expect(withdrawn.status).toBe(200)
    expect(withdrawn.body.data.status).toBe('WITHDRAWN')
    expect(database.prisma.application.create).toHaveBeenCalledOnce()
  })

  it('prevents a recruiter from editing a foreign job or changing its application status', async () => {
    const recruiterUser = database.state.users[1]
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 6, userId: recruiterUser.id, companyId: 100 })
    database.prisma.job.findUnique.mockResolvedValue({ id: 22, companyId: 999, status: 'DRAFT' })
    database.prisma.application.findUnique.mockResolvedValue({ id: 42, candidateId: 11, status: 'APPLIED', job: { id: 22, companyId: 999, title: 'Foreign job' } })
    const authorization = `Bearer ${tokenFor(recruiterUser)}`

    const editJob = await request(app).patch('/api/jobs/22').set('Authorization', authorization).send({ title: 'Unauthorized edit' })
    const editApplication = await request(app).patch('/api/applications/42/status').set('Authorization', authorization).send({ status: 'REVIEWING' })

    expect(editJob.status).toBe(403)
    expect(editApplication.status).toBe(403)
    expect(database.prisma.job.update).not.toHaveBeenCalled()
    expect(database.prisma.application.update).not.toHaveBeenCalled()
  })

  it('allows a recruiter to update an application owned by the recruiter company', async () => {
    const recruiterUser = database.state.users[1]
    const application = { id: 43, candidateId: 11, status: 'APPLIED', job: { id: 23, companyId: 100, title: 'Owned job' } }
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 6, userId: recruiterUser.id, companyId: 100 })
    database.prisma.application.findUnique.mockResolvedValue(application)
    database.prisma.application.update.mockResolvedValue({ ...application, status: 'REVIEWING' })
    database.prisma.applicationStatusHistory.create.mockResolvedValue({ id: 1 })
    database.prisma.candidate.findUnique.mockResolvedValue({ id: 11, userId: 1, user: { id: 1, email: 'candidate@example.test' } })
    database.prisma.notification.create.mockResolvedValue({ id: 1 })

    const response = await request(app).patch('/api/applications/43/status')
      .set('Authorization', `Bearer ${tokenFor(recruiterUser)}`)
      .send({ status: 'REVIEWING', note: 'Qualified' })

    expect(response.status).toBe(200)
    expect(response.body.data.status).toBe('REVIEWING')
    expect(database.prisma.applicationStatusHistory.create).toHaveBeenCalledOnce()
    expect(mail.sendEmail).toHaveBeenCalledOnce()
  })
})

describe('admin moderation and conversations', () => {
  it('moderates a pending job and records an audit entry', async () => {
    const admin = database.state.users[2]
    const job = { id: 25, companyId: 30, title: 'Pending job', status: 'PENDING' }
    database.prisma.job.findUnique.mockResolvedValue(job)
    database.prisma.job.update.mockResolvedValue({ ...job, status: 'REJECTED', moderationNote: 'Incomplete' })
    database.prisma.recruiter.findMany.mockResolvedValue([])
    database.prisma.auditLog.create.mockResolvedValue({ id: 1 })
    const response = await request(app).patch('/api/admin/jobs/25/moderation')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ status: 'REJECTED', note: 'Incomplete' })
    expect(response.status).toBe(200)
    expect(database.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: admin.id, action: 'JOB_MODERATION_UPDATED', entityId: job.id })
    }))
  })

  it('lets a participant send sanitized text and rejects a different candidate', async () => {
    const candidate = database.state.users[0]
    const outsider = database.state.users[3]
    const conversation = { id: 70, application: { candidate: { userId: candidate.id }, job: { companyId: 30 } } }
    database.prisma.conversation.findUnique.mockResolvedValue(conversation)
    database.prisma.message.create.mockImplementation(async ({ data }) => ({ id: 71, ...data }))
    database.prisma.conversation.update.mockResolvedValue(conversation)

    const sent = await request(app).post('/api/conversations/70/messages')
      .set('Authorization', `Bearer ${tokenFor(candidate)}`).send({ content: '<b>Hello</b> &amp; welcome' })
    const forbidden = await request(app).get('/api/conversations/70/messages')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)

    expect(sent.status).toBe(201)
    expect(sent.body.data.content).toBe('Hello & welcome')
    expect(forbidden.status).toBe(403)
  })

  it('lets the owning recruiter open a conversation for an application', async () => {
    const recruiter = database.state.users[1]
    database.prisma.recruiter.findUnique.mockResolvedValue({ id: 6, userId: recruiter.id, companyId: 30 })
    database.prisma.application.findUnique.mockResolvedValue({ id: 45, job: { id: 25, companyId: 30 } })
    database.prisma.conversation.upsert.mockResolvedValue({ id: 72, applicationId: 45 })

    const response = await request(app).post('/api/conversations/applications/45')
      .set('Authorization', `Bearer ${tokenFor(recruiter)}`).send({})

    expect(response.status).toBe(201)
    expect(response.body.data).toEqual({ id: 72, applicationId: 45 })
  })
})

describe('CV upload integration', () => {
  it('accepts a valid PDF signature and removes an invalid upload', async () => {
    const candidateUser = database.state.users[0]
    const candidate = { id: 11, userId: candidateUser.id }
    database.prisma.candidate.findUnique.mockResolvedValue(candidate)
    database.prisma.candidateResume.count.mockResolvedValue(0)
    database.prisma.candidateResume.updateMany.mockResolvedValue({ count: 0 })
    database.prisma.candidateResume.create.mockImplementation(async ({ data }) => ({ id: 81, ...data }))
    const authorization = `Bearer ${tokenFor(candidateUser)}`

    const invalid = await request(app).post('/api/candidates/me/resumes').set('Authorization', authorization)
      .attach('file', Buffer.from('not a pdf'), { filename: 'fake.pdf', contentType: 'application/pdf' })
    const valid = await request(app).post('/api/candidates/me/resumes').set('Authorization', authorization)
      .field('isDefault', 'true')
      .attach('file', Buffer.from('%PDF-1.7\n1 0 obj\n%%EOF'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(invalid.status).toBe(400)
    expect(valid.status).toBe(201)
    expect(valid.body.data).toMatchObject({ fileName: 'resume.pdf', mimeType: 'application/pdf', isDefault: true })
    expect(fs.readdirSync(uploadDirectory)).toHaveLength(1)
  })
})
