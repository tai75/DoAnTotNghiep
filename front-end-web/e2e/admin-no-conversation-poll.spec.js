import { expect, test } from '@playwright/test'
import { authStatePath } from './support/disposable-env'

const viewports = [
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'desktop-1440', width: 1440, height: 900 },
]

test('admin does not request candidate/recruiter unread count on mobile or desktop', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'The test controls its own focused viewport matrix.')
  const context = await browser.newContext({
    storageState: authStatePath('admin'),
    viewport: { width: 430, height: 932 },
    locale: 'vi-VN',
  })
  const page = await context.newPage()
  const unreadRequests = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/conversations/unread-count') {
      unreadRequests.push({ method: request.method(), path: '/api/conversations/unread-count' })
    }
  })

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Tổng quan hệ thống' })).toBeVisible()
    await page.waitForTimeout(5_500)
  }

  expect(unreadRequests).toEqual([])
  await context.storageState({ path: authStatePath('admin') })
  await context.close()
})
