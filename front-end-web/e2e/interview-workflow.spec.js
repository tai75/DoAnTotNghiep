import { expect, request, test } from '@playwright/test'
import crypto from 'node:crypto'

const apiBase = 'http://127.0.0.1:5101'
const password = process.env.QA01_PASSWORD

async function apiLogin(email) {
  const context = await request.newContext({ baseURL: apiBase })
  const response = await context.post('/api/auth/login', { data: { email, password } })
  expect(response.status()).toBe(200)
  return { context, token: (await response.json()).data.token }
}

const auth = (token) => ({ Authorization: `Bearer ${token}` })
async function data(response) { const body = await response.json(); expect(body.success).toBe(true); return body.data }

async function browserLogin(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.locator('form.auth-form button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('two-role interview scheduling, notification, confirmation and responsive detail', async ({ browser }) => {
  const candidate = await apiLogin('candidate@jobconnect.local')
  const recruiter = await apiLogin('recruiter@jobconnect.local')
  const jobs = await data(await candidate.context.get('/api/jobs?search=QA-01+Existing+Backend+Engineer', { headers: auth(candidate.token) }))
  const job = jobs.items.find((item) => item.title === 'QA-01 Existing Backend Engineer')
  expect(job).toBeTruthy()
  const profile = await data(await candidate.context.get('/api/candidates/me', { headers: auth(candidate.token) }))
  const application = await data(await candidate.context.post(`/api/applications/jobs/${job.id}`, { headers: auth(candidate.token), data: { resumeId: profile.resumes[0].id, coverLetter: 'QA interview E2E application' } }))
  const interviewResponse = await recruiter.context.post('/api/interviews/recruiter', { headers: auth(recruiter.token), data: { applicationId: application.id, requestKey: crypto.randomUUID(), scheduledStart: '2030-08-10T09:00:00+07:00', scheduledEnd: '2030-08-10T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh', mode: 'ONLINE', meetingUrl: 'https://meet.example.test/interview-e2e', candidateInstructions: 'Chuẩn bị môi trường coding.' } })
  expect(interviewResponse.status()).toBe(201)
  const interview = await data(interviewResponse)

  const candidateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const candidatePage = await candidateContext.newPage()
  const pageErrors = []
  candidatePage.on('pageerror', (error) => pageErrors.push(error.message))
  await browserLogin(candidatePage, 'candidate@jobconnect.local')
  await candidatePage.goto('/interviews')
  await expect(candidatePage.getByRole('heading', { name: 'Lịch phỏng vấn' })).toBeVisible()
  const bell = candidatePage.getByRole('button', { name: /Thông báo/ })
  await bell.click()
  const notifications = candidatePage.getByRole('dialog', { name: 'Thông báo' })
  await expect(notifications.getByText('Bạn có lịch phỏng vấn mới', { exact: true })).toBeVisible()
  await notifications.getByRole('button', { name: /Bạn có lịch phỏng vấn mới/ }).click()
  await expect(candidatePage).toHaveURL(new RegExp(`/interviews/${interview.id}$`))
  const detail = candidatePage.getByRole('dialog', { name: 'Chi tiết lịch phỏng vấn' })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'Xác nhận tham gia' }).click()
  const confirmation = candidatePage.getByRole('dialog', { name: 'Xác nhận tham gia' })
  await confirmation.getByRole('button', { name: 'Xác nhận tham gia' }).click()
  await expect(candidatePage.getByText('Phản hồi lịch phỏng vấn đã được lưu.')).toBeVisible()
  expect(await candidatePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  for (const viewport of [{ width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await candidatePage.setViewportSize(viewport)
    await candidatePage.goto(`/interviews/${interview.id}`)
    const responsiveDialog = candidatePage.getByRole('dialog', { name: 'Chi tiết lịch phỏng vấn' })
    await expect(responsiveDialog).toBeVisible()
    const box = await responsiveDialog.boundingBox()
    expect(box.width).toBeLessThanOrEqual(viewport.width)
    expect(await candidatePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(pageErrors).toEqual([])

  const recruiterContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' })
  const recruiterPage = await recruiterContext.newPage()
  await browserLogin(recruiterPage, 'recruiter@jobconnect.local')
  await recruiterPage.goto(`/recruiter/interviews/${interview.id}`)
  const recruiterDetail = recruiterPage.getByRole('dialog', { name: 'Chi tiết lịch phỏng vấn' })
  await expect(recruiterDetail).toBeVisible()
  await expect(recruiterDetail.getByText('Đã xác nhận', { exact: true })).toBeVisible()
  expect(await recruiterPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await Promise.all([candidate.context.dispose(), recruiter.context.dispose(), candidateContext.close(), recruiterContext.close()])
})
