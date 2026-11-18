import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { authStatePath, disposableEnvironment } from './support/disposable-env'

async function openRole(browser, role) {
  return browser.newContext({ storageState: authStatePath(role), viewport: { width: 1440, height: 900 }, locale: 'vi-VN' })
}

async function closeRole(context, role) {
  await context.storageState({ path: authStatePath(role) })
  await context.close()
}

test('independent business routes and direct lazy-route refresh', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Run once on desktop; responsive shell has a dedicated matrix.')
  test.setTimeout(120_000)
  const results = []
  const directory = path.join(disposableEnvironment().artifactsRoot, 'business-readonly')
  await fs.mkdir(directory, { recursive: true })

  let context = await openRole(browser, 'candidate')
  let page = await context.newPage()
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Ứng viên kiểm thử' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ứng viên kiểm thử' })).toBeVisible()
  await page.getByRole('button', { name: 'CV', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'CV của bạn' })).toBeVisible()
  await expect(page.locator('.resource-item')).toHaveCount(1)
  results.push({ case: 'candidate-profile-cv-direct-refresh', status: 'PASS' })
  await page.goto('/recommendations')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Việc làm dành cho bạn' })).toBeVisible()
  await expect(page.locator('.recommendation-card').first()).toBeVisible()
  results.push({ case: 'candidate-recommendations-direct-refresh', status: 'PASS' })
  await page.goto('/messages')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Trao đổi tuyển dụng' })).toBeVisible()
  await expect(page.getByText('Chưa có cuộc trò chuyện.')).toBeVisible()
  results.push({ case: 'candidate-messages-empty-state-direct-refresh', status: 'PASS' })
  await page.screenshot({ path: path.join(directory, 'candidate-messages-empty.png'), fullPage: true })
  await closeRole(context, 'candidate')

  context = await openRole(browser, 'recruiter')
  page = await context.newPage()
  await page.goto('/recruiter')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible()
  await expect(page.getByText('Tổng tin tuyển dụng')).toBeVisible()
  results.push({ case: 'recruiter-dashboard-direct-refresh', status: 'PASS' })
  await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Quản lý tin' }).click()
  await expect(page.getByRole('cell', { name: 'QA-03B1 Kỹ sư phần mềm' })).toBeVisible()
  results.push({ case: 'recruiter-job-management', status: 'PASS' })
  await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Ứng viên' }).click()
  await expect(page.getByRole('heading', { name: 'Quản lý ứng viên' })).toBeVisible()
  results.push({ case: 'recruiter-applications-empty-table', status: 'PASS' })
  await page.goto('/recruiter/talent')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tìm ứng viên' })).toBeVisible()
  await expect(page.getByText(/ứng viên phù hợp/)).toBeVisible()
  results.push({ case: 'recruiter-talent-direct-refresh', status: 'PASS' })
  await page.goto('/messages')
  await expect(page.getByText('Chưa có cuộc trò chuyện.')).toBeVisible()
  results.push({ case: 'recruiter-messages-empty-state', status: 'PASS' })
  await page.screenshot({ path: path.join(directory, 'recruiter-messages-empty.png'), fullPage: true })
  await closeRole(context, 'recruiter')

  context = await openRole(browser, 'admin')
  page = await context.newPage()
  const forbidden = []
  page.on('response', (response) => {
    if (response.status() === 403) forbidden.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: 403 })
  })
  await page.goto('/admin')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tổng quan hệ thống' })).toBeVisible()
  results.push({ case: 'admin-dashboard-direct-refresh', status: 'PASS_WITH_KNOWN_403' })
  await page.locator('.admin-sidebar').getByRole('button', { name: 'Tài khoản' }).click()
  await expect(page.getByRole('heading', { name: 'Quản lý tài khoản' })).toBeVisible()
  await expect(page.getByText('candidate@jobconnect.local')).toBeVisible()
  results.push({ case: 'admin-user-management-read', status: 'PASS' })
  await page.locator('.admin-sidebar').getByRole('button', { name: 'Audit log' }).click()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nhật ký hệ thống' })).toBeVisible()
  results.push({ case: 'admin-audit-log-read', status: 'PASS' })
  await page.screenshot({ path: path.join(directory, 'admin-audit.png'), fullPage: true })
  await closeRole(context, 'admin')

  await fs.writeFile(path.join(directory, 'results-sanitized.json'), JSON.stringify({ results, forbidden }, null, 2), 'utf8')
})
