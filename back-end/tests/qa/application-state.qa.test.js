import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import appModule from '../../src/app.js'
import configModule from '../../src/config/env.js'
import stateModule from '../../src/services/applicationState.service.js'
import qaDatabase from '../../scripts/qa01-db.cjs'

const enabled = process.env.RUN_APPLICATION_STATE_QA_TESTS === '1'
const app = appModule.default || appModule
const config = configModule.default || configModule
const { applyApplicationTransition } = stateModule
const { assertQaDatabase, resetBusinessData, seed } = qaDatabase

describe.skipIf(!enabled)('QA real MySQL application state', () => {
  let prisma
  let connectionA
  let connectionB
  let fixture

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    connectionA = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    connectionB = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    globalThis.__JOB_CONNECT_TEST_PRISMA__ = prisma
    await Promise.all([assertQaDatabase(prisma), assertQaDatabase(connectionA), assertQaDatabase(connectionB)])
  }, 30_000)

  beforeEach(async () => {
    await resetBusinessData(prisma)
    fixture = await seed(prisma)
    globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__ = vi.fn().mockResolvedValue(undefined)
  }, 30_000)

  afterAll(async () => {
    delete globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__
    delete globalThis.__JOB_CONNECT_TEST_PRISMA__
    await Promise.all([prisma?.$disconnect(), connectionA?.$disconnect(), connectionB?.$disconnect()])
  })

  async function createApplication(jobId = fixture.baseJobId) {
    return prisma.application.create({
      data: {
        candidateId: fixture.candidateId,
        jobId,
        history: { create: { toStatus: 'APPLIED' } },
      },
    })
  }

  async function candidateUserId() {
    return (await prisma.candidate.findUnique({ where: { id: fixture.candidateId }, select: { userId: true } })).userId
  }

  async function recruiterUserId() {
    return (await prisma.recruiter.findFirst({ where: { companyId: fixture.companyId }, select: { userId: true } })).userId
  }

  async function executeTransition(database, application, targetStatus, actor, notificationUserId, mailer = vi.fn()) {
    const result = await database.$transaction(async (transaction) => {
      const transition = await applyApplicationTransition(transaction, { application, targetStatus, actor })
      if (!transition.changed) return transition
      await transaction.applicationStatusHistory.create({
        data: { applicationId: application.id, fromStatus: application.status, toStatus: targetStatus },
      })
      await transaction.notification.create({
        data: {
          userId: notificationUserId,
          type: 'APPLICATION_STATUS_CHANGED',
          title: 'QA application transition',
          content: `${application.status} -> ${targetStatus}`,
        },
      })
      return transition
    })
    if (result.changed) await mailer()
    return result
  }

  it('allows only one of two independently connected recruiter transitions to commit', async () => {
    const application = await createApplication()
    const notifyUserId = await candidateUserId()
    const firstMailer = vi.fn().mockResolvedValue(undefined)
    const secondMailer = vi.fn().mockResolvedValue(undefined)
    let firstClaimed
    let releaseFirst
    const firstClaimedBarrier = new Promise((resolve) => { firstClaimed = resolve })
    const releaseFirstBarrier = new Promise((resolve) => { releaseFirst = resolve })

    const first = connectionA.$transaction(async (transaction) => {
      const transition = await applyApplicationTransition(transaction, { application, targetStatus: 'REVIEWING', actor: 'RECRUITER' })
      await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: 'APPLIED', toStatus: 'REVIEWING' } })
      await transaction.notification.create({ data: { userId: notifyUserId, type: 'APPLICATION_STATUS_CHANGED', title: 'QA winner', content: 'REVIEWING' } })
      firstClaimed()
      await releaseFirstBarrier
      return transition
    }).then(async (transition) => { await firstMailer(); return transition })

    await firstClaimedBarrier
    let secondAttempted
    const secondAttemptedBarrier = new Promise((resolve) => { secondAttempted = resolve })
    const second = connectionB.$transaction(async (transaction) => {
      const claim = applyApplicationTransition(transaction, { application, targetStatus: 'SHORTLISTED', actor: 'RECRUITER' })
      secondAttempted()
      const transition = await claim
      await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: 'APPLIED', toStatus: 'SHORTLISTED' } })
      await transaction.notification.create({ data: { userId: notifyUserId, type: 'APPLICATION_STATUS_CHANGED', title: 'QA loser', content: 'SHORTLISTED' } })
      return transition
    }).then(async (transition) => { await secondMailer(); return transition })

    await secondAttemptedBarrier
    releaseFirst()
    const [firstResult, secondResult] = await Promise.allSettled([first, second])

    expect(firstResult.status).toBe('fulfilled')
    expect(secondResult.status).toBe('rejected')
    expect(secondResult.reason).toMatchObject({ statusCode: 409 })
    expect((await prisma.application.findUnique({ where: { id: application.id } })).status).toBe('REVIEWING')
    expect(await prisma.applicationStatusHistory.count({ where: { applicationId: application.id, fromStatus: { not: null } } })).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'APPLICATION_STATUS_CHANGED' } })).toBe(1)
    expect(firstMailer).toHaveBeenCalledOnce()
    expect(secondMailer).not.toHaveBeenCalled()

    const current = await prisma.application.findUnique({ where: { id: application.id } })
    const duplicateMailer = vi.fn()
    const duplicate = await executeTransition(connectionA, current, 'REVIEWING', 'RECRUITER', notifyUserId, duplicateMailer)
    expect(duplicate.changed).toBe(false)
    expect(await prisma.applicationStatusHistory.count({ where: { applicationId: application.id, fromStatus: { not: null } } })).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'APPLICATION_STATUS_CHANGED' } })).toBe(1)
    expect(duplicateMailer).not.toHaveBeenCalled()
  }, 30_000)

  it('serializes candidate withdrawal against a recruiter update', async () => {
    const application = await createApplication()
    const candidateNotificationUser = await candidateUserId()
    const recruiterNotificationUser = await recruiterUserId()
    let recruiterClaimed
    let releaseRecruiter
    const recruiterClaimedBarrier = new Promise((resolve) => { recruiterClaimed = resolve })
    const releaseRecruiterBarrier = new Promise((resolve) => { releaseRecruiter = resolve })

    const recruiter = connectionA.$transaction(async (transaction) => {
      const transition = await applyApplicationTransition(transaction, { application, targetStatus: 'REVIEWING', actor: 'RECRUITER' })
      await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: 'APPLIED', toStatus: 'REVIEWING' } })
      await transaction.notification.create({ data: { userId: candidateNotificationUser, type: 'APPLICATION_STATUS_CHANGED', title: 'Recruiter won', content: 'REVIEWING' } })
      recruiterClaimed()
      await releaseRecruiterBarrier
      return transition
    })

    await recruiterClaimedBarrier
    let withdrawalAttempted
    const withdrawalAttemptedBarrier = new Promise((resolve) => { withdrawalAttempted = resolve })
    const withdrawal = connectionB.$transaction(async (transaction) => {
      const claim = applyApplicationTransition(transaction, { application, targetStatus: 'WITHDRAWN', actor: 'CANDIDATE' })
      withdrawalAttempted()
      const transition = await claim
      await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: 'APPLIED', toStatus: 'WITHDRAWN' } })
      await transaction.notification.create({ data: { userId: recruiterNotificationUser, type: 'APPLICATION_STATUS_CHANGED', title: 'Candidate withdrew', content: 'WITHDRAWN' } })
      return transition
    })

    await withdrawalAttemptedBarrier
    releaseRecruiter()
    const [, withdrawalResult] = await Promise.allSettled([recruiter, withdrawal])

    expect(withdrawalResult.status).toBe('rejected')
    expect(withdrawalResult.reason).toMatchObject({ statusCode: 409 })
    expect((await prisma.application.findUnique({ where: { id: application.id } })).status).toBe('REVIEWING')
    expect(await prisma.applicationStatusHistory.count({ where: { applicationId: application.id, fromStatus: { not: null } } })).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'APPLICATION_STATUS_CHANGED' } })).toBe(1)
  }, 30_000)

  it('rolls back an entire bulk reject when one application is stale', async () => {
    const first = await createApplication()
    const secondJob = await prisma.job.create({
      data: { companyId: fixture.companyId, title: 'QA bulk second job', description: 'QA-only bulk rollback fixture.', status: 'PUBLISHED' },
    })
    const second = await createApplication(secondJob.id)
    const snapshots = await prisma.application.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } })
    await prisma.application.update({ where: { id: second.id }, data: { status: 'REVIEWING' } })
    const notifyUserId = await candidateUserId()

    await expect(connectionA.$transaction(async (transaction) => {
      for (const application of snapshots) {
        const transition = await applyApplicationTransition(transaction, { application, targetStatus: 'REJECTED', actor: 'RECRUITER' })
        if (!transition.changed) continue
        await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: 'REJECTED' } })
        await transaction.notification.create({ data: { userId: notifyUserId, type: 'APPLICATION_STATUS_CHANGED', title: 'Bulk reject', content: String(application.id) } })
      }
    })).rejects.toMatchObject({ statusCode: 409 })

    expect((await prisma.application.findUnique({ where: { id: first.id } })).status).toBe('APPLIED')
    expect((await prisma.application.findUnique({ where: { id: second.id } })).status).toBe('REVIEWING')
    expect(await prisma.applicationStatusHistory.count({ where: { applicationId: first.id, fromStatus: { not: null } } })).toBe(0)
    expect(await prisma.notification.count({ where: { type: 'APPLICATION_STATUS_CHANGED' } })).toBe(0)
  }, 30_000)

  it('requires expectedStatus and keeps HTTP contracts safe with RBAC and SMTP failure after commit', async () => {
    const application = await createApplication()
    const recruiter = await prisma.user.findUnique({ where: { id: fixture.users.recruiter } })
    const token = jwt.sign(
      { userId: recruiter.id, role: recruiter.role, tokenVersion: recruiter.tokenVersion },
      config.jwtSecret,
      { algorithm: 'HS256', expiresIn: '5m', issuer: config.jwtIssuer, audience: config.jwtAudience, subject: String(recruiter.id) },
    )
    const authorization = { Authorization: `Bearer ${token}` }
    const mailer = vi.fn().mockRejectedValue(new Error('controlled QA SMTP failure'))
    globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__ = mailer
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const committed = await request(app).patch(`/api/applications/${application.id}/status`)
      .set(authorization)
      .send({ status: 'REVIEWING', expectedStatus: 'APPLIED' })
    expect(committed.status).toBe(200)
    expect(committed.body.data.status).toBe('REVIEWING')
    expect((await prisma.application.findUnique({ where: { id: application.id } })).status).toBe('REVIEWING')

    const stale = await request(app).patch(`/api/applications/${application.id}/status`)
      .set(authorization)
      .send({ status: 'SHORTLISTED', expectedStatus: 'APPLIED' })
    expect(stale.status).toBe(409)
    expect(mailer).toHaveBeenCalledOnce()

    const secondJob = await prisma.job.create({ data: { companyId: fixture.companyId, title: 'QA required expected status', description: 'QA-only required expectedStatus fixture.', status: 'PUBLISHED' } })
    const withoutExpected = await createApplication(secondJob.id)
    const rejectedWithoutExpected = await request(app).patch(`/api/applications/${withoutExpected.id}/status`)
      .set(authorization)
      .send({ status: 'REVIEWING' })
    expect(rejectedWithoutExpected.status).toBe(400)
    expect((await prisma.application.findUnique({ where: { id: withoutExpected.id } })).status).toBe('APPLIED')
    const safeWithExpected = await request(app).patch(`/api/applications/${withoutExpected.id}/status`)
      .set(authorization)
      .send({ status: 'REVIEWING', expectedStatus: 'APPLIED' })
    expect(safeWithExpected.status).toBe(200)

    const foreignUser = await prisma.user.create({ data: { email: 'foreign-recruiter@jobconnect.local', passwordHash: 'not-used', fullName: 'Foreign Recruiter', role: 'RECRUITER' } })
    const foreignCompany = await prisma.company.create({ data: { name: 'Foreign QA Company' } })
    await prisma.recruiter.create({ data: { userId: foreignUser.id, companyId: foreignCompany.id } })
    const foreignToken = jwt.sign(
      { userId: foreignUser.id, role: foreignUser.role, tokenVersion: foreignUser.tokenVersion },
      config.jwtSecret,
      { algorithm: 'HS256', expiresIn: '5m', issuer: config.jwtIssuer, audience: config.jwtAudience, subject: String(foreignUser.id) },
    )
    const forbidden = await request(app).patch(`/api/applications/${withoutExpected.id}/status`)
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({ status: 'SHORTLISTED', expectedStatus: 'REVIEWING' })
    expect(forbidden.status).toBe(403)
    expect((await prisma.application.findUnique({ where: { id: withoutExpected.id } })).status).toBe('REVIEWING')
    expect(await prisma.applicationStatusHistory.count({ where: { applicationId: application.id, fromStatus: { not: null } } })).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'APPLICATION_STATUS_CHANGED' } })).toBe(2)
    warning.mockRestore()
  }, 30_000)
})
