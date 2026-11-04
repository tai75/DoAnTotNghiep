import { expect, test } from '@playwright/test'

const forbiddenInitialChunks = ['RecruiterDashboardPage', 'AdminDashboardPage', 'BarChart', 'PieChart', 'ChatWidget']

for (const route of ['/login', '/jobs']) {
  test(`production route smoke: ${route}`, async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(route)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('#root')).not.toBeEmpty()
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/assets/') && name.endsWith('.js')))
    expect(scripts.some((url) => forbiddenInitialChunks.some((chunk) => url.includes(chunk)))).toBe(false)
    expect(pageErrors).toEqual([])
  })
}

test('AI chat chunk is requested on first interaction', async ({ page }) => {
  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
  expect(before.some((url) => url.includes('ChatWidget'))).toBe(false)

  await page.getByRole('button', { name: 'Mở trợ lý AI' }).click()
  await expect(page.getByRole('region', { name: 'Trợ lý Job Connect' })).toBeVisible()

  const after = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
  expect(after.some((url) => url.includes('ChatWidget'))).toBe(true)
})
