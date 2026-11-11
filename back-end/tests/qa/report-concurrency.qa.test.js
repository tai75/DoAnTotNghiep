import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import reportsModule from '../../src/routes/reports.routes.js'
import adminModule from '../../src/routes/admin.routes.js'
import qaDatabase from '../../scripts/qa01-db.cjs'

const enabled = process.env.RUN_REPORT_QA_TESTS === '1'
const { createReportAtomic } = reportsModule
const { updateReportStatusAtomic } = adminModule
const { assertQaDatabase } = qaDatabase

describe.skipIf(!enabled)('QA MySQL atomic report concurrency', () => {
  let prisma
  const userIds = []
  const companyIds = []
  const reportIds = []
  const fixtures = {}

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    await assertQaDatabase(prisma)
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    for (const role of ['duplicate', 'hourly', 'other-a', 'other-b', 'lock', 'admin']) {
      const user = await prisma.user.create({ data: {
        email: `qa-report-${role}-${suffix}@example.test`, passwordHash: 'qa-report-not-a-login',
        fullName: `QA report ${role}`, role: role === 'admin' ? 'ADMIN' : 'CANDIDATE'
      } })
      fixtures[role] = user
      userIds.push(user.id)
    }
    for (let index = 0; index < 9; index += 1) {
      const company = await prisma.company.create({ data: { name: `QA report target ${index} ${suffix}`, status: 'ACTIVE' } })
      fixtures[`company-${index}`] = company
      companyIds.push(company.id)
    }
  }, 30_000)

  afterAll(async () => {
    if (!prisma) return
    const storedReports = await prisma.report.findMany({ where: { reporterUserId: { in: userIds } }, select: { id: true } })
    reportIds.push(...storedReports.map((item) => item.id))
    if (reportIds.length) await prisma.auditLog.deleteMany({ where: { entity: 'Report', entityId: { in: reportIds } } })
    if (userIds.length) await prisma.notification.deleteMany({ where: { userId: { in: userIds } } })
    if (userIds.length) await prisma.report.deleteMany({ where: { reporterUserId: { in: userIds } } })
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } })
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  }, 30_000)

  it('allows exactly one of fifty duplicate submissions', async () => {
    const input = {
      reporterUserId: fixtures.duplicate.id, targetType: 'COMPANY', targetId: fixtures['company-0'].id,
      reason: 'MISLEADING', description: 'Synthetic QA concurrency report'
    }
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => createReportAtomic(input, prisma)))
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((item) => item.status === 'rejected' && item.reason?.statusCode === 409)).toHaveLength(49)
    expect(await prisma.report.count({ where: { reporterUserId: fixtures.duplicate.id, companyId: fixtures['company-0'].id } })).toBe(1)
  }, 30_000)

  it('allows only five of six different targets in the same hour', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => createReportAtomic({
      reporterUserId: fixtures.hourly.id, targetType: 'COMPANY', targetId: fixtures[`company-${index + 1}`].id,
      reason: 'SPAM', description: `Synthetic hourly target ${index}`
    }, prisma)))
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter((item) => item.status === 'rejected' && item.reason?.statusCode === 429)).toHaveLength(1)
    expect(await prisma.report.count({ where: { reporterUserId: fixtures.hourly.id } })).toBe(5)
  }, 15_000)

  it('allows two reporters to report the same target', async () => {
    const targetId = fixtures['company-7'].id
    const results = await Promise.all([
      createReportAtomic({ reporterUserId: fixtures['other-a'].id, targetType: 'COMPANY', targetId, reason: 'FRAUD' }, prisma),
      createReportAtomic({ reporterUserId: fixtures['other-b'].id, targetType: 'COMPANY', targetId, reason: 'FRAUD' }, prisma)
    ])
    expect(results).toHaveLength(2)
    expect(await prisma.report.count({ where: { companyId: targetId, reporterUserId: { in: [fixtures['other-a'].id, fixtures['other-b'].id] } } })).toBe(2)
  })

  it('bounds a reporter row-lock wait and does not insert on timeout', async () => {
    let releaseLock
    let confirmLock
    const locked = new Promise((resolve) => { confirmLock = resolve })
    const release = new Promise((resolve) => { releaseLock = resolve })
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${fixtures.lock.id} FOR UPDATE`
      confirmLock()
      await release
    }, { maxWait: 1_000, timeout: 5_000 })
    await locked
    try {
      await expect(createReportAtomic({
        reporterUserId: fixtures.lock.id, targetType: 'COMPANY', targetId: fixtures['company-8'].id, reason: 'OTHER'
      }, prisma, { transactionOptions: { maxWait: 1_000, timeout: 250, isolationLevel: 'ReadCommitted' } }))
        .rejects.toMatchObject({ statusCode: 409 })
    } finally {
      releaseLock()
    }
    await holder
    expect(await prisma.report.count({ where: { reporterUserId: fixtures.lock.id } })).toBe(0)
  }, 10_000)

  it('rolls back an insert when the transaction aborts before commit', async () => {
    const rollbackClient = {
      $transaction: (work, options) => prisma.$transaction(async (transaction) => {
        await work(transaction)
        throw Object.assign(new Error('synthetic deadlock before commit'), { code: 'P2034' })
      }, options)
    }
    await expect(createReportAtomic({
      reporterUserId: fixtures.lock.id, targetType: 'COMPANY', targetId: fixtures['company-8'].id, reason: 'OTHER'
    }, rollbackClient)).rejects.toMatchObject({ statusCode: 409 })
    expect(await prisma.report.count({ where: { reporterUserId: fixtures.lock.id } })).toBe(0)
  })

  it('allows one moderation CAS winner with one audit and notification', async () => {
    const report = await prisma.report.create({ data: {
      reporterUserId: fixtures['other-a'].id, companyId: fixtures['company-8'].id,
      targetType: 'COMPANY', reason: 'OTHER', status: 'REVIEWING'
    } })
    reportIds.push(report.id)
    const input = {
      report, status: 'RESOLVED', normalizedNote: 'Synthetic QA concurrent moderation.',
      expectedUpdatedAt: report.updatedAt, adminUserId: fixtures.admin.id
    }
    const results = await Promise.allSettled([
      updateReportStatusAtomic(input, prisma), updateReportStatusAtomic(input, prisma)
    ])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((item) => item.status === 'rejected' && item.reason?.statusCode === 409)).toHaveLength(1)
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_STATUS_UPDATED', entity: 'Report', entityId: report.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: report.reporterUserId, type: 'REPORT_STATUS' } })).toBe(1)
  })
})
