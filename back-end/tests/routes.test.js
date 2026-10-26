import express from 'express'
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

describe('route validation and authentication safeguards', () => {
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
})
