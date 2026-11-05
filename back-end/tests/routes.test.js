import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import request from 'supertest'

process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/job_connect'
process.env.JWT_SECRET = 'test-secret'
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:3000'

const appModule = await import('../src/app.js')
const app = appModule.default || appModule
const jobsRoutesModule = await import('../src/routes/jobs.routes.js')
const jobsRoutes = jobsRoutesModule.default || jobsRoutesModule
const authRoutesModule = await import('../src/routes/auth.routes.js')
const authRoutes = authRoutesModule.default || authRoutesModule
const candidatesRoutesModule = await import('../src/routes/candidates.routes.js')
const candidatesRoutes = candidatesRoutesModule.default || candidatesRoutesModule
const applicationsRoutesModule = await import('../src/routes/applications.routes.js')
const applicationsRoutes = applicationsRoutesModule.default || applicationsRoutesModule
const conversationsRoutesModule = await import('../src/routes/conversations.routes.js')
const conversationsRoutes = conversationsRoutesModule.default || conversationsRoutesModule

function createMinimalDocxBuffer() {
  const names = ['[Content_Types].xml', 'word/document.xml']
  const localParts = []
  const centralParts = []
  names.forEach((name) => {
    const nameBuffer = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(nameBuffer.length, 26)
    localParts.push(local, nameBuffer)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(nameBuffer.length, 28)
    centralParts.push(central, nameBuffer)
  })
  return Buffer.concat([...localParts, ...centralParts, Buffer.from('PK\x05\x06')])
}

describe('route validation and authentication safeguards', () => {
  it('strips HTML from conversation messages', () => {
    expect(conversationsRoutes.stripHtml('<b>Hello</b> &amp; welcome')).toBe('Hello & welcome')
  })
  it('accepts typed screening answers for applications', () => {
    const result = applicationsRoutes.applySchema.safeParse({
      body: {
        resumeId: '4',
        answers: [
          { questionId: 1, answer: true },
          { questionId: 2, answer: 3 },
          { questionId: 3, answer: 'Remote' }
        ]
      },
      params: { jobId: '2' },
      query: {}
    })

    expect(result.success).toBe(true)
    expect(result.data.body.answers.map((answer) => answer.answer)).toEqual(['true', '3', 'Remote'])
  })

  it('calculates candidate completeness from the required profile criteria', () => {
    const completeProfile = candidatesRoutes.buildCompleteness({
      headline: 'Backend developer',
      bio: 'Experienced developer',
      desiredPosition: 'Backend developer',
      desiredSalary: '2000',
      desiredLocation: 'Da Nang',
      skills: [{ skillId: 1 }, { skillId: 2 }, { skillId: 3 }, { skillId: 4 }, { skillId: 5 }],
      educations: [{ id: 1 }],
      experiences: [],
      projects: [{ id: 1 }],
      resumes: [{ isDefault: true }]
    })

    expect(completeProfile.percentage).toBe(100)
    expect(completeProfile.missing).toHaveLength(0)
  })

  it('returns stable missing checklist targets for incomplete profiles', () => {
    const incompleteProfile = candidatesRoutes.buildCompleteness({
      headline: null,
      bio: null,
      desiredPosition: null,
      desiredSalary: null,
      desiredLocation: null,
      skills: [],
      educations: [],
      experiences: [],
      projects: [],
      resumes: [{ isDefault: false }]
    })

    expect(incompleteProfile.percentage).toBe(0)
    expect(incompleteProfile.missing.map((item) => item.id)).toEqual([
      'headline',
      'bio',
      'skills',
      'education',
      'experienceOrProject',
      'defaultResume',
      'desiredPosition',
      'desiredSalary',
      'desiredLocation'
    ])
    expect(incompleteProfile.missing.find((item) => item.id === 'skills').tab).toBe('skills')
  })

  it('rejects invalid job and company IDs with 400', async () => {
    const [jobResponse, companyResponse] = await Promise.all([
      request(app).get('/api/jobs/not-a-number'),
      request(app).get('/api/companies/not-a-number')
    ])

    expect(jobResponse.status).toBe(400)
    expect(companyResponse.status).toBe(400)
  })

  it('validates salary order and future deadlines for jobs', () => {
    const result = jobsRoutes.schemas.jobSchema.safeParse({
      body: {
        title: 'Backend Engineer',
        description: 'Build and maintain backend services for the platform.',
        minSalary: 3000,
        maxSalary: 2000,
        deadline: '2020-01-01T00:00:00.000Z',
        employmentType: 'FULL_TIME',
        skillIds: []
      },
      params: {},
      query: {}
    })

    expect(result.success).toBe(false)
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'maxSalary phải lớn hơn hoặc bằng minSalary',
        'deadline phải ở tương lai'
      ])
    )
  })

  it('accepts only the supported employment type enum', () => {
    const result = jobsRoutes.schemas.jobSchema.safeParse({
      body: {
        title: 'Backend Engineer',
        description: 'Build and maintain backend services for the platform.',
        employmentType: 'TEMPORARY',
        skillIds: []
      },
      params: {},
      query: {}
    })

    expect(result.success).toBe(false)
  })

  it('accepts public job listing filters for posting age and applicant count', () => {
    const result = jobsRoutes.schemas.listSchema.safeParse({
      body: {},
      params: {},
      query: { postedWithin: '7', maxApplicants: '10' }
    })

    expect(result.success).toBe(true)
    expect(result.data.query.postedWithin).toBe('7')
    expect(result.data.query.maxApplicants).toBe(10)
  })

  it('rejects unsupported public job listing filter values', () => {
    const result = jobsRoutes.schemas.listSchema.safeParse({
      body: {},
      params: {},
      query: { postedWithin: '2', maxApplicants: '-1' }
    })

    expect(result.success).toBe(false)
  })

  it('rate limits authentication endpoints', async () => {
    const limiterApp = express()
    limiterApp.use(express.json())
    limiterApp.post('/', authRoutes.authRateLimit, (req, res) => res.json({ success: true }))

    const responses = []
    for (let index = 0; index < 11; index += 1) {
      responses.push(await request(limiterApp).post('/').send({}))
    }

    expect(responses.slice(0, 10).every((response) => response.status === 200)).toBe(true)
    expect(responses[10].status).toBe(429)
  })

  it('uses a stricter limiter for password reset requests', async () => {
    const limiterApp = express()
    limiterApp.use(express.json())
    limiterApp.post('/', authRoutes.passwordResetRequestRateLimit, (req, res) => res.json({ success: true }))

    const responses = []
    for (let index = 0; index < 6; index += 1) responses.push(await request(limiterApp).post('/').send({}))

    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true)
    expect(responses[5].status).toBe(429)
  })

  it('validates resume signatures and published saved jobs', () => {
    const filePath = path.join(os.tmpdir(), `job-connect-signature-${process.pid}.tmp`)
    try {
      fs.writeFileSync(filePath, Buffer.from('%PDF-1.7\n%%EOF'))
      expect(candidatesRoutes.hasValidSignature(filePath, '.pdf')).toBe(true)
      fs.writeFileSync(filePath, Buffer.from('not-a-pdf'))
      expect(candidatesRoutes.hasValidSignature(filePath, '.pdf')).toBe(false)
      fs.writeFileSync(filePath, createMinimalDocxBuffer())
      expect(candidatesRoutes.hasValidSignature(filePath, '.docx')).toBe(true)
      fs.writeFileSync(filePath, Buffer.from('PK\x03\x04rest'))
      expect(candidatesRoutes.hasValidSignature(filePath, '.docx')).toBe(false)
      expect(candidatesRoutes.canSaveJob({ status: 'PUBLISHED' })).toBe(true)
      expect(candidatesRoutes.canSaveJob({ status: 'PENDING' })).toBe(false)
      expect(candidatesRoutes.canSaveJob(null)).toBe(false)
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
  })

  it('accepts only http and https URLs for profile links', () => {
    expect(candidatesRoutes.httpUrl.safeParse('https://example.com/cv').success).toBe(true)
    expect(candidatesRoutes.httpUrl.safeParse('http://example.com/project').success).toBe(true)
    expect(candidatesRoutes.httpUrl.safeParse('ftp://example.com/cv').success).toBe(false)
  })
})
