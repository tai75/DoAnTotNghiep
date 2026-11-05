import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import workerModule from '../../src/jobs/alertWorker.js'
import qaDatabase from '../../scripts/qa01-db.cjs'

const enabled = process.env.RUN_ALERT_QA_TESTS === '1'
const {
  runAlertWorker, reserveAlertEvent, claimNextEvent, deliverClaimedEvent, recoverExpiredLeases,
} = workerModule
const { assertQaDatabase, resetBusinessData, seed } = qaDatabase

describe.skipIf(!enabled)('QA durable job alert outbox', () => {
  let prisma
  let fixture

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    await assertQaDatabase(prisma)
  })

  beforeEach(async () => {
    await resetBusinessData(prisma)
    fixture = await seed(prisma)
  }, 30_000)

  afterAll(async () => prisma?.$disconnect())

  async function scenario({ active = true, keyword = 'durable-alert-match' } = {}) {
    const alert = await prisma.jobAlert.create({
      data: { candidateId: fixture.candidateId, name: 'Durable QA alert', keyword, skillIds: [], frequency: 'DAILY', isActive: active },
      include: { candidate: { include: { user: { select: { id: true, email: true } } } } },
    })
    const matching = await prisma.job.create({
      data: {
        companyId: fixture.companyId, title: 'Durable alert match', description: 'durable-alert-match synthetic job',
        status: 'PUBLISHED', deadline: new Date(Date.now() + 86_400_000),
      },
      include: { company: { select: { name: true } }, skills: { select: { skillId: true } } },
    })
    await prisma.job.create({
      data: { companyId: fixture.companyId, title: 'Unrelated QA job', description: 'must not match the alert', status: 'PUBLISHED', deadline: new Date(Date.now() + 86_400_000) },
    })
    return { alert, matching, now: new Date(Date.now() + 2_000) }
  }

  function successfulMailer() {
    return vi.fn(async ({ to }) => ({ messageId: 'qa-provider-message', accepted: [to], rejected: [] }))
  }

  it('runs once, reruns idempotently, respects preferences and excludes ineligible jobs', async () => {
    const { now } = await scenario()
    await prisma.jobAlert.create({
      data: {
        candidateId: fixture.candidateId,
        name: 'Disabled QA alert',
        keyword: 'durable-alert-match',
        skillIds: [],
        frequency: 'DAILY',
        isActive: false,
      },
    })
    const mailer = successfulMailer()
    expect(await runAlertWorker(now, { database: prisma, mailer, workerId: 'once-a' })).toBe(1)
    expect(await runAlertWorker(now, { database: prisma, mailer, workerId: 'once-b' })).toBe(0)
    expect(await prisma.jobAlertEvent.count()).toBe(1)
    expect(await prisma.jobAlertEventJob.count()).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'JOB_ALERT' } })).toBe(1)
    expect(mailer).toHaveBeenCalledOnce()
  })

  it('allows only one of two concurrent workers to deliver the same event', async () => {
    const { now } = await scenario()
    const mailer = successfulMailer()
    const results = await Promise.all([
      runAlertWorker(now, { database: prisma, mailer, workerId: 'concurrent-a' }),
      runAlertWorker(now, { database: prisma, mailer, workerId: 'concurrent-b' }),
    ])
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(await prisma.jobAlertEvent.count()).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'JOB_ALERT' } })).toBe(1)
    expect(mailer).toHaveBeenCalledOnce()
  })

  it('rolls back event, reservations and notification when the outbox transaction fails', async () => {
    const { alert, matching, now } = await scenario()
    const failingDatabase = {
      $transaction: (work) => prisma.$transaction((transaction) => work(new Proxy(transaction, {
        get(target, property, receiver) {
          if (property !== 'notification') return Reflect.get(target, property, receiver)
          return new Proxy(Reflect.get(target, property, receiver), {
            get(model, method, modelReceiver) {
              if (method === 'create') return async () => { throw new Error('controlled notification database failure') }
              return Reflect.get(model, method, modelReceiver)
            },
          })
        },
      }))),
    }
    await expect(reserveAlertEvent(alert, [matching], new Date(now.getTime() - 86_400_000), now, failingDatabase)).rejects.toThrow('controlled notification database failure')
    expect(await prisma.jobAlertEvent.count()).toBe(0)
    expect(await prisma.jobAlertEventJob.count()).toBe(0)
    expect(await prisma.notification.count({ where: { type: 'JOB_ALERT' } })).toBe(0)
    expect(await prisma.job.count({ where: { id: matching.id } })).toBe(1)
  })

  it('recovers a crash after commit and before email without duplicating the notification', async () => {
    const { alert, matching, now } = await scenario()
    await reserveAlertEvent(alert, [matching], new Date(now.getTime() - 86_400_000), now, prisma)
    expect(await prisma.notification.count({ where: { type: 'JOB_ALERT' } })).toBe(1)
    const mailer = successfulMailer()
    expect(await runAlertWorker(now, { database: prisma, mailer, workerId: 'restart-worker' })).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'JOB_ALERT' } })).toBe(1)
    expect(mailer).toHaveBeenCalledOnce()
  })

  it('retries transient failures with bounded backoff and later marks provider-confirmed success', async () => {
    const { now } = await scenario()
    const transient = vi.fn(async () => { const error = new Error('temporary'); error.code = 'EAI_AGAIN'; throw error })
    expect(await runAlertWorker(now, { database: prisma, mailer: transient, workerId: 'retry-a' })).toBe(0)
    let event = await prisma.jobAlertEvent.findFirst()
    expect(event).toMatchObject({ status: 'PENDING', emailStatus: 'PENDING', retryCount: 1, lastErrorCode: 'EAI_AGAIN' })
    expect(event.nextRetryAt.getTime()).toBe(now.getTime() + 60_000)
    const success = successfulMailer()
    expect(await runAlertWorker(new Date(now.getTime() + 30_000), { database: prisma, mailer: success, workerId: 'retry-early' })).toBe(0)
    expect(await runAlertWorker(new Date(now.getTime() + 61_000), { database: prisma, mailer: success, workerId: 'retry-later' })).toBe(1)
    event = await prisma.jobAlertEvent.findFirst()
    expect(event).toMatchObject({ status: 'COMPLETED', emailStatus: 'SENT', providerMessageId: 'qa-provider-message' })
  })

  it('marks permanent failures FAILED and timeout outcomes UNKNOWN without automatic retry', async () => {
    let current = await scenario()
    const permanent = vi.fn(async () => { const error = new Error('rejected'); error.responseCode = 550; throw error })
    await runAlertWorker(current.now, { database: prisma, mailer: permanent, workerId: 'permanent' })
    expect(await prisma.jobAlertEvent.findFirst()).toMatchObject({ status: 'FAILED', emailStatus: 'FAILED' })

    await resetBusinessData(prisma); fixture = await seed(prisma); current = await scenario()
    const timeout = vi.fn(async () => { const error = new Error('timeout'); error.code = 'ETIMEDOUT'; throw error })
    await runAlertWorker(current.now, { database: prisma, mailer: timeout, workerId: 'timeout' })
    expect(await prisma.jobAlertEvent.findFirst()).toMatchObject({ status: 'FAILED', emailStatus: 'UNKNOWN' })
    await runAlertWorker(new Date(current.now.getTime() + 86_400_000), { database: prisma, mailer: successfulMailer(), workerId: 'unknown-no-retry' })
    expect(timeout).toHaveBeenCalledOnce()
  })

  it('quarantines a provider-confirmed email when persisting SENT fails', async () => {
    const { now } = await scenario()
    const eventMailer = successfulMailer()
    await runAlertWorker(now, {
      database: new Proxy(prisma, {
        get(target, property, receiver) {
          if (property !== 'jobAlertEvent') return Reflect.get(target, property, receiver)
          return new Proxy(target.jobAlertEvent, {
            get(model, method, modelReceiver) {
              if (method === 'updateMany') {
                return async (args) => {
                  if (args.data?.emailStatus === 'SENT') throw new Error('controlled SENT persistence failure')
                  return model.updateMany(args)
                }
              }
              return Reflect.get(model, method, modelReceiver)
            },
          })
        },
      }),
      mailer: eventMailer,
      workerId: 'sent-write-failure',
    })
    expect(eventMailer).toHaveBeenCalledOnce()
    expect(await prisma.jobAlertEvent.findFirst()).toMatchObject({
      status: 'FAILED', emailStatus: 'UNKNOWN', lastErrorCode: 'EMAIL_SUCCESS_STATE_UNCONFIRMED',
    })
    await runAlertWorker(new Date(now.getTime() + 86_400_000), {
      database: prisma, mailer: eventMailer, workerId: 'sent-write-no-retry',
    })
    expect(eventMailer).toHaveBeenCalledOnce()
  })

  it('recovers pre-send lease expiry, quarantines in-flight expiry, and rejects stale workers', async () => {
    const { alert, matching, now } = await scenario()
    await reserveAlertEvent(alert, [matching], new Date(now.getTime() - 86_400_000), now, prisma)
    const claimedA = await claimNextEvent('lease-a', now, prisma)
    const afterLease = new Date(now.getTime() + 5 * 60 * 1000 + 1)
    expect(await recoverExpiredLeases(afterLease, prisma)).toMatchObject({ recovered: 1, unknown: 0 })
    const claimedB = await claimNextEvent('lease-b', afterLease, prisma)
    expect(claimedB.id).toBe(claimedA.id)
    expect(await deliverClaimedEvent(claimedA, 'lease-a', afterLease, prisma, successfulMailer())).toEqual({ status: 'stale' })
    expect(await deliverClaimedEvent(claimedB, 'lease-b', afterLease, prisma, successfulMailer())).toEqual({ status: 'sent' })

    await resetBusinessData(prisma); fixture = await seed(prisma); const second = await scenario()
    await reserveAlertEvent(second.alert, [second.matching], new Date(second.now.getTime() - 86_400_000), second.now, prisma)
    const inFlight = await claimNextEvent('lease-unknown', second.now, prisma)
    await prisma.jobAlertEvent.update({ where: { id: inFlight.id }, data: { emailStatus: 'PROCESSING' } })
    const recovery = await recoverExpiredLeases(new Date(second.now.getTime() + 5 * 60 * 1000 + 1), prisma)
    expect(recovery).toMatchObject({ recovered: 0, unknown: 1 })
    expect(await prisma.jobAlertEvent.findUnique({ where: { id: inFlight.id } })).toMatchObject({ status: 'FAILED', emailStatus: 'UNKNOWN' })
  })
})
