import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import appModule from '../../src/app.js'
import e2eDatabase from '../../scripts/e2e-db.cjs'

const enabled = process.env.RUN_E2E_NOTIFICATION_TESTS === '1'
const app = appModule.default || appModule
const { assertCanonicalDatabase, resetBusinessData, seed } = e2eDatabase

describe.skipIf(!enabled)('QA real MySQL notifications', () => {
  let prisma
  let candidate
  let recruiter

  function tokenFor(user) {
    return jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET, {
      algorithm: 'HS256', expiresIn: '15m', issuer: 'job-connect-api', audience: 'job-connect-web', subject: String(user.id)
    })
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL })
    globalThis.__JOB_CONNECT_TEST_PRISMA__ = prisma
    await assertCanonicalDatabase(prisma)
  }, 30_000)

  beforeEach(async () => {
    await resetBusinessData(prisma)
    await seed(prisma)
    candidate = await prisma.user.findUnique({ where: { email: 'candidate@jobconnect.local' } })
    recruiter = await prisma.user.findUnique({ where: { email: 'recruiter@jobconnect.local' } })
    await prisma.notification.createMany({ data: [
      { userId: candidate.id, type: 'SYSTEM', title: 'Candidate unread', content: 'QA candidate notification' },
      { userId: candidate.id, type: 'SYSTEM', title: 'Candidate read', content: 'QA read notification', isRead: true },
      { userId: recruiter.id, type: 'SYSTEM', title: 'Recruiter unread', content: 'QA recruiter notification' }
    ] })
  }, 30_000)

  afterAll(async () => {
    delete globalThis.__JOB_CONNECT_TEST_PRISMA__
    await prisma?.$disconnect()
  })

  it('enforces ownership, exact unread counts, idempotent read and account-scoped read-all', async () => {
    const candidateAuth = `Bearer ${tokenFor(candidate)}`
    const recruiterNotification = await prisma.notification.findFirst({ where: { userId: recruiter.id } })
    const candidateNotification = await prisma.notification.findFirst({ where: { userId: candidate.id, isRead: false } })

    const listed = await request(app).get('/api/notifications').set('Authorization', candidateAuth)
    expect(listed.status).toBe(200)
    expect(listed.body.data.items).toHaveLength(2)
    expect(listed.body.data.items.every((item) => item.userId === candidate.id)).toBe(true)
    expect(listed.body.data.unreadCount).toBe(1)
    expect((await request(app).patch(`/api/notifications/${recruiterNotification.id}/read`).set('Authorization', candidateAuth)).status).toBe(404)
    expect((await request(app).patch(`/api/notifications/${candidateNotification.id}/read`).set('Authorization', candidateAuth)).status).toBe(200)
    expect((await request(app).patch(`/api/notifications/${candidateNotification.id}/read`).set('Authorization', candidateAuth)).status).toBe(200)

    await prisma.notification.update({ where: { id: candidateNotification.id }, data: { isRead: false } })
    expect((await request(app).patch('/api/notifications/read-all').set('Authorization', candidateAuth)).status).toBe(200)
    expect(await prisma.notification.count({ where: { userId: candidate.id, isRead: false } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: recruiter.id, isRead: false } })).toBe(1)
  })
})
