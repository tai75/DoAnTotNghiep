import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import limiterModule from '../../src/middleware/globalApiRateLimit.js'

const { createGlobalApiRateLimit } = limiterModule

describe('global API rate limiter', () => {
  it('keeps a finite window and rejects only after its configured capacity', async () => {
    const app = express()
    app.use('/api', createGlobalApiRateLimit(2))
    app.get('/api/health', (_req, res) => res.json({ success: true }))

    const first = await request(app).get('/api/health')
    const second = await request(app).get('/api/health')
    const rejected = await request(app).get('/api/health')

    expect(first.status).toBe(200)
    expect(first.headers['ratelimit-limit']).toBe('2')
    expect(second.status).toBe(200)
    expect(rejected.status).toBe(429)
    expect(rejected.body).toEqual({ success: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' })
  })
})
