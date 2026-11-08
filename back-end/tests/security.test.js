import express from 'express'
import fs from 'node:fs'
import jwt from 'jsonwebtoken'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { z } from 'zod'

process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/job_connect'
process.env.JWT_SECRET = 'test-secret'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d'

const appModule = await import('../src/app.js')
const app = appModule.default || appModule
const authRoutesModule = await import('../src/routes/auth.routes.js')
const authRoutes = authRoutesModule.default || authRoutesModule
const applicationsRoutesModule = await import('../src/routes/applications.routes.js')
const applicationsRoutes = applicationsRoutesModule.default || applicationsRoutesModule
const companiesRoutesModule = await import('../src/routes/companies.routes.js')
const companiesRoutes = companiesRoutesModule.default || companiesRoutesModule
const errorHandlerModule = await import('../src/middleware/errorHandler.js')
const errorHandler = errorHandlerModule.default || errorHandlerModule

function refreshDatabase(stored, claimedCount = 1) {
  const transaction = {
    refreshToken: {
      findUnique: vi.fn().mockResolvedValue(stored),
      updateMany: vi.fn().mockResolvedValue({ count: claimedCount }),
      create: vi.fn().mockResolvedValue({ id: 2 })
    },
    user: { update: vi.fn().mockResolvedValue({}) }
  }
  return {
    transaction,
    database: { $transaction: vi.fn((callback) => callback(transaction)) }
  }
}

describe('security hardening', () => {
  it('rejects an untrusted CORS origin and allows the configured origin', async () => {
    const [blocked, allowed] = await Promise.all([
      request(app).get('/api/health').set('Origin', 'https://attacker.example'),
      request(app).get('/api/health').set('Origin', 'http://localhost:5173')
    ])
    expect(blocked.status).toBe(403)
    expect(allowed.status).toBe(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('sets hardened refresh-cookie options from the configured TTL', () => {
    expect(authRoutes.durationToMs('7d')).toBe(7 * 24 * 60 * 60 * 1000)
    expect(authRoutes.refreshCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })
  })

  it('rejects JWTs signed with an algorithm outside the allowlist', async () => {
    const token = jwt.sign(
      { userId: 1, role: 'ADMIN', tokenVersion: 0 },
      process.env.JWT_SECRET,
      { algorithm: 'HS384', issuer: 'job-connect-api', audience: 'job-connect-web', subject: '1' }
    )
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(401)
  })

  it('rotates a refresh token with an atomic one-time claim', async () => {
    const stored = {
      id: 1,
      userId: 7,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 7, role: 'CANDIDATE', status: 'ACTIVE', tokenVersion: 0 }
    }
    const { database, transaction } = refreshDatabase(stored, 1)
    const result = await authRoutes.rotateRefreshToken('old-refresh-token', database, new Date())
    expect(result.status).toBe('ok')
    expect(result.refreshToken).not.toBe('old-refresh-token')
    expect(transaction.refreshToken.create).toHaveBeenCalledOnce()
    expect(transaction.user.update).not.toHaveBeenCalled()
  })

  it('treats a failed refresh-token claim as replay and revokes the user session family', async () => {
    const stored = {
      id: 1,
      userId: 7,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 7, role: 'CANDIDATE', status: 'ACTIVE', tokenVersion: 0 }
    }
    const { database, transaction } = refreshDatabase(stored, 0)
    const result = await authRoutes.rotateRefreshToken('replayed-refresh-token', database, new Date())
    expect(result.status).toBe('replay')
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledTimes(2)
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { tokenVersion: { increment: 1 } }
    })
    expect(transaction.refreshToken.create).not.toHaveBeenCalled()
  })

  it('does not expose recruiter-only notes in the candidate application view', () => {
    const application = { id: 1, status: 'APPLIED', notes: [{ id: 9, content: 'internal' }] }
    expect(applicationsRoutes.applicationForViewer(application, true)).toEqual({ id: 1, status: 'APPLIED' })
    expect(applicationsRoutes.applicationForViewer(application, false)).toBe(application)
  })

  it('rejects logo content whose signature does not match its declared image type', () => {
    const filePath = path.join(os.tmpdir(), `job-connect-logo-${process.pid}.tmp`)
    try {
      fs.writeFileSync(filePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
      expect(companiesRoutes.hasValidLogoSignature(filePath, 'image/png')).toBe(true)
      fs.writeFileSync(filePath, Buffer.from('<script>alert(1)</script>'))
      expect(companiesRoutes.hasValidLogoSignature(filePath, 'image/png')).toBe(false)
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
  })

  it('returns generic 500 errors but preserves safe validation details', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const testApp = express()
    testApp.get('/internal', () => { throw new Error('database password appeared here') })
    testApp.get('/validation', () => z.object({ id: z.number() }).parse({ id: 'bad' }))
    testApp.use(errorHandler)

    const [internal, validation] = await Promise.all([
      request(testApp).get('/internal'),
      request(testApp).get('/validation')
    ])
    expect(internal.status).toBe(500)
    expect(internal.body.message).toBe('Đã xảy ra lỗi máy chủ')
    expect(JSON.stringify(internal.body)).not.toContain('database password')
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('database password')
    expect(validation.status).toBe(400)
    expect(validation.body.details).toBeTruthy()
    errorLog.mockRestore()
  })
})
