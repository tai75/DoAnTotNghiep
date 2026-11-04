import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const fixturePrefix = 'QA-E2E-20261104'
const jobTitle = `${fixturePrefix}-FULLSTACK-R2`
const artifactDir = path.resolve('e2e-artifacts', 'business-lifecycle')

async function roleContext(browser, role) {
  return browser.newContext({
    storageState: path.resolve('.auth', `${role}.json`),
    viewport: { width: 1440, height: 900 },
    locale: 'vi-VN',
  })
}

async function persistAndClose(context, role) {
  await context.storageState({ path: path.resolve('.auth', `${role}.json`) })
  await context.close()
}

test('identified development fixture: recruiter → admin → candidate → pipeline/messages', async ({ browser }, testInfo) => {
  test.setTimeout(180_000)
  test.skip(testInfo.project.name !== 'desktop-1440', 'The business lifecycle runs once; responsive shells are covered by the viewport matrix.')
  await fs.mkdir(artifactDir, { recursive: true })
  const evidence = { fixturePrefix, jobTitle, steps: [] }

  let context = await roleContext(browser, 'recruiter')
  let page = await context.newPage()
  await page.goto('/recruiter')
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible()
  await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Quản lý tin' }).click()
  const existingJob = page.getByRole('row').filter({ hasText: jobTitle })
  if (await existingJob.count()) {
    evidence.steps.push({ case: 'recruiter-create-submit-job', status: 'REUSED_IDENTIFIED_FIXTURE' })
  } else {
    await page.getByRole('button', { name: '+ Tạo tin mới' }).click()
    await page.getByLabel('Chức danh').fill(jobTitle)
    await page.getByLabel('Địa điểm').fill('QA Development')
    await page.getByLabel('Hình thức').selectOption('FULL_TIME')
    await page.getByLabel('Hạn nhận hồ sơ').fill('2026-12-31')
    await page.getByLabel('Mô tả công việc').fill('QA development fixture for responsive end-to-end recruitment lifecycle testing only.')
    await page.waitForResponse((response) => response.url().includes('/api/jobs') && response.request().method() === 'POST' && response.ok())
    await page.getByRole('button', { name: 'Tiếp tục' }).click()
    await page.getByRole('button', { name: 'Tiếp tục' }).click()
    const submitted = page.waitForResponse((response) => /\/api\/jobs\/\d+\/submit$/.test(response.url()) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Gửi duyệt' }).click()
    const submitResponse = await submitted
    expect(submitResponse.ok()).toBe(true)
    await expect(page.getByRole('cell', { name: jobTitle })).toBeVisible()
    evidence.steps.push({ case: 'recruiter-create-submit-job', status: 'PASS', httpStatus: submitResponse.status() })
  }
  await page.screenshot({ path: path.join(artifactDir, 'recruiter-job-pending.png'), fullPage: true })
  await persistAndClose(context, 'recruiter')

  context = await roleContext(browser, 'admin')
  page = await context.newPage()
  const adminForbidden = []
  page.on('response', (response) => {
    if (response.status() === 403) {
      const url = new URL(response.url())
      adminForbidden.push({ method: response.request().method(), path: url.pathname, status: response.status() })
    }
  })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Tổng quan hệ thống' })).toBeVisible()
  await page.locator('.admin-sidebar').getByRole('button', { name: 'Kiểm duyệt tin' }).click()
  const jobRow = page.getByRole('row').filter({ hasText: jobTitle })
  if (await jobRow.count()) {
    const moderated = page.waitForResponse((response) => /\/api\/admin\/jobs\/\d+\/moderation$/.test(response.url()) && response.request().method() === 'PATCH')
    await jobRow.getByRole('button', { name: 'Duyệt' }).click()
    const moderationResponse = await moderated
    expect(moderationResponse.ok()).toBe(true)
    await expect(jobRow).toHaveCount(0)
    evidence.steps.push({ case: 'admin-moderate-job', status: 'PASS', httpStatus: moderationResponse.status() })
  } else {
    evidence.steps.push({ case: 'admin-moderate-job', status: 'REUSED_PUBLISHED_FIXTURE' })
  }
  await page.locator('.admin-sidebar').getByRole('button', { name: 'Tài khoản' }).click()
  await expect(page.getByRole('heading', { name: 'Quản lý tài khoản' })).toBeVisible()
  await expect(page.getByText('candidate@jobconnect.local')).toBeVisible()
  evidence.steps.push({ case: 'admin-users-read', status: 'PASS' })
  evidence.adminForbidden = adminForbidden
  await page.screenshot({ path: path.join(artifactDir, 'admin-users.png'), fullPage: true })
  await persistAndClose(context, 'admin')

  context = await roleContext(browser, 'candidate')
  page = await context.newPage()
  await page.goto('/jobs')
  await page.getByPlaceholder('Chức danh, kỹ năng...').fill(jobTitle)
  await page.getByRole('button', { name: 'Lọc', exact: true }).click()
  const card = page.locator('.public-job-card').filter({ hasText: jobTitle })
  await expect(card).toBeVisible()
  const alreadyApplied = await card.getByText('Đã ứng tuyển').count() > 0
  await card.press('Enter')
  await expect(page).toHaveURL(/\/jobs\/\d+/)
  await expect(page.locator('.public-job-detail h1')).toHaveText(jobTitle)
  evidence.steps.push({ case: 'candidate-search-filter-detail', status: 'PASS' })
  const saveButton = page.locator('.public-detail-actions .public-save-button')
  if (!(await saveButton.getByText(/Đã lưu/).count())) {
    await saveButton.focus()
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.public-job-detail').getByRole('button', { name: /Đã lưu/ })).toBeVisible()
  evidence.steps.push({ case: 'candidate-save-job', status: 'PASS' })
  if (alreadyApplied) {
    evidence.steps.push({ case: 'candidate-apply-with-existing-cv', status: 'REUSED_IDENTIFIED_APPLICATION' })
  } else {
    await page.locator('.public-job-detail').getByRole('button', { name: 'Ứng tuyển' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Ứng tuyển nhanh' })).toBeVisible()
    await page.getByRole('button', { name: 'Tiếp tục' }).click()
    await page.getByPlaceholder('Giới thiệu ngắn về bạn...').fill(`${fixturePrefix} candidate application`)
    await page.getByRole('button', { name: 'Tiếp tục' }).click()
    const applied = page.waitForResponse((response) => /\/api\/applications\/jobs\/\d+$/.test(response.url()) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Gửi hồ sơ' }).click()
    const applicationResponse = await applied
    expect(applicationResponse.status()).toBe(201)
    evidence.steps.push({ case: 'candidate-apply-with-existing-cv', status: 'PASS', httpStatus: applicationResponse.status() })
  }
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Demo Candidate' })).toBeVisible()
  await page.getByRole('button', { name: 'CV', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'CV của bạn' })).toBeVisible()
  await expect(page.locator('.resource-item')).toHaveCount(1)
  evidence.steps.push({ case: 'candidate-profile-cv', status: 'PASS' })
  await page.goto('/recommendations')
  await expect(page.getByRole('heading', { name: 'Việc làm dành cho bạn' })).toBeVisible()
  await expect(page.locator('.recommendation-card').first()).toBeVisible()
  evidence.steps.push({ case: 'candidate-recommendations', status: 'PASS' })
  await page.goto('/my-jobs?tab=applied')
  await expect(page.getByText(jobTitle)).toBeVisible()
  evidence.steps.push({ case: 'candidate-my-jobs-application', status: 'PASS' })
  await page.screenshot({ path: path.join(artifactDir, 'candidate-application.png'), fullPage: true })
  await persistAndClose(context, 'candidate')

  context = await roleContext(browser, 'recruiter')
  page = await context.newPage()
  await page.goto('/recruiter')
  await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Ứng viên' }).click()
  const applicationRow = page.getByRole('row').filter({ hasText: jobTitle }).filter({ hasText: 'Demo Candidate' })
  await expect(applicationRow).toBeVisible()
  await applicationRow.getByRole('button', { name: 'Xem hồ sơ' }).click()
  await page.locator('#application-status').selectOption('REVIEWING')
  await page.locator('#application-note').fill(`${fixturePrefix} reviewed`)
  const statusUpdated = page.waitForResponse((response) => /\/api\/applications\/\d+\/status$/.test(response.url()) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Lưu trạng thái và ghi chú' }).click()
  const statusResponse = await statusUpdated
  expect(statusResponse.ok()).toBe(true)
  evidence.steps.push({ case: 'recruiter-application-status', status: 'PASS', httpStatus: statusResponse.status() })
  await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Quản lý tin' }).click()
  const managedJobRow = page.getByRole('row').filter({ hasText: jobTitle })
  await managedJobRow.getByRole('button', { name: 'Pipeline' }).click()
  await expect(page.getByRole('heading', { name: `Pipeline · ${jobTitle}` })).toBeVisible()
  await expect(page.locator('.pipeline-card').filter({ hasText: 'Demo Candidate' })).toBeVisible()
  await page.locator('.pipeline-card').filter({ hasText: 'Demo Candidate' }).dispatchEvent('click')
  await expect(page.getByRole('button', { name: 'Nhắn tin ứng viên' })).toBeVisible()
  const conversationCreated = page.waitForResponse((response) => /\/api\/conversations\/applications\/\d+$/.test(response.url()) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Nhắn tin ứng viên' }).click()
  const conversationResponse = await conversationCreated
  expect(conversationResponse.ok()).toBe(true)
  await expect(page).toHaveURL(/\/messages/)
  await page.locator('.message-thread').first().click()
  await page.getByLabel('Nội dung tin nhắn').fill(`${fixturePrefix} recruiter message`)
  const sent = page.waitForResponse((response) => /\/api\/conversations\/\d+\/messages$/.test(response.url()) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Gửi' }).click()
  const sentResponse = await sent
  expect(sentResponse.status()).toBe(201)
  evidence.steps.push({ case: 'recruiter-pipeline-message', status: 'PASS', httpStatus: sentResponse.status() })
  await page.screenshot({ path: path.join(artifactDir, 'recruiter-message.png'), fullPage: true })
  await persistAndClose(context, 'recruiter')

  context = await roleContext(browser, 'candidate')
  page = await context.newPage()
  await page.goto('/messages')
  await expect(page.getByRole('heading', { name: 'Trao đổi tuyển dụng' })).toBeVisible()
  await page.locator('.message-thread').first().click()
  await expect(page.getByText(`${fixturePrefix} recruiter message`)).toBeVisible()
  await page.getByLabel('Nội dung tin nhắn').fill(`${fixturePrefix} candidate reply`)
  const replied = page.waitForResponse((response) => /\/api\/conversations\/\d+\/messages$/.test(response.url()) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Gửi' }).click()
  const replyResponse = await replied
  expect(replyResponse.status()).toBe(201)
  evidence.steps.push({ case: 'candidate-messages-reply', status: 'PASS', httpStatus: replyResponse.status() })
  await page.screenshot({ path: path.join(artifactDir, 'candidate-message.png'), fullPage: true })
  await persistAndClose(context, 'candidate')

  await fs.writeFile(path.join(artifactDir, 'results-sanitized.json'), JSON.stringify(evidence, null, 2), 'utf8')
})
