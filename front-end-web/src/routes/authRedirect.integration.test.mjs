import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const roles = { CANDIDATE: '/jobs', RECRUITER: '/recruiter', ADMIN: '/admin' }

test('React login and route guards use the role redirect policy with mocked API', async () => {
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } })
  let browser
  await vite.listen()
  const baseURL = vite.resolvedUrls.local[0]
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true })
    async function pageFor(role, { restore = false, failLogin = false } = {}) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const calls = []
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url())
        calls.push(url.pathname)
        const user = { id: 100, fullName: 'Tài khoản thử nghiệm', role }
        const isAuth = url.pathname === '/api/auth/login' || url.pathname === '/api/auth/refresh'
        const ok = isAuth && !((url.pathname.endsWith('/refresh') && !restore) || (url.pathname.endsWith('/login') && failLogin))
        await route.fulfill({ status: ok ? 200 : 401, contentType: 'application/json', body: JSON.stringify(ok
          ? { success: true, data: { user, token: 'mock-access-token' } }
          : { success: false, message: 'Phiên thử nghiệm không hợp lệ' }) })
      })
      return { context, page, calls }
    }
    async function loginCase(role, destination, expected, failLogin = false) {
      const { context, page, calls } = await pageFor(role, { failLogin })
      try {
        await page.goto(`${baseURL}login${destination ? `?returnTo=${encodeURIComponent(destination)}` : ''}`)
        await page.getByLabel('Email').fill('mock@example.test')
        await page.locator('input[name="password"]').fill('mock-password')
        await page.locator('form.auth-form button[type="submit"]').click()
        if (failLogin) {
          await page.getByText('Phiên thử nghiệm không hợp lệ').waitFor()
          assert.equal(new URL(page.url()).pathname, '/login')
        } else {
          await page.waitForURL((url) => url.pathname === new URL(expected, baseURL).pathname)
          assert.equal(`${new URL(page.url()).pathname}${new URL(page.url()).search}`, expected)
        }
        assert(calls.includes('/api/auth/login'))
        assert(calls.every((call) => call.startsWith('/api/')))
      } finally { await context.close() }
    }

    for (const [role, home] of Object.entries(roles)) await loginCase(role, null, home)
    await loginCase('CANDIDATE', '/jobs/42?sort=newest', '/jobs/42?sort=newest')
    await loginCase('RECRUITER', '/recruiter/talent', '/recruiter/talent')
    await loginCase('ADMIN', '/admin?section=reports', '/admin?section=reports')
    await loginCase('CANDIDATE', '/admin', '/jobs')
    await loginCase('ADMIN', 'https://example.com', '/admin')
    await loginCase('RECRUITER', null, '/login', true)

    const guest = await pageFor('CANDIDATE')
    try {
      await guest.page.goto(`${baseURL}profile`)
      await guest.page.waitForURL((url) => url.pathname === '/login')
    } finally { await guest.context.close() }

    const wrongRole = await pageFor('RECRUITER', { restore: true })
    try {
      await wrongRole.page.goto(`${baseURL}admin`)
      await wrongRole.page.waitForURL((url) => url.pathname === '/recruiter')
      assert(wrongRole.calls.includes('/api/auth/refresh'))
    } finally { await wrongRole.context.close() }

    const restored = await pageFor('ADMIN', { restore: true })
    try {
      await restored.page.goto(`${baseURL}login?returnTo=${encodeURIComponent('/admin?section=reports')}`)
      await restored.page.waitForURL((url) => url.pathname === '/admin' && url.search === '?section=reports')
      assert(restored.calls.includes('/api/auth/refresh'))
    } finally { await restored.context.close() }
  } finally {
    await browser?.close()
    await vite.close()
  }
})
