import { expect, request, test } from '@playwright/test'

const apiBase = 'http://127.0.0.1:5101'
const password = process.env.QA01_PASSWORD
const accounts = {
  candidate: 'candidate@jobconnect.local',
  recruiter: 'recruiter@jobconnect.local',
  admin: 'admin@jobconnect.local',
}

async function login(role) {
  const context = await request.newContext({ baseURL: apiBase })
  const response = await context.post('/api/auth/login', { data: { email: accounts[role], password } })
  expect(response.status(), `${role} login`).toBe(200)
  const body = await response.json()
  expect(body.data.user.role).toBe(role.toUpperCase())
  return { context, token: body.data.token, user: body.data.user }
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` }
}

async function json(response) {
  const body = await response.json()
  expect(body.success).toBe(true)
  return body.data
}

test.describe.serial('QA-01 isolated authenticated E2E', () => {
  test('database-backed auth, refresh, unauthorized access, role isolation and API errors', async () => {
    const anonymous = await request.newContext({ baseURL: apiBase })
    expect((await anonymous.get('/api/admin/stats')).status()).toBe(401)
    expect((await anonymous.post('/api/auth/login', { data: { email: accounts.candidate, password: 'wrong-password' } })).status()).toBe(401)

    const candidate = await login('candidate')
    const recruiter = await login('recruiter')
    const admin = await login('admin')

    expect((await candidate.context.get('/api/admin/stats', { headers: authorization(candidate.token) })).status()).toBe(403)
    expect((await recruiter.context.get('/api/admin/stats', { headers: authorization(recruiter.token) })).status()).toBe(403)
    expect((await admin.context.post('/api/jobs', { headers: authorization(admin.token), data: { title: 'Forbidden admin job', description: 'This request must be rejected by role authorization.' } })).status()).toBe(403)
    expect((await candidate.context.post('/api/jobs', { headers: authorization(candidate.token), data: { title: 'Forbidden candidate job', description: 'This request must be rejected by role authorization.' } })).status()).toBe(403)

    const invalidJob = await recruiter.context.post('/api/jobs', { headers: authorization(recruiter.token), data: { title: 'x', description: 'short' } })
    expect(invalidJob.status()).toBe(400)
    expect((await anonymous.get('/api/jobs/999999')).status()).toBe(404)

    const refresh = await candidate.context.post('/api/auth/refresh')
    expect(refresh.status()).toBe(200)
    const refreshedToken = (await refresh.json()).data.token
    expect(refreshedToken).toBeTruthy()
    const logout = await candidate.context.post('/api/auth/logout', { headers: authorization(refreshedToken) })
    expect(logout.ok()).toBe(true)
    expect((await candidate.context.post('/api/auth/refresh')).status()).toBe(401)

    await Promise.all([anonymous.dispose(), candidate.context.dispose(), recruiter.context.dispose(), admin.context.dispose()])
  })

  test('synthetic CV and logo lifecycle uses isolated durable storage', async () => {
    const candidate = await login('candidate')
    const recruiter = await login('recruiter')
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
    const uploadedResponse = await candidate.context.post('/api/candidates/me/resumes', {
      headers: authorization(candidate.token),
      multipart: {
        file: { name: 'qa-storage-resume.pdf', mimeType: 'application/pdf', buffer: pdf },
        isDefault: 'false',
      },
    })
    expect(uploadedResponse.status()).toBe(201)
    const resume = await json(uploadedResponse)
    expect(resume.path).toMatch(/^[0-9a-f-]{36}\.pdf$/)

    const ownedDownload = await candidate.context.get(`/api/candidates/resumes/${resume.id}/download`, { headers: authorization(candidate.token) })
    expect(ownedDownload.status()).toBe(200)
    expect(ownedDownload.headers()['cache-control']).toBe('private, no-store')
    expect(await ownedDownload.body()).toEqual(pdf)
    expect((await recruiter.context.get(`/api/candidates/resumes/${resume.id}/download`, { headers: authorization(recruiter.token) })).status()).toBe(403)

    const renamed = await candidate.context.patch(`/api/candidates/me/resumes/${resume.id}`, {
      headers: authorization(candidate.token), data: { fileName: 'QA Unicode CV.pdf' },
    })
    expect((await json(renamed)).fileName).toBe('QA Unicode CV.pdf')
    expect((await candidate.context.delete(`/api/candidates/me/resumes/${resume.id}`, { headers: authorization(candidate.token) })).status()).toBe(204)
    expect((await candidate.context.get(`/api/candidates/resumes/${resume.id}/download`, { headers: authorization(candidate.token) })).status()).toBe(404)

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const logoResponse = await recruiter.context.post('/api/companies/me/logo', {
      headers: authorization(recruiter.token),
      multipart: { file: { name: 'qa-logo.png', mimeType: 'image/png', buffer: png } },
    })
    expect(logoResponse.status()).toBe(200)
    const company = await json(logoResponse)
    expect(company.logoUrl).toMatch(/^\/assets\/logos\/[0-9a-f-]{36}\.png$/)
    const logo = await recruiter.context.get(company.logoUrl)
    expect(logo.status()).toBe(200)
    expect(logo.headers()['x-content-type-options']).toBe('nosniff')

    await Promise.all([candidate.context.dispose(), recruiter.context.dispose()])
  })

  test('recruiter creates job, admin moderates, candidate applies, recruiter updates status', async () => {
    const recruiter = await login('recruiter')
    const admin = await login('admin')
    const candidate = await login('candidate')
    const title = 'QA-01 Isolated Full-stack Engineer'

    const createdResponse = await recruiter.context.post('/api/jobs', {
      headers: authorization(recruiter.token),
      data: {
        title,
        description: 'Synthetic QA-only full-stack position for repeatable authenticated end-to-end testing.',
        location: 'Ho Chi Minh City',
        employmentType: 'FULL_TIME',
        minSalary: 1500,
        maxSalary: 2500,
        requiredYearsExperience: 2,
        deadline: '2030-12-31T00:00:00.000Z',
        status: 'DRAFT',
      },
    })
    expect(createdResponse.status()).toBe(201)
    const job = await json(createdResponse)
    expect((await recruiter.context.post(`/api/jobs/${job.id}/submit`, { headers: authorization(recruiter.token) })).status()).toBe(200)

    const pending = await json(await admin.context.get('/api/admin/jobs?status=PENDING', { headers: authorization(admin.token) }))
    expect(pending.items.some((item) => item.id === job.id)).toBe(true)
    const pendingJob = pending.items.find((item) => item.id === job.id)
    const moderated = await admin.context.patch(`/api/admin/jobs/${job.id}/moderation`, {
      headers: authorization(admin.token),
      data: { status: 'PUBLISHED', note: 'QA-01 approval', expectedUpdatedAt: pendingJob.updatedAt },
    })
    expect(moderated.status()).toBe(200)

    const search = await json(await candidate.context.get(`/api/jobs?search=${encodeURIComponent(title)}`, { headers: authorization(candidate.token) }))
    expect(search.items.map((item) => item.id)).toContain(job.id)
    const detail = await json(await candidate.context.get(`/api/jobs/${job.id}`, { headers: authorization(candidate.token) }))
    expect(detail.title).toBe(title)

    const profile = await json(await candidate.context.get('/api/candidates/me', { headers: authorization(candidate.token) }))
    expect(profile.resumes).toHaveLength(1)
    const appliedResponse = await candidate.context.post(`/api/applications/jobs/${job.id}`, {
      headers: authorization(candidate.token),
      data: { resumeId: profile.resumes[0].id, coverLetter: 'QA-01 synthetic application' },
    })
    expect(appliedResponse.status()).toBe(201)
    const application = await json(appliedResponse)

    const mine = await json(await candidate.context.get('/api/applications/me', { headers: authorization(candidate.token) }))
    expect(mine.some((item) => item.id === application.id && item.status === 'APPLIED')).toBe(true)
    const managed = await json(await recruiter.context.get(`/api/applications/managed?jobId=${job.id}`, { headers: authorization(recruiter.token) }))
    expect(managed.items.some((item) => item.id === application.id)).toBe(true)
    const updated = await json(await recruiter.context.patch(`/api/applications/${application.id}/status`, {
      headers: authorization(recruiter.token),
      data: { status: 'REVIEWING', note: 'QA-01 reviewed', expectedStatus: 'APPLIED' },
    }))
    expect(updated.status).toBe('REVIEWING')

    const stats = await json(await admin.context.get('/api/admin/stats', { headers: authorization(admin.token) }))
    expect(stats.jobs).toBeGreaterThanOrEqual(2)
    expect(stats.applications).toBeGreaterThanOrEqual(1)

    for (const session of [candidate, recruiter, admin]) {
      expect((await session.context.post('/api/auth/logout', { headers: authorization(session.token) })).ok()).toBe(true)
      await session.context.dispose()
    }
  })

  test('recruiter sends invitation, candidate accepts in inbox, recruiter sees updated status', async ({ page }) => {
    const recruiter = await login('recruiter')
    const jobs = await json(await recruiter.context.get('/api/jobs/me', { headers: authorization(recruiter.token) }))
    const job = jobs.find((item) => item.title === 'QA-01 Existing Backend Engineer' && item.status === 'PUBLISHED')
    expect(job).toBeTruthy()
    const talent = await json(await recruiter.context.get(`/api/recruiters/talent?jobId=${job.id}`, { headers: authorization(recruiter.token) }))
    const candidate = talent.items.find((item) => !item.applied && !item.invitation)
    expect(candidate).toBeTruthy()

    const sent = await recruiter.context.post('/api/recruiters/talent/invite', {
      headers: authorization(recruiter.token),
      data: { candidateId: candidate.id, jobId: job.id, message: 'QA-01 synthetic talent invitation' },
    })
    expect(sent.status()).toBe(201)
    const invitation = await json(sent)

    await page.goto('/login')
    await page.getByLabel('Email').fill(accounts.candidate)
    await page.getByLabel('Mật khẩu').fill(password)
    await page.locator('form.auth-form button[type="submit"]').click()
    await expect(page).not.toHaveURL(/\/login/)
    await page.goto(`/invitations/${invitation.id}`)
    await expect(page.getByRole('dialog', { name: 'Chi tiết lời mời' })).toBeVisible()
    await page.getByRole('button', { name: 'Chấp nhận' }).click()
    await page.getByRole('dialog', { name: 'Chấp nhận lời mời?' }).getByRole('button', { name: 'Xác nhận' }).click()
    await expect(page.getByText('Bạn đã chấp nhận lời mời.')).toBeVisible()

    const refreshed = await json(await recruiter.context.get(`/api/recruiters/talent?jobId=${job.id}`, { headers: authorization(recruiter.token) }))
    expect(refreshed.items.find((item) => item.id === candidate.id).invitation.status).toBe('ACCEPTED')
    const notifications = await json(await recruiter.context.get('/api/notifications?limit=20', { headers: authorization(recruiter.token) }))
    expect(notifications.items.some((item) => item.type === 'TALENT_INVITATION_RESPONSE')).toBe(true)
    await recruiter.context.dispose()
  })

  test('global notification center works for candidate, recruiter and admin at required viewports', async ({ browser }) => {
    const cases = [
      { role: 'candidate', path: '/my-jobs', viewport: { width: 390, height: 844 }, title: 'Đơn ứng tuyển được cập nhật', destination: /\/my-jobs\?tab=applied$/ },
      { role: 'recruiter', path: '/recruiter', viewport: { width: 768, height: 1024 }, title: 'Có đơn ứng tuyển mới', destination: /\/recruiter\?section=applications&applicationId=\d+$/ },
      { role: 'admin', path: '/admin', viewport: { width: 1440, height: 900 }, title: null, destination: null },
    ]

    for (const item of cases) {
      const context = await browser.newContext({ viewport: item.viewport, locale: 'vi-VN' })
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.goto('/login')
      await page.getByLabel('Email').fill(accounts[item.role])
      await page.getByLabel('Mật khẩu').fill(password)
      await page.locator('form.auth-form button[type="submit"]').click()
      await expect(page, `${item.role} login completed`).not.toHaveURL(/\/login/)
      await page.goto(item.path)
      const bell = page.getByRole('button', { name: /Thông báo/ })
      await expect(bell).toBeVisible()
      await bell.click()
      const dialog = page.getByRole('dialog', { name: 'Thông báo' })
      await expect(dialog).toBeVisible()
      if (item.title) {
        await expect(dialog.getByText(item.title, { exact: true }).first()).toBeVisible()
        await dialog.getByRole('button', { name: new RegExp(item.title) }).first().click()
        await expect(page).toHaveURL(item.destination)
      } else {
        await expect(dialog.getByText('Chưa có thông báo')).toBeVisible()
      }
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
      if (item.role === 'candidate') {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto('/jobs')
        await expect(page.getByRole('button', { name: /Thông báo/ })).toBeVisible()
        const desktopDimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
        expect(desktopDimensions.scrollWidth).toBeLessThanOrEqual(desktopDimensions.width)
      }
      expect(pageErrors).toEqual([])
      await context.close()
    }
  })
})
