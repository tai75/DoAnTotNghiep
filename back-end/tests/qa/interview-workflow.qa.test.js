import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import appModule from '../../src/app.js'
import configModule from '../../src/config/env.js'
import e2eDatabase from '../../scripts/e2e-db.cjs'

const enabled = process.env.RUN_E2E_INTERVIEW_TESTS === '1'
const app = appModule.default || appModule
const config = configModule.default || configModule
const { assertCanonicalDatabase, resetBusinessData, seed } = e2eDatabase

describe.skipIf(!enabled)('QA real MySQL interview workflow', () => {
  let prisma, fixture, application, recruiterAuth, candidateAuth

  function token(user) {
    return jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '5m', issuer: config.jwtIssuer, audience: config.jwtAudience, subject: String(user.id) })
  }
  const schedule = (requestKey = crypto.randomUUID()) => ({ applicationId: application.id, requestKey, scheduledStart: '2030-05-01T09:00:00+07:00', scheduledEnd: '2030-05-01T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh', mode: 'ONLINE', meetingUrl: 'https://meet.example.test/qa-room', candidateInstructions: 'Synthetic QA interview.', recruiterNote: 'Private recruiter note' })

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL })
    globalThis.__JOB_CONNECT_TEST_PRISMA__ = prisma
    await assertCanonicalDatabase(prisma)
  }, 30_000)
  beforeEach(async () => {
    await resetBusinessData(prisma); fixture = await seed(prisma)
    application = await prisma.application.create({ data: { candidateId: fixture.candidateId, jobId: fixture.baseJobId, history: { create: { toStatus: 'APPLIED' } } } })
    const [recruiter, candidate] = await Promise.all([prisma.user.findUnique({ where: { id: fixture.users.recruiter } }), prisma.user.findUnique({ where: { id: fixture.users.candidate } })])
    recruiterAuth = { Authorization: `Bearer ${token(recruiter)}` }; candidateAuth = { Authorization: `Bearer ${token(candidate)}` }
  }, 30_000)
  afterAll(async () => { delete globalThis.__JOB_CONNECT_TEST_PRISMA__; await prisma?.$disconnect() })

  it('creates one round idempotently, moves the application through APP-STATE-02, and validates time/mode', async () => {
    const requestKey = crypto.randomUUID()
    const attempts = await Promise.all([
      request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule(requestKey)),
      request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule(requestKey))
    ])
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 201])
    const created = attempts.find((response) => response.status === 201)
    expect(created.body.data.round).toBe(1)
    expect((await prisma.application.findUnique({ where: { id: application.id } })).status).toBe('INTERVIEWING')
    const replay = await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule(requestKey))
    expect(replay.status).toBe(200); expect(replay.body.data.id).toBe(created.body.data.id); expect(replay.body.meta.idempotentReplay).toBe(true)
    expect(await prisma.interview.count()).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'INTERVIEW_SCHEDULED' } })).toBe(1)
    const candidateDetail = await request(app).get(`/api/interviews/candidate/${created.body.data.id}`).set(candidateAuth)
    expect(candidateDetail.status).toBe(200)
    expect(candidateDetail.body.data).not.toHaveProperty('recruiterNote')
    expect(candidateDetail.body.data).not.toHaveProperty('requestKey')
    const prematureComplete = await request(app).post(`/api/interviews/recruiter/${created.body.data.id}/complete`).set(recruiterAuth).send({ expectedVersion: created.body.data.version })
    expect(prematureComplete.status).toBe(409)
    const badTime = await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send({ ...schedule(), scheduledEnd: '2030-05-01T08:00:00+07:00' })
    expect(badTime.status).toBe(400)
    const badLink = await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send({ ...schedule(), meetingUrl: 'http://unsafe.example.test' })
    expect(badLink.status).toBe(400)
  })

  it('enforces recruiter and candidate ownership without leaking records', async () => {
    const created = await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule())
    const foreignCandidateUser = await prisma.user.create({ data: { email: 'interview-foreign-candidate@jobconnect.local', passwordHash: 'not-used', fullName: 'Foreign Candidate', role: 'CANDIDATE' } })
    await prisma.candidate.create({ data: { userId: foreignCandidateUser.id } })
    const foreignCompany = await prisma.company.create({ data: { name: 'Interview Foreign Company', verificationStatus: 'VERIFIED' } })
    const foreignRecruiterUser = await prisma.user.create({ data: { email: 'interview-foreign-recruiter@jobconnect.local', passwordHash: 'not-used', fullName: 'Foreign Recruiter', role: 'RECRUITER' } })
    const foreignRecruiter = await prisma.recruiter.create({ data: { userId: foreignRecruiterUser.id, companyId: foreignCompany.id } })
    const unverifiedCompany = await prisma.company.create({ data: { name: 'Interview Unverified Company', verificationStatus: 'UNVERIFIED' } })
    const unverifiedRecruiterUser = await prisma.user.create({ data: { email: 'interview-unverified-recruiter@jobconnect.local', passwordHash: 'not-used', fullName: 'Unverified Recruiter', role: 'RECRUITER' } })
    await prisma.recruiter.create({ data: { userId: unverifiedRecruiterUser.id, companyId: unverifiedCompany.id } })
    expect(foreignCompany).toMatchObject({ verificationStatus: 'VERIFIED' })
    expect(foreignCompany.id).not.toBe(fixture.companyId)
    expect(foreignRecruiter.companyId).toBe(foreignCompany.id)
    expect(foreignRecruiterUser.status).toBe('ACTIVE')
    expect(created.body.data.application.job.companyId).toBe(fixture.companyId)
    expect((await request(app).get(`/api/interviews/candidate/${created.body.data.id}`).set('Authorization', `Bearer ${token(foreignCandidateUser)}`)).status).toBe(404)
    const foreignResponse = await request(app).get(`/api/interviews/recruiter/${created.body.data.id}`).set('Authorization', `Bearer ${token(foreignRecruiterUser)}`)
    expect(foreignResponse.status).toBe(404)
    expect(foreignResponse.body).not.toHaveProperty('data')
    const unverifiedResponse = await request(app).get(`/api/interviews/recruiter/${created.body.data.id}`).set('Authorization', `Bearer ${token(unverifiedRecruiterUser)}`)
    expect(unverifiedResponse.status).toBe(403)
    expect(unverifiedResponse.body.details).toMatchObject({ code: 'COMPANY_VERIFICATION_REQUIRED', verificationStatus: 'UNVERIFIED' })
    expect(unverifiedResponse.body).not.toHaveProperty('data')
    expect((await request(app).get(`/api/interviews/recruiter/${created.body.data.id}`).set(candidateAuth)).status).toBe(403)
  })

  it('serializes concurrent candidate confirm versus recruiter cancel with one winner and one notification', async () => {
    const created = (await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule())).body.data
    const before = await prisma.notification.count()
    const [confirm, cancel] = await Promise.all([
      request(app).post(`/api/interviews/candidate/${created.id}/confirm`).set(candidateAuth).send({ expectedVersion: created.version }),
      request(app).post(`/api/interviews/recruiter/${created.id}/cancel`).set(recruiterAuth).send({ expectedVersion: created.version, note: 'Concurrent QA cancel' })
    ])
    expect([confirm.status, cancel.status].sort()).toEqual([200, 409])
    expect(['CONFIRMED', 'CANCELLED']).toContain((await prisma.interview.findUnique({ where: { id: created.id } })).status)
    expect(await prisma.notification.count()).toBe(before + 1)
  })

  it('serializes reschedule versus decline and supports a later interview round', async () => {
    const first = (await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule())).body.data
    const before = await prisma.notification.count()
    const [reschedule, decline] = await Promise.all([
      request(app).post(`/api/interviews/candidate/${first.id}/reschedule`).set(candidateAuth).send({ expectedVersion: first.version, proposedStart: '2030-05-02T09:00:00+07:00', proposedEnd: '2030-05-02T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh', note: 'Please change' }),
      request(app).post(`/api/interviews/candidate/${first.id}/decline`).set(candidateAuth).send({ expectedVersion: first.version, note: 'Cannot attend' })
    ])
    expect([reschedule.status, decline.status].sort()).toEqual([200, 409])
    expect(await prisma.notification.count()).toBe(before + 1)
    const current = await prisma.interview.findUnique({ where: { id: first.id } })
    if (current.status === 'RESCHEDULE_REQUESTED') await request(app).post(`/api/interviews/recruiter/${first.id}/cancel`).set(recruiterAuth).send({ expectedVersion: current.version })
    const second = await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send({ ...schedule(), scheduledStart: '2030-06-01T09:00:00+07:00', scheduledEnd: '2030-06-01T10:00:00+07:00' })
    expect(second.status).toBe(201); expect(second.body.data.round).toBe(2)
  })

  it('atomically cancels active interviews when the application becomes terminal', async () => {
    const interview = (await request(app).post('/api/interviews/recruiter').set(recruiterAuth).send(schedule())).body.data
    const rejected = await request(app).patch(`/api/applications/${application.id}/status`).set(recruiterAuth).send({ status: 'REJECTED', expectedStatus: 'INTERVIEWING', note: 'Closed after review' })
    expect(rejected.status).toBe(200)
    expect((await prisma.interview.findUnique({ where: { id: interview.id } })).status).toBe('CANCELLED')
    expect(await prisma.notification.count({ where: { type: 'INTERVIEW_CANCELLED' } })).toBe(1)
    const response = await request(app).post(`/api/interviews/candidate/${interview.id}/confirm`).set(candidateAuth).send({ expectedVersion: interview.version + 1 })
    expect(response.status).toBe(409)
  })
})
