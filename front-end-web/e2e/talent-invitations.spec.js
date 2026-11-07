import { expect, test } from '@playwright/test'

const user = { id: 1, role: 'CANDIDATE', fullName: 'Ứng viên QA' }
const job = { id: 21, title: 'Backend Engineer', location: 'Hồ Chí Minh', employmentType: 'FULL_TIME', status: 'PUBLISHED', deadline: '2099-01-01T00:00:00.000Z', company: { id: 3, name: 'Công ty Acme', logoUrl: null } }

async function mockInvitationApi(page) {
  let status = 'PENDING'
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/refresh') return route.fulfill({ json: { success: true, data: { token: 'candidate-token', user } } })
    if (path === '/api/notifications') return route.fulfill({ json: { success: true, data: { items: [], unreadCount: 0 } } })
    if (path === '/api/conversations/unread-count') return route.fulfill({ json: { success: true, data: { count: 0 } } })
    if (path === '/api/candidates/me/invitations/7' && route.request().method() === 'PATCH') { status = route.request().postDataJSON().status; return route.fulfill({ json: { success: true, data: invitation(status) } }) }
    if (path === '/api/candidates/me/invitations/7') return route.fulfill({ json: { success: true, data: invitation(status) } })
    if (path === '/api/candidates/me/invitations') return route.fulfill({ json: { success: true, data: { items: [invitation(status)], page: 1, limit: 8, total: 1, totalPages: 1, pendingCount: status === 'PENDING' ? 1 : 0 } } })
    return route.fulfill({ json: { success: true, data: {} } })
  })
}

function invitation(status) {
  return { id: 7, status, message: 'Hồ sơ của bạn rất phù hợp. Hãy trao đổi cùng chúng tôi.', createdAt: '2026-11-07T02:00:00.000Z', respondedAt: status === 'PENDING' ? null : new Date().toISOString(), job, isActionable: status === 'PENDING', unavailableReason: null }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test(`candidate inbox is responsive at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await mockInvitationApi(page)
    await page.goto('/invitations')
    await expect(page.getByRole('heading', { name: 'Lời mời tuyển dụng' })).toBeVisible()
    await expect(page.getByText('Backend Engineer')).toBeVisible()
    await page.getByRole('button', { name: 'Xem chi tiết' }).click()
    await expect(page.getByRole('dialog', { name: 'Chi tiết lời mời' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
    await page.keyboard.press('Escape')
    await context.close()
  })
}

test('candidate confirms an invitation response without native browser dialogs', async ({ page }) => {
  await mockInvitationApi(page)
  page.on('dialog', (dialog) => { throw new Error(`Unexpected native dialog: ${dialog.type()}`) })
  await page.goto('/invitations/7')
  await page.getByRole('button', { name: 'Chấp nhận' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Chấp nhận lời mời?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page.getByText('Bạn đã chấp nhận lời mời.')).toBeVisible()
  await expect(page.getByText('Đã chấp nhận').first()).toBeVisible()
})
