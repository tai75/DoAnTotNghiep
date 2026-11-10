import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import appModule from '../../src/app.js'
import configModule from '../../src/config/env.js'

const enabled = process.env.RUN_COMPANY_VERIFICATION_QA === '1'
const app = appModule.default || appModule
const config = configModule.default || configModule

describe.skipIf(!enabled)('QA-01 company verification lifecycle', () => {
  let prisma
  const createdCompanyIds = []
  const createdUserIds = []

  const token = (user) => jwt.sign(
    { userId: user.id, role: user.role, tokenVersion: user.tokenVersion },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: '5m', issuer: config.jwtIssuer, audience: config.jwtAudience, subject: String(user.id) }
  )

  beforeAll(async () => {
    const url = new URL(process.env.QA01_DATABASE_URL)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.slice(1) !== 'job_connect_qa01_e2e' || decodeURIComponent(url.username) !== 'job_connect_qa01') {
      throw new Error('QA identity guard failed')
    }
    prisma = new PrismaClient({ datasourceUrl: url.toString() })
    const [identity] = await prisma.$queryRawUnsafe('SELECT DATABASE() databaseName, CURRENT_USER() currentUser')
    if (identity.databaseName !== 'job_connect_qa01_e2e' || !String(identity.currentUser).startsWith('job_connect_qa01@')) throw new Error('QA runtime identity guard failed')
    globalThis.__JOB_CONNECT_TEST_PRISMA__ = prisma
  })

  afterAll(async () => {
    if (prisma) {
      for (const id of createdCompanyIds) await prisma.company.deleteMany({ where: { id } })
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
      await prisma.$disconnect()
    }
    delete globalThis.__JOB_CONNECT_TEST_PRISMA__
  })

  async function fixtures(label) {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const [admin, recruiterUser] = await Promise.all([
      prisma.user.create({ data: { email: `sec01-admin-${label}-${suffix}@qa.invalid`, passwordHash: 'qa-only', fullName: 'SEC01 QA Admin', role: 'ADMIN' } }),
      prisma.user.create({ data: { email: `sec01-recruiter-${label}-${suffix}@qa.invalid`, passwordHash: 'qa-only', fullName: 'SEC01 QA Recruiter', role: 'RECRUITER' } })
    ])
    createdUserIds.push(admin.id, recruiterUser.id)
    const company = await prisma.company.create({ data: { name: `SEC01 ${label} ${suffix}`, address: 'QA isolated address' } })
    createdCompanyIds.push(company.id)
    await prisma.recruiter.create({ data: { userId: recruiterUser.id, companyId: company.id } })
    return { admin, recruiterUser, company, adminAuth: { Authorization: `Bearer ${token(admin)}` }, recruiterAuth: { Authorization: `Bearer ${token(recruiterUser)}` } }
  }

  it('keeps new candidates private and runs submit/approve CAS idempotently', async () => {
    const f = await fixtures('approve')
    const candidateUser = await prisma.user.create({ data: { email: `sec01-candidate-${crypto.randomUUID()}@qa.invalid`, passwordHash: 'qa-only', fullName: 'SEC01 QA Candidate', role: 'CANDIDATE' } })
    createdUserIds.push(candidateUser.id)
    const candidate = await prisma.candidate.create({ data: { userId: candidateUser.id } })
    expect(candidate.isSearchable).toBe(false)

    const jobPayload = { title: 'SEC01 QA Draft', description: 'Synthetic verification test draft', location: 'QA' }
    const draft = await request(app).post('/api/jobs').set(f.recruiterAuth).send(jobPayload)
    expect(draft.status).toBe(201)
    expect(draft.body.data.status).toBe('DRAFT')
    expect((await request(app).post(`/api/jobs/${draft.body.data.id}/submit`).set(f.recruiterAuth).send({})).status).toBe(403)
    expect((await request(app).get('/api/applications/managed').set(f.recruiterAuth)).status).toBe(403)

    const submissions = await Promise.all([
      request(app).post('/api/companies/me/verification-requests').set(f.recruiterAuth).send({ requestKey: crypto.randomUUID() }),
      request(app).post('/api/companies/me/verification-requests').set(f.recruiterAuth).send({ requestKey: crypto.randomUUID() })
    ])
    expect(submissions.map((response) => response.status).sort()).toEqual([200, 201])
    expect(new Set(submissions.map((response) => response.body.data.id)).size).toBe(1)

    const requestId = submissions[0].body.data.id
    const approvals = await Promise.all([
      request(app).patch(`/api/admin/verification-requests/${requestId}`).set(f.adminAuth).send({ decision: 'APPROVED', note: 'QA approved' }),
      request(app).patch(`/api/admin/verification-requests/${requestId}`).set(f.adminAuth).send({ decision: 'APPROVED', note: 'QA approved' })
    ])
    expect(approvals.some((response) => response.status === 200)).toBe(true)
    expect(approvals.every((response) => [200, 409].includes(response.status))).toBe(true)
    const company = await prisma.company.findUnique({ where: { id: f.company.id } })
    expect(company).toMatchObject({ verificationStatus: 'VERIFIED', verificationSource: 'ADMIN_REVIEW' })
    expect(await prisma.auditLog.count({ where: { action: 'COMPANY_VERIFICATION_APPROVED', entityId: requestId } })).toBe(1)
    expect((await request(app).post(`/api/jobs/${draft.body.data.id}/submit`).set(f.recruiterAuth).send({})).status).toBe(200)

    await prisma.company.update({ where: { id: f.company.id }, data: { status: 'SUSPENDED' } })
    expect((await request(app).get('/api/applications/managed').set(f.recruiterAuth)).status).toBe(403)
  }, 30_000)

  it('records a rejection reason and allows a new request after rejection', async () => {
    const f = await fixtures('reject')
    const submitted = await request(app).post('/api/companies/me/verification-requests').set(f.recruiterAuth).send({ requestKey: crypto.randomUUID() })
    expect(submitted.status).toBe(201)
    const rejected = await request(app).patch(`/api/admin/verification-requests/${submitted.body.data.id}`).set(f.adminAuth).send({ decision: 'REJECTED', reason: 'Hồ sơ QA chưa đủ thông tin' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.data.rejectionReason).toBe('Hồ sơ QA chưa đủ thông tin')
    expect((await prisma.company.findUnique({ where: { id: f.company.id } })).verificationStatus).toBe('REJECTED')
    expect((await request(app).post('/api/companies/me/verification-requests').set(f.recruiterAuth).send({ requestKey: crypto.randomUUID() })).status).toBe(201)
  }, 30_000)
})
