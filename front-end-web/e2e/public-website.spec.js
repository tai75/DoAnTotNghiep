import { expect, test } from '@playwright/test'

test.describe('Website công khai', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test.beforeEach(async ({ page }) => {
    page.seriousErrors = []
    page.expectedHttpErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) page.seriousErrors.push(message.text())
    })
    page.on('response', (response) => {
      const expected = page.expectedHttpErrors.some(({ status, suffix }) => response.status() === status && response.url().endsWith(suffix))
      if (response.status() >= 400 && !expected && !(response.status() === 401 && response.url().endsWith('/api/auth/refresh'))) page.seriousErrors.push(`HTTP ${response.status()}: ${response.url()}`)
    })
    page.on('pageerror', (error) => page.seriousErrors.push(error.message))
  })
  test.afterEach(async ({ page }) => expect(page.seriousErrors, `Lỗi trình duyệt: ${page.seriousErrors.join(' | ')}`).toEqual([]))

  test('trang chủ, điều hướng và dữ liệu thật', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Job Connect/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tìm công việc phù hợp')
    await expect(page.getByRole('link', { name: 'Việc làm', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Doanh nghiệp', exact: true }).first()).toBeVisible()
    await expect(page.getByText(/việc làm đang tuyển/).first()).toBeVisible()
  })

  test('tìm kiếm giữ trạng thái trên URL và lịch sử trình duyệt', async ({ page }) => {
    await page.goto('/jobs')
    await page.getByLabel('Từ khóa').fill('Developer')
    await page.getByLabel('Địa điểm').fill('Hà Nội')
    await page.getByRole('button', { name: 'Áp dụng' }).click()
    await expect(page).toHaveURL(/search=Developer/)
    await expect(page).toHaveURL(/location=H%C3%A0\+N%E1%BB%99i/)
    await page.getByLabel('Từ khóa').fill('Engineer')
    await page.getByRole('button', { name: 'Áp dụng' }).click()
    await expect(page).toHaveURL(/search=Engineer/)
    await page.goBack()
    await expect(page.getByLabel('Từ khóa')).toHaveValue('Developer')
  })

  test('danh sách và chi tiết doanh nghiệp', async ({ page }) => {
    await page.goto('/companies')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Khám phá doanh nghiệp')
    const companyLink = page.getByRole('link', { name: 'Xem doanh nghiệp →' }).first()
    if (await companyLink.count()) {
      await companyLink.click()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText('Giới thiệu doanh nghiệp')).toBeVisible()
      await expect(page.getByText(/việc làm đang tuyển/).first()).toBeVisible()
    }
  })

  test('chi tiết việc làm và trạng thái không khả dụng', async ({ page }) => {
    await page.goto('/jobs')
    const firstJob = page.locator('.public-job-card').first()
    if (await firstJob.count()) {
      await firstJob.press('Enter')
      await expect(page).toHaveURL(/\/jobs\/\d+/)
      await expect(page.locator('.public-job-detail').getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Mô tả công việc' })).toBeVisible()
      await expect(page.getByText(/Hạn nộp:/).first()).toBeVisible()
    }
    page.expectedHttpErrors.push({ status: 404, suffix: '/api/jobs/99999999' })
    await page.goto('/jobs/99999999')
    await expect(page.getByText('Việc làm không khả dụng')).toBeVisible()
  })

  test('404 và liên kết đăng nhập, đăng ký', async ({ page }) => {
    await page.goto('/duong-dan-khong-ton-tai')
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible()
    await page.getByRole('link', { name: 'Về trang chủ' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'Đăng nhập' }).first()).toHaveAttribute('href', /\/login/)
    await expect(page.getByRole('link', { name: 'Đăng ký' }).first()).toHaveAttribute('href', '/register')
  })

  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    test(`không tràn ngang ở ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      for (const path of ['/', '/jobs', '/companies']) {
        await page.goto(path)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        expect(overflow).toBe(false)
      }
      if (viewport.width < 900) {
        await page.goto('/')
        await page.getByRole('button', { name: 'Mở menu điều hướng' }).click()
        const drawer = page.getByRole('complementary', { name: 'Menu điều hướng' })
        await expect(drawer).toBeVisible()
        await expect(page.getByRole('button', { name: 'Đóng menu', exact: true })).toBeFocused()
        await expect(drawer.getByRole('link', { name: 'Doanh nghiệp' })).toBeVisible()
      }
    })
  }
})
