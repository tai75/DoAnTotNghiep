import { expect, request, test } from '@playwright/test'

const apiBase = 'http://127.0.0.1:5101'
const password = process.env.QA01_PASSWORD

async function loginPage(page, email, accountPassword = password) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(accountPassword)
  await page.locator('form.auth-form button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function apiLogin(email) {
  const context = await request.newContext({ baseURL: apiBase })
  const response = await context.post('/api/auth/login', { data: { email, password } })
  expect(response.status()).toBe(200)
  return { context, token: (await response.json()).data.token }
}

test.describe.serial('Quản lý tài khoản', () => {
  test('ứng viên cập nhật thông tin và đổi mật khẩu an toàn', async ({ page }) => {
    const email = `account-${Date.now()}@jobconnect.local`
    const registrationContext = await request.newContext({ baseURL: apiBase })
    const registered = await registrationContext.post('/api/auth/register', { data: { email, password, fullName: 'Tài khoản kiểm thử', role: 'CANDIDATE' } })
    expect(registered.status()).toBe(201)
    await registrationContext.dispose()

    await loginPage(page, email)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Cài đặt tài khoản' })).toBeVisible()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    await page.getByLabel('Họ và tên').fill('Ứng viên đã cập nhật')
    await page.getByLabel(/Số điện thoại/).fill('0901234567')
    await page.getByRole('button', { name: 'Lưu thông tin' }).click()
    await expect(page.getByText('Thông tin tài khoản đã được cập nhật.')).toBeVisible()

    await page.getByLabel('Mật khẩu hiện tại').fill('sai-mat-khau')
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('MatKhauMoi123!')
    await page.getByLabel('Xác nhận mật khẩu mới').fill('MatKhauMoi123!')
    await page.getByRole('button', { name: 'Đổi mật khẩu' }).click()
    await expect(page.getByRole('alert')).toContainText('Mật khẩu hiện tại không đúng')
    await page.getByLabel('Mật khẩu hiện tại').fill(password)
    await page.getByRole('button', { name: 'Đổi mật khẩu' }).click()
    await expect(page).toHaveURL(/\/login\?passwordChanged=1/)
    await expect(page.getByText('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.')).toBeVisible()
    await loginPage(page, email, 'MatKhauMoi123!')
  })

  test('ứng viên chỉnh sửa học vấn, kinh nghiệm và dự án bằng PATCH hiện có', async ({ page }) => {
    const candidate = await apiLogin('candidate@jobconnect.local')
    const headers = { Authorization: `Bearer ${candidate.token}` }
    expect((await candidate.context.post('/api/candidates/me/experiences', { headers, data: { company: 'Công ty ban đầu', title: 'Lập trình viên', description: 'Mô tả ban đầu' } })).status()).toBe(201)
    expect((await candidate.context.post('/api/candidates/me/projects', { headers, data: { name: 'Dự án ban đầu', description: 'Mô tả ban đầu', technologies: [] } })).status()).toBe(201)
    await candidate.context.dispose()

    await loginPage(page, 'candidate@jobconnect.local')
    await page.goto('/profile')
    for (const item of [
      { tab: 'Học vấn', label: 'Trường học', value: 'Đại học đã cập nhật' },
      { tab: 'Kinh nghiệm', label: 'Công ty', value: 'Công ty đã cập nhật' },
      { tab: 'Dự án', label: 'Tên dự án', value: 'Dự án đã cập nhật' }
    ]) {
      await page.getByRole('button', { name: item.tab, exact: true }).click()
      await page.locator('.resource-item').first().getByRole('button', { name: 'Sửa' }).click()
      await page.getByLabel(item.label).fill(item.value)
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
      await expect(page.getByText('Đã cập nhật thông tin.')).toBeVisible()
      await expect(page.locator('.resource-item').filter({ hasText: item.value })).toBeVisible()
    }
  })

  for (const account of [
    { role: 'ứng viên', email: 'candidate@jobconnect.local' },
    { role: 'nhà tuyển dụng', email: 'recruiter@jobconnect.local' },
    { role: 'quản trị viên', email: 'admin@jobconnect.local' }
  ]) {
    test(`${account.role} truy cập cài đặt từ menu tài khoản`, async ({ page }) => {
      await loginPage(page, account.email)
      await page.locator('.app-account-button').click()
      await page.getByRole('menuitem', { name: 'Cài đặt tài khoản' }).click()
      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByRole('heading', { name: 'Cài đặt tài khoản' })).toBeVisible()
    })
  }

  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    test(`cài đặt không tràn ngang ở ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginPage(page, 'candidate@jobconnect.local')
      await page.goto('/settings')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    })
  }
})
