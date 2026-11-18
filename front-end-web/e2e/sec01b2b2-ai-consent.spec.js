import { expect, request, test } from '@playwright/test'
import { disposableEnvironment } from './support/disposable-env'

const { apiBaseURL: apiBase, password } = disposableEnvironment()

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.locator('form.auth-form button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('AI consent mặc định tắt, tách scope và withdrawal chặn request mới', async ({ page }) => {
  const email = `ai-consent-${Date.now()}@jobconnect.local`
  const context = await request.newContext({ baseURL: apiBase })
  const registered = await context.post('/api/auth/register', { data: { email, password, fullName: 'Ứng viên AI Consent', role: 'CANDIDATE' } })
  expect(registered.status()).toBe(201)
  const token = (await registered.json()).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
  const uploaded = await context.post('/api/candidates/me/resumes', { headers, multipart: { file: { name: 'ai-consent.pdf', mimeType: 'application/pdf', buffer: pdf }, isDefault: 'true' } })
  expect(uploaded.status()).toBe(201)
  const resumeId = (await uploaded.json()).data.id

  await login(page, email)
  await page.locator('.app-account-button').click()
  await page.getByRole('menuitem', { name: 'Cài đặt tài khoản' }).click()
  const resumeImport = page.getByLabel('Nhập hồ sơ từ CV')
  await expect(resumeImport).not.toBeChecked()
  await expect(page.getByText('Nhà cung cấp: Google Gemini.')).toBeVisible()

  await resumeImport.click()
  await expect(page.getByText('Đã lưu lựa chọn sử dụng AI.')).toBeVisible()
  await expect(resumeImport).toBeChecked()
  expect((await context.get('/api/ai/consents', { headers }).then((response) => response.json())).data.items.find((item) => item.scope === 'RESUME_IMPORT').active).toBe(true)
  await page.getByLabel('Nhập hồ sơ từ CV').click()
  await expect(page.getByText(/Đã rút lại đồng ý/)).toBeVisible()
  await expect(resumeImport).not.toBeChecked()
  expect((await context.get('/api/ai/consents', { headers }).then((response) => response.json())).data.items.find((item) => item.scope === 'RESUME_IMPORT').active).toBe(false)

  expect((await context.put('/api/ai/consents/AI_CHAT', { headers })).status()).toBe(200)
  expect((await context.post(`/api/candidates/me/resumes/${resumeId}/import`, { headers })).status()).toBe(403)
  expect((await context.delete('/api/ai/consents/AI_CHAT', { headers })).status()).toBe(200)
  await context.dispose()
})
