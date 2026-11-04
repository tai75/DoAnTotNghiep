import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|cookie|secret|authorization/i.test(key) ? '[REDACTED]' : sanitize(item)]))
  }
  return value
}

test('Admin focused diagnostics', async ({ page }, testInfo) => {
  test.skip(process.env.QA_RUN_ADMIN_DIAGNOSTIC !== '1', 'Opt-in diagnostic; stable matrix is the default suite.')
  test.skip(!['mobile-375', 'mobile-390', 'mobile-430'].includes(testInfo.project.name), 'Focused mobile diagnostics only')
  const authState = JSON.parse(await fs.readFile(path.resolve('.auth/admin.json'), 'utf8'))
  await page.context().addCookies(authState.cookies)
  const forbidden = []
  const consoleErrors = []
  const pageErrors = []

  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', async (response) => {
    if (response.status() !== 403) return
    const request = response.request()
    let body = null
    try {
      const text = await response.text()
      try { body = sanitize(JSON.parse(text)) } catch { body = text.slice(0, 500) }
    } catch { body = '[UNAVAILABLE]' }
    const url = new URL(response.url())
    forbidden.push({ method: request.method(), url: `${url.pathname}${url.search}`, status: response.status(), body })
  })

  await page.goto('/admin')
  await page.waitForLoadState('networkidle')
  const heading = page.getByRole('heading', { name: 'Tổng quan hệ thống' })
  const headingVisible = await heading.isVisible().catch(() => false)
  const dimensions = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  const snapshot = await page.locator('body').ariaSnapshot()

  const directory = path.resolve('e2e-artifacts', 'admin-diagnostic', testInfo.project.name)
  await fs.mkdir(directory, { recursive: true })
  await page.screenshot({ path: path.join(directory, 'admin.png'), fullPage: true })
  await fs.writeFile(path.join(directory, 'dom-aria.txt'), snapshot, 'utf8')
  await fs.writeFile(path.join(directory, 'network-sanitized.json'), JSON.stringify({ headingVisible, dimensions, forbidden, consoleErrors, pageErrors }, null, 2), 'utf8')
  await page.context().storageState({ path: path.resolve('.auth/admin.json') })

  expect(headingVisible).toBe(true)
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth)
  expect(pageErrors).toEqual([])
})
