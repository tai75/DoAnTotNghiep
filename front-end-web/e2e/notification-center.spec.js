import { expect, test } from '@playwright/test'

const users = {
  CANDIDATE: { id: 1, role: 'CANDIDATE', fullName: 'Candidate QA' },
  RECRUITER: { id: 2, role: 'RECRUITER', fullName: 'Recruiter QA' },
  ADMIN: { id: 3, role: 'ADMIN', fullName: 'Admin QA' }
}

function notificationFor(role) {
  if (role === 'CANDIDATE') return { id: 101, type: 'APPLICATION_STATUS_CHANGED', title: 'Đơn ứng tuyển được cập nhật', content: 'Hồ sơ đang được xem xét.', link: 'https://evil.example/admin', isRead: false, createdAt: new Date().toISOString() }
  if (role === 'RECRUITER') return { id: 102, type: 'NEW_APPLICATION', title: 'Có đơn ứng tuyển mới', content: 'Một ứng viên vừa nộp hồ sơ.', link: '/recruiter/applications/42', isRead: false, createdAt: new Date().toISOString() }
  return { id: 103, type: 'SYSTEM', title: 'Thông báo hệ thống', content: 'Thông tin quản trị.', link: 'https://evil.example/phish', isRead: false, createdAt: new Date().toISOString() }
}

async function mockAuthenticatedApi(page, role, { notificationFailures = 0 } = {}) {
  let notificationRequests = 0
  let read = false
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/auth/refresh') return route.fulfill({ status: 200, json: { success: true, data: { token: `token-${role}`, user: users[role] } } })
    if (path === '/api/auth/logout') return route.fulfill({ status: 200, json: { success: true, data: {} } })
    if (path === '/api/notifications' && route.request().method() === 'GET') {
      notificationRequests += 1
      if (notificationRequests <= notificationFailures) return route.fulfill({ status: 503, json: { success: false, message: 'Notification service unavailable' } })
      return route.fulfill({ status: 200, json: { success: true, data: { items: [{ ...notificationFor(role), isRead: read }], unreadCount: read ? 0 : 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } } })
    }
    if (/\/api\/notifications\/\d+\/read$/.test(path)) { read = true; return route.fulfill({ status: 200, json: { success: true, data: { ...notificationFor(role), isRead: true } } }) }
    if (path === '/api/notifications/read-all') { read = true; return route.fulfill({ status: 200, json: { success: true, data: {} } }) }
    if (path === '/api/conversations/unread-count') return route.fulfill({ status: 200, json: { success: true, data: { count: 0 } } })
    if (path === '/api/jobs') return route.fulfill({ status: 200, json: { success: true, data: { items: [], pagination: { total: 0, totalPages: 0 } } } })
    if (path === '/api/candidates/me/saved-jobs' || path === '/api/applications/me') return route.fulfill({ status: 200, json: { success: true, data: [] } })
    if (path === '/api/candidates/me') return route.fulfill({ status: 200, json: { success: true, data: { resumes: [] } } })
    if (path === '/api/recruiters/stats') return route.fulfill({ status: 200, json: { success: true, data: { jobsByStatus: {}, timeline: [], applicationsByStatus: {}, applicationsByJob: [] } } })
    if (path === '/api/companies/me') return route.fulfill({ status: 200, json: { success: true, data: { name: 'QA Company' } } })
    if (path === '/api/jobs/me' || path === '/api/candidates/skills') return route.fulfill({ status: 200, json: { success: true, data: [] } })
    if (path === '/api/admin/stats') return route.fulfill({ status: 200, json: { success: true, data: { users: 0, candidates: 0, recruiters: 0, companies: 0, jobs: 0, pendingJobs: 0, applications: 0, series: [] } } })
    if (path.startsWith('/api/admin/jobs') || path.startsWith('/api/admin/users')) return route.fulfill({ status: 200, json: { success: true, data: { items: [] } } })
    return route.fulfill({ status: 200, json: { success: true, data: [] } })
  })
  return () => notificationRequests
}

test('bell works for every authenticated role across mobile, tablet and desktop', async ({ browser }) => {
  const cases = [
    ['CANDIDATE', '/jobs', { width: 390, height: 844 }],
    ['RECRUITER', '/recruiter', { width: 768, height: 1024 }],
    ['ADMIN', '/admin', { width: 1440, height: 900 }]
  ]
  for (const [role, path, viewport] of cases) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await mockAuthenticatedApi(page, role)
    await page.goto(path)
    const bell = page.getByRole('button', { name: /Thông báo/ })
    await expect(bell).toBeVisible()
    await bell.click()
    const dialog = page.getByRole('dialog', { name: 'Thông báo' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(bell).toBeFocused()
    await bell.click()
    await expect(page.getByText(notificationFor(role).title)).toBeVisible()
    await dialog.getByRole('button', { name: 'Đọc tất cả' }).click()
    await expect(dialog.getByRole('button', { name: 'Đọc tất cả' })).toBeDisabled()
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
    await context.close()
  }
})

test('uses role-safe deep links and marks the item read before navigation', async ({ page }) => {
  await mockAuthenticatedApi(page, 'CANDIDATE')
  await page.goto('/jobs')
  await page.getByRole('button', { name: /Thông báo/ }).click()
  await page.getByRole('button', { name: /Đơn ứng tuyển được cập nhật/ }).click()
  await expect(page).toHaveURL(/\/my-jobs\?tab=applied$/)
  await expect(page).not.toHaveURL(/evil\.example/)
})

test('shows an error, retries, and stops polling after logout', async ({ page }) => {
  await page.clock.install()
  const requests = await mockAuthenticatedApi(page, 'CANDIDATE', { notificationFailures: 2 })
  await page.goto('/jobs')
  await page.getByRole('button', { name: /Thông báo/ }).click()
  await expect(page.getByRole('alert')).toContainText('Notification service unavailable')
  await page.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByText('Đơn ứng tuyển được cập nhật')).toBeVisible()
  await page.clock.fastForward(61_000)
  await expect.poll(requests).toBeGreaterThanOrEqual(4)
  await page.getByRole('dialog', { name: 'Thông báo' }).getByRole('button', { name: 'Đóng thông báo' }).click()
  await page.getByRole('button', { name: /Candidate QA/ }).click()
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click()
  const afterLogout = requests()
  await page.clock.fastForward(5 * 60_000)
  expect(requests()).toBe(afterLogout)
})
