import { expect, request, test } from '@playwright/test'

const apiBase = 'http://127.0.0.1:5101'
const password = process.env.QA01_PASSWORD

async function apiLogin(email) {
  const context = await request.newContext({ baseURL: apiBase })
  const response = await context.post('/api/auth/login', { data: { email, password } })
  expect(response.status()).toBe(200)
  return { context, token: (await response.json()).data.token }
}

async function uiLogin(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@jobconnect.local')
  await page.getByLabel('Mật khẩu').fill(password)
  await page.locator('form.auth-form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin/)
}

test.describe.serial('Quản trị và kiểm duyệt', () => {
  test('đình chỉ doanh nghiệp ẩn dữ liệu công khai nhưng giữ hồ sơ đã có', async () => {
    const candidateContext = await request.newContext({ baseURL: apiBase })
    const registration = await candidateContext.post('/api/auth/register', { data: { email: `suspension-${Date.now()}@jobconnect.local`, password, fullName: 'QA Suspension Candidate', role: 'CANDIDATE' } })
    expect(registration.status()).toBe(201)
    const candidate = { context: candidateContext, token: (await registration.json()).data.token }
    const admin = await apiLogin('admin@jobconnect.local')
    const jobsResponse = await candidate.context.get('/api/jobs?limit=1', { headers: { Authorization: `Bearer ${candidate.token}` } })
    const job = (await jobsResponse.json()).data.items[0]
    const applicationResponse = await candidate.context.post(`/api/applications/jobs/${job.id}`, { headers: { Authorization: `Bearer ${candidate.token}` }, data: {} })
    expect(applicationResponse.status()).toBe(201)
    const companiesResponse = await admin.context.get(`/api/admin/companies?search=${encodeURIComponent(job.company.name)}`, { headers: { Authorization: `Bearer ${admin.token}` } })
    const company = (await companiesResponse.json()).data.items.find((item) => item.id === job.company.id)
    const suspended = await admin.context.patch(`/api/admin/companies/${company.id}/status`, { headers: { Authorization: `Bearer ${admin.token}` }, data: { status: 'SUSPENDED', reason: 'Kiểm thử an toàn QA', expectedUpdatedAt: company.updatedAt } })
    expect(suspended.status()).toBe(200)
    expect((await candidate.context.get(`/api/companies/${company.id}`)).status()).toBe(404)
    expect((await candidate.context.get(`/api/jobs/${job.id}`)).status()).toBe(404)
    expect((await candidate.context.post(`/api/applications/jobs/${job.id}`, { headers: { Authorization: `Bearer ${candidate.token}` }, data: {} })).status()).toBe(404)
    const existing = (await (await candidate.context.get('/api/applications/me', { headers: { Authorization: `Bearer ${candidate.token}` } })).json()).data
    expect(existing.some((item) => item.job.id === job.id)).toBe(true)
    const latest = (await (await admin.context.get(`/api/admin/companies/${company.id}`, { headers: { Authorization: `Bearer ${admin.token}` } })).json()).data
    const restored = await admin.context.patch(`/api/admin/companies/${company.id}/status`, { headers: { Authorization: `Bearer ${admin.token}` }, data: { status: 'ACTIVE', expectedUpdatedAt: latest.updatedAt } })
    expect(restored.status()).toBe(200)
    expect((await candidate.context.get(`/api/jobs/${job.id}`)).status()).toBe(200)
    await Promise.all([candidate.context.dispose(), admin.context.dispose()])
  })

  test('chỉ một quản trị viên thắng khi kiểm duyệt đồng thời', async () => {
    const recruiter = await apiLogin('recruiter@jobconnect.local')
    const admin = await apiLogin('admin@jobconnect.local')
    const title = `QA đồng thời ${Date.now()}`
    const createdResponse = await recruiter.context.post('/api/jobs', { headers: { Authorization: `Bearer ${recruiter.token}` }, data: { title, description: 'Tin tuyển dụng tổng hợp dùng để kiểm tra khóa lạc quan trên QA.', location: 'Hồ Chí Minh', employmentType: 'FULL_TIME', deadline: '2030-12-31T00:00:00.000Z', status: 'DRAFT' } })
    expect(createdResponse.status()).toBe(201)
    const job = (await createdResponse.json()).data
    expect((await recruiter.context.post(`/api/jobs/${job.id}/submit`, { headers: { Authorization: `Bearer ${recruiter.token}` } })).status()).toBe(200)
    const pendingResponse = await admin.context.get(`/api/admin/jobs?status=PENDING&search=${encodeURIComponent(title)}`, { headers: { Authorization: `Bearer ${admin.token}` } })
    const pending = (await pendingResponse.json()).data.items.find((item) => item.id === job.id)
    expect(pending).toBeTruthy()
    const request = () => admin.context.patch(`/api/admin/jobs/${job.id}/moderation`, { headers: { Authorization: `Bearer ${admin.token}` }, data: { status: 'PUBLISHED', note: 'Kiểm thử đồng thời', expectedUpdatedAt: pending.updatedAt } })
    const responses = await Promise.all([request(), request()])
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])
    const auditResponse = await admin.context.get('/api/admin/audit-logs?action=JOB_MODERATION_UPDATED&entity=Job&limit=100', { headers: { Authorization: `Bearer ${admin.token}` } })
    const auditItems = (await auditResponse.json()).data.items.filter((item) => item.entityId === job.id)
    expect(auditItems).toHaveLength(1)
    await Promise.all([recruiter.context.dispose(), admin.context.dispose()])
  })

  test('nhận và xử lý báo cáo bằng dữ liệu QA', async ({ page }) => {
    const candidate = await apiLogin('candidate@jobconnect.local')
    const jobsResponse = await candidate.context.get('/api/jobs?limit=1', { headers: { Authorization: `Bearer ${candidate.token}` } })
    const jobs = (await jobsResponse.json()).data.items
    expect(jobs.length).toBeGreaterThan(0)
    const created = await candidate.context.post('/api/reports', { headers: { Authorization: `Bearer ${candidate.token}` }, data: { targetType: 'JOB', targetId: jobs[0].id, reason: 'MISLEADING', description: 'Báo cáo kiểm thử quản trị trên dữ liệu QA tách biệt.' } })
    expect(created.status()).toBe(201)
    await candidate.context.dispose()

    await uiLogin(page)
    await page.getByRole('button', { name: 'Báo cáo vi phạm' }).click()
    await expect(page.getByRole('heading', { name: 'Báo cáo vi phạm' })).toBeVisible()
    await page.getByRole('button', { name: 'Xem và xử lý' }).first().click()
    await expect(page.getByRole('dialog')).toContainText('Báo cáo kiểm thử quản trị')
    await page.getByRole('button', { name: 'Bắt đầu xem xét' }).click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Xác nhận' }).click()
    await expect(page.getByText('Thao tác đã được ghi nhận.')).toBeVisible()
  })

  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    test(`giao diện quản trị không tràn ngang ở ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await uiLogin(page)
      if (viewport.width <= 760) {
        await page.getByRole('button', { name: 'Mở menu quản trị' }).click()
        await expect(page.locator('.admin-sidebar')).toBeVisible()
        await page.locator('.app-workspace-close').click()
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    })
  }
})
