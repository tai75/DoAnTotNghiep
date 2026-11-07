import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import qaDatabase from '../../scripts/qa01-db.cjs'

const enabled = process.env.RUN_INVITATION_QA_TESTS === '1'
const { assertQaDatabase, resetBusinessData, seed } = qaDatabase

describe.skipIf(!enabled)('QA real MySQL talent invitation concurrency', () => {
  let prisma, connectionA, connectionB, fixture

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    connectionA = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    connectionB = new PrismaClient({ datasourceUrl: process.env.QA01_DATABASE_URL })
    await Promise.all([assertQaDatabase(prisma), assertQaDatabase(connectionA), assertQaDatabase(connectionB)])
  }, 30_000)

  beforeEach(async () => {
    await resetBusinessData(prisma)
    fixture = await seed(prisma)
  }, 30_000)

  afterAll(async () => Promise.all([prisma?.$disconnect(), connectionA?.$disconnect(), connectionB?.$disconnect()]))

  it('allows only one concurrent accept/decline claim and creates one response notification', async () => {
    const invitation = await prisma.talentInvitation.create({ data: { candidateId: fixture.candidateId, recruiterUserId: fixture.users.recruiter, jobId: fixture.baseJobId, message: 'QA invitation' } })
    const respond = (database, status) => database.$transaction(async (transaction) => {
      const claim = await transaction.talentInvitation.updateMany({ where: { id: invitation.id, candidateId: fixture.candidateId, status: 'PENDING' }, data: { status, respondedAt: new Date() } })
      if (!claim.count) return { changed: false, status: (await transaction.talentInvitation.findUnique({ where: { id: invitation.id } })).status }
      await transaction.notification.create({ data: { userId: fixture.users.recruiter, type: 'TALENT_INVITATION_RESPONSE', title: `QA ${status}`, content: 'QA isolated concurrency response' } })
      return { changed: true, status }
    })

    const results = await Promise.all([respond(connectionA, 'ACCEPTED'), respond(connectionB, 'DECLINED')])
    expect(results.filter((result) => result.changed)).toHaveLength(1)
    expect(results.filter((result) => !result.changed)).toHaveLength(1)
    expect(await prisma.notification.count({ where: { userId: fixture.users.recruiter, type: 'TALENT_INVITATION_RESPONSE' } })).toBe(1)
    expect((await prisma.talentInvitation.findUnique({ where: { id: invitation.id } })).status).toBe(results.find((result) => result.changed).status)
  })
})
