import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import jobWriteService from '../../src/services/jobWrite.service.js'
import e2eDatabase from '../../scripts/e2e-db.cjs'

const enabled = process.env.RUN_E2E_JOB_WRITE_TESTS === '1'
const { createJobAtomic, updateJobAtomic } = jobWriteService
const { assertCanonicalDatabase, resetBusinessData, seed } = e2eDatabase

function withInjectedFailure(prisma, modelName, methodName) {
  return {
    $transaction: (work) => prisma.$transaction((transaction) => work(new Proxy(transaction, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (property !== modelName) return value
        return new Proxy(value, {
          get(model, method, modelReceiver) {
            if (method === methodName) return async () => { throw new Error(`controlled ${modelName}.${methodName} failure`) }
            return Reflect.get(model, method, modelReceiver)
          },
        })
      },
    }))),
  }
}

describe.skipIf(!enabled)('QA database atomic job writes', () => {
  let prisma
  let fixture
  let skillIds

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL })
    await assertCanonicalDatabase(prisma)
    await resetBusinessData(prisma)
    fixture = await seed(prisma)
    skillIds = (await prisma.skill.findMany({ orderBy: { id: 'asc' }, take: 3 })).map((skill) => skill.id)
  }, 30_000)

  afterAll(async () => prisma?.$disconnect())

  it('commits job, required skills and screening questions together', async () => {
    const job = await createJobAtomic(prisma, {
      companyId: fixture.companyId,
      jobData: { title: 'DATA-01 create success', description: 'Atomic create success fixture for the QA database.', status: 'DRAFT' },
      skillIds: skillIds.slice(0, 2), requiredSkills: [skillIds[0]],
      screeningQuestions: [{ type: 'TEXT', question: 'Describe relevant experience', isRequired: true, isKnockout: false }],
    })
    const stored = await prisma.job.findUnique({ where: { id: job.id }, include: { skills: true, screeningQuestions: true } })
    expect(stored.skills).toHaveLength(2)
    expect(stored.skills.find((skill) => skill.skillId === skillIds[0]).isRequired).toBe(true)
    expect(stored.skills.find((skill) => skill.skillId === skillIds[1]).isRequired).toBe(false)
    expect(stored.screeningQuestions).toHaveLength(1)
  })

  it('rolls back the job when a required skill relation fails', async () => {
    const title = 'DATA-01 invalid skill rollback'
    await expect(createJobAtomic(prisma, {
      companyId: fixture.companyId,
      jobData: { title, description: 'This job must be rolled back after the invalid skill connect.', status: 'DRAFT' },
      skillIds: [2147483647], requiredSkills: [2147483647], screeningQuestions: [],
    })).rejects.toBeTruthy()
    expect(await prisma.job.count({ where: { title } })).toBe(0)
  })

  it('rolls back job and skills when screening question persistence fails', async () => {
    const title = 'DATA-01 question rollback'
    const failingDatabase = withInjectedFailure(prisma, 'jobScreeningQuestion', 'createMany')
    await expect(createJobAtomic(failingDatabase, {
      companyId: fixture.companyId,
      jobData: { title, description: 'The controlled final write failure must roll back the full create.', status: 'DRAFT' },
      skillIds: skillIds.slice(0, 2), requiredSkills: [skillIds[0]],
      screeningQuestions: [{ type: 'TEXT', question: 'Controlled failure', isRequired: false, isKnockout: false }],
    })).rejects.toThrow('controlled jobScreeningQuestion.createMany failure')
    expect(await prisma.job.count({ where: { title } })).toBe(0)
    expect(await prisma.jobSkill.count({ where: { job: { title } } })).toBe(0)
  })

  it('rolls back updated fields, replaced skills and deleted questions on the final write failure', async () => {
    const original = await createJobAtomic(prisma, {
      companyId: fixture.companyId,
      jobData: { title: 'DATA-01 update original', description: 'Original job state before controlled update rollback.', status: 'DRAFT' },
      skillIds: [skillIds[0]], requiredSkills: [skillIds[0]],
      screeningQuestions: [{ type: 'TEXT', question: 'Original question', isRequired: true, isKnockout: false }],
    })
    const failingDatabase = withInjectedFailure(prisma, 'jobScreeningQuestion', 'createMany')
    await expect(updateJobAtomic(failingDatabase, {
      jobId: original.id,
      jobData: { title: 'DATA-01 update should rollback' },
      skillIds: [skillIds[1], skillIds[2]], requiredSkills: [skillIds[2]],
      screeningQuestions: [{ type: 'YES_NO', question: 'Replacement question', isRequired: false, isKnockout: false }],
    })).rejects.toThrow('controlled jobScreeningQuestion.createMany failure')

    const stored = await prisma.job.findUnique({ where: { id: original.id }, include: { skills: true, screeningQuestions: true } })
    expect(stored.title).toBe('DATA-01 update original')
    expect(stored.skills.map((skill) => skill.skillId)).toEqual([skillIds[0]])
    expect(stored.screeningQuestions.map((question) => question.question)).toEqual(['Original question'])
  })

  it('commits a successful update with replacement skills and questions', async () => {
    const original = await createJobAtomic(prisma, {
      companyId: fixture.companyId,
      jobData: { title: 'DATA-01 update success original', description: 'Original fixture for successful atomic update.', status: 'DRAFT' },
      skillIds: [skillIds[0]], requiredSkills: [skillIds[0]], screeningQuestions: [],
    })
    await updateJobAtomic(prisma, {
      jobId: original.id,
      jobData: { title: 'DATA-01 update success committed' },
      skillIds: [skillIds[1], skillIds[2]], requiredSkills: [skillIds[2]],
      screeningQuestions: [{ type: 'YES_NO', question: 'Committed replacement question', isRequired: true, isKnockout: false }],
    })
    const stored = await prisma.job.findUnique({ where: { id: original.id }, include: { skills: { orderBy: { skillId: 'asc' } }, screeningQuestions: true } })
    expect(stored.title).toBe('DATA-01 update success committed')
    expect(stored.skills.map((skill) => skill.skillId).sort((a, b) => a - b)).toEqual([skillIds[1], skillIds[2]].sort((a, b) => a - b))
    expect(stored.screeningQuestions.map((question) => question.question)).toEqual(['Committed replacement question'])
  })
})
