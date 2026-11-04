import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

test('public job and company details render without server errors', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Capture once on desktop.')
  const directory = path.resolve('e2e-artifacts', 'public-detail-diagnostic')
  await fs.mkdir(directory, { recursive: true })
  const responses = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (['/api/jobs/3', '/api/companies/1'].includes(url.pathname)) {
      responses.push({ method: response.request().method(), path: url.pathname, status: response.status() })
    }
  })

  const jobResponse = page.waitForResponse((response) => response.url().endsWith('/api/jobs/3'))
  await page.goto('/jobs/3')
  expect((await jobResponse).status()).toBe(200)
  await expect(page.locator('.public-job-detail h1')).toBeVisible()
  await page.screenshot({ path: path.join(directory, 'job-detail-fixed.png'), fullPage: true })

  const companyResponse = page.waitForResponse((response) => response.url().endsWith('/api/companies/1'))
  await page.goto('/companies/1')
  expect((await companyResponse).status()).toBe(200)
  await expect(page.locator('.company-public-header h1')).toBeVisible()
  await expect(page.getByText(/việc làm đang tuyển/)).toBeVisible()
  await page.screenshot({ path: path.join(directory, 'company-detail-fixed.png'), fullPage: true })

  await fs.writeFile(path.join(directory, 'network-sanitized.json'), JSON.stringify({ responses }, null, 2), 'utf8')
  expect(responses).toEqual(expect.arrayContaining([
    { method: 'GET', path: '/api/jobs/3', status: 200 },
    { method: 'GET', path: '/api/companies/1', status: 200 },
  ]))
})
