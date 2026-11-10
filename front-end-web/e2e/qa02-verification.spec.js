import crypto from 'node:crypto'
import { expect, request, test } from '@playwright/test'

const apiBase = 'http://127.0.0.1:5101'
const password = process.env.QA01_PASSWORD
const adminEmail = 'admin@jobconnect.local'
const auth = (token) => ({ Authorization: `Bearer ${token}` })

async function body(response) {
  const payload = await response.json()
  expect(payload.success, payload.message).toBe(true)
  return payload.data
}

async function login(context, email) {
  const response = await context.post('/api/auth/login', { data: { email, password } })
  expect(response.status()).toBe(200)
  return (await response.json()).data.token
}

async function register(context, payload) {
  const response = await context.post('/api/auth/register', { data: { ...payload, password } })
  expect(response.status()).toBe(201)
  return (await response.json()).data
}

test.describe.serial('QA-02 verification, privacy and protected recruiter workflow', () => {
  test('new candidate is private and can opt in/out from the Vietnamese profile UI', async ({ browser }) => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const email = `qa02-candidate-${suffix}@jobconnect.local`
    const api = await request.newContext({ baseURL: apiBase })
    const registered = await register(api, { email, fullName: 'QA-02 Candidate', role: 'CANDIDATE' })
    const profile = await body(await api.get('/api/candidates/me', { headers: auth(registered.token) }))
    expect(profile.isSearchable).toBe(false)

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN', storageState: await api.storageState() })
    const page = await context.newPage()
    await page.goto('/profile')
    await page.getByRole('button', { name: /Mong muốn/ }).click()
    const toggle = page.locator('.job-search-card input[type="checkbox"]')
    await expect(toggle).not.toBeChecked()
    await expect(page.getByText(/nhà tuyển dụng tìm thấy hồ sơ/i)).toBeVisible()
    await toggle.check()
    await expect.poll(async () => (await body(await api.get('/api/candidates/me', { headers: auth(registered.token) }))).isSearchable).toBe(true)
    await toggle.uncheck()
    await expect.poll(async () => (await body(await api.get('/api/candidates/me', { headers: auth(registered.token) }))).isSearchable).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await Promise.all([api.dispose(), context.close()])
  })

  test('UNVERIFIED recruiter is approved, completes recruitment workflow, then SUSPENDED is blocked', async ({ browser }) => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const recruiterEmail = `qa02-recruiter-${suffix}@jobconnect.local`
    const candidateEmail = `qa02-talent-${suffix}@jobconnect.local`
    const recruiter = await request.newContext({ baseURL: apiBase })
    const candidate = await request.newContext({ baseURL: apiBase })
    const admin = await request.newContext({ baseURL: apiBase })
    const recruiterRegistration = await register(recruiter, { email: recruiterEmail, fullName: 'QA-02 Recruiter', role: 'RECRUITER', companyName: `QA-02 Company ${suffix}` })
    const candidateRegistration = await register(candidate, { email: candidateEmail, fullName: 'QA-02 Talent', role: 'CANDIDATE' })
    const recruiterToken = recruiterRegistration.token
    const candidateToken = candidateRegistration.token
    const adminToken = await login(admin, adminEmail)

    const initialCompany = await body(await recruiter.get('/api/companies/me', { headers: auth(recruiterToken) }))
    expect(initialCompany.verificationStatus).toBe('UNVERIFIED')
    await body(await recruiter.patch('/api/companies/me', { headers: auth(recruiterToken), data: { name: initialCompany.name, address: 'QA-02 isolated address', industry: 'Software' } }))

    const draft = await body(await recruiter.post('/api/jobs', { headers: auth(recruiterToken), data: { title: `QA-02 Draft ${suffix}`, description: 'Synthetic QA-02 draft used for company verification E2E.', location: 'Ho Chi Minh City', employmentType: 'FULL_TIME', deadline: '2030-12-31T00:00:00.000Z' } }))
    expect(draft.status).toBe('DRAFT')
    expect((await recruiter.patch(`/api/jobs/${draft.id}`, { headers: auth(recruiterToken), data: { title: `${draft.title} updated` } })).status()).toBe(200)
    expect((await recruiter.post(`/api/jobs/${draft.id}/submit`, { headers: auth(recruiterToken) })).status()).toBe(403)
    expect((await recruiter.get('/api/applications/managed', { headers: auth(recruiterToken) })).status()).toBe(403)

    const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', storageState: await recruiter.storageState() })
    const recruiterPage = await browserContext.newPage()
    await recruiterPage.goto('/recruiter')
    await expect(recruiterPage.getByText('Trạng thái doanh nghiệp: Chưa xác minh')).toBeVisible()
    await recruiterPage.getByRole('button', { name: 'Gửi yêu cầu xác minh' }).click()
    await expect(recruiterPage.getByText('Trạng thái doanh nghiệp: Đang chờ duyệt')).toBeVisible()

    const pending = await body(await admin.get('/api/admin/verification-requests?status=PENDING', { headers: auth(adminToken) }))
    const verification = pending.items.find((item) => item.company.id === initialCompany.id)
    expect(verification).toBeTruthy()
    expect((await admin.patch(`/api/admin/verification-requests/${verification.id}`, { headers: auth(adminToken), data: { decision: 'APPROVED', note: 'QA-02 approved' } })).status()).toBe(200)
    expect((await recruiter.post(`/api/jobs/${draft.id}/submit`, { headers: auth(recruiterToken) })).status()).toBe(200)

    const pendingJobs = await body(await admin.get('/api/admin/jobs?status=PENDING', { headers: auth(adminToken) }))
    const pendingJob = pendingJobs.items.find((item) => item.id === draft.id)
    expect(pendingJob).toBeTruthy()
    expect((await admin.patch(`/api/admin/jobs/${draft.id}/moderation`, { headers: auth(adminToken), data: { status: 'PUBLISHED', note: 'QA-02 publish', expectedUpdatedAt: pendingJob.updatedAt } })).status()).toBe(200)

    await body(await candidate.patch('/api/candidates/me', { headers: auth(candidateToken), data: { isSearchable: true } }))
    const invitation = await body(await recruiter.post('/api/recruiters/talent/invite', { headers: auth(recruiterToken), data: { candidateId: (await body(await candidate.get('/api/candidates/me', { headers: auth(candidateToken) }))).id, jobId: draft.id, message: 'QA-02 invitation' } }))
    expect((await candidate.patch(`/api/candidates/me/invitations/${invitation.id}`, { headers: auth(candidateToken), data: { status: 'ACCEPTED' } })).status()).toBe(200)

    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
    const resume = await body(await candidate.post('/api/candidates/me/resumes', { headers: auth(candidateToken), multipart: { file: { name: 'qa02-cv.pdf', mimeType: 'application/pdf', buffer: pdf }, isDefault: 'true' } }))
    const application = await body(await candidate.post(`/api/applications/jobs/${draft.id}`, { headers: auth(candidateToken), data: { resumeId: resume.id, coverLetter: 'QA-02 application' } }))
    const managed = await body(await recruiter.get(`/api/applications/managed?jobId=${draft.id}`, { headers: auth(recruiterToken) }))
    expect(managed.items.some((item) => item.id === application.id)).toBe(true)
    const conversation = await body(await recruiter.post(`/api/conversations/applications/${application.id}`, { headers: auth(recruiterToken) }))
    expect((await recruiter.post(`/api/conversations/${conversation.id}/messages`, { headers: auth(recruiterToken), data: { content: 'QA-02 recruiter message' } })).status()).toBe(201)
    expect((await candidate.post(`/api/conversations/${conversation.id}/messages`, { headers: auth(candidateToken), data: { content: 'QA-02 candidate reply' } })).status()).toBe(201)
    const interview = await recruiter.post('/api/interviews/recruiter', { headers: auth(recruiterToken), data: { applicationId: application.id, requestKey: crypto.randomUUID(), scheduledStart: '2030-09-01T09:00:00+07:00', scheduledEnd: '2030-09-01T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh', mode: 'ONLINE', meetingUrl: 'https://meet.example.test/qa02' } })
    expect(interview.status()).toBe(201)

    const companyDetail = await body(await admin.get(`/api/admin/companies/${initialCompany.id}`, { headers: auth(adminToken) }))
    expect((await admin.patch(`/api/admin/companies/${initialCompany.id}/status`, { headers: auth(adminToken), data: { status: 'SUSPENDED', reason: 'QA-02 suspension check', expectedUpdatedAt: companyDetail.updatedAt } })).status()).toBe(200)
    expect((await recruiter.get('/api/applications/managed', { headers: auth(recruiterToken) })).status()).toBe(403)
    await recruiterPage.setViewportSize({ width: 390, height: 844 })
    await recruiterPage.reload()
    expect(await recruiterPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    await Promise.all([recruiter.dispose(), candidate.dispose(), admin.dispose(), browserContext.close()])
  }, 120_000)

  test('admin rejection records its reason and recruiter can resubmit', async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const recruiter = await request.newContext({ baseURL: apiBase })
    const admin = await request.newContext({ baseURL: apiBase })
    const registration = await register(recruiter, { email: `qa02-reject-${suffix}@jobconnect.local`, fullName: 'QA-02 Rejected Recruiter', role: 'RECRUITER', companyName: `QA-02 Reject ${suffix}` })
    const adminToken = await login(admin, adminEmail)
    const company = await body(await recruiter.get('/api/companies/me', { headers: auth(registration.token) }))
    await body(await recruiter.patch('/api/companies/me', { headers: auth(registration.token), data: { name: company.name, address: 'QA-02 rejection address' } }))
    const submitted = await body(await recruiter.post('/api/companies/me/verification-requests', { headers: auth(registration.token), data: { requestKey: crypto.randomUUID() } }))
    const reason = 'Hồ sơ QA-02 chưa đủ thông tin'
    const rejected = await body(await admin.patch(`/api/admin/verification-requests/${submitted.id}`, { headers: auth(adminToken), data: { decision: 'REJECTED', reason } }))
    expect(rejected.rejectionReason).toBe(reason)
    expect((await body(await recruiter.get('/api/companies/me', { headers: auth(registration.token) }))).verificationStatus).toBe('REJECTED')
    expect((await recruiter.post('/api/companies/me/verification-requests', { headers: auth(registration.token), data: { requestKey: crypto.randomUUID() } })).status()).toBe(201)
    await Promise.all([recruiter.dispose(), admin.dispose()])
  })
})
