import { expect, test } from '@playwright/test'

test.describe('secure password recovery UI', () => {
  test('forgot-password keeps a generic response and is responsive', async ({ page }) => {
    await page.route('**/api/auth/password-reset/request', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Nếu email tồn tại, yêu cầu đặt lại mật khẩu đã được tạo' }),
    }))

    await page.goto('/login')
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await page.getByLabel('Email').fill('unknown@example.test')
    await page.getByRole('button', { name: 'Gửi hướng dẫn' }).click()
    await expect(page.getByRole('alert')).toHaveText('Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.')

    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport)
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
    }
  })

  test('reset-password handles missing, mismatched, invalid and valid tokens without rendering the token', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByRole('alert')).toContainText('thiếu token')
    await expect(page.getByRole('button', { name: 'Đặt lại mật khẩu' })).toBeDisabled()

    const token = 'qa01-browser-only-reset-token-1234567890'
    await page.goto(`/reset-password?token=${token}`)
    await expect(page.locator('body')).not.toContainText(token)
    await page.getByLabel('Mật khẩu mới').fill('NewPassword123!')
    await page.getByLabel('Xác nhận mật khẩu').fill('MismatchPassword123!')
    await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click()
    await expect(page.getByRole('alert')).toHaveText('Mật khẩu xác nhận không khớp.')

    await page.route('**/api/auth/password-reset/confirm', (route) => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn' }),
    }))
    await page.getByLabel('Xác nhận mật khẩu').fill('NewPassword123!')
    await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click()
    await expect(page.getByRole('alert')).toContainText('không hợp lệ hoặc đã hết hạn')

    await page.unroute('**/api/auth/password-reset/confirm')
    await page.route('**/api/auth/password-reset/confirm', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Đặt lại mật khẩu thành công' }),
    }))
    await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click()
    await expect(page.getByRole('alert')).toContainText('Đặt lại mật khẩu thành công')
    await expect(page).toHaveURL(/\/login\?reset=success$/, { timeout: 5_000 })
  })
})
