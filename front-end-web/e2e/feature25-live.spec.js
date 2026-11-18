import { expect, test } from '@playwright/test'

const recruiterEmail = process.env.FEATURE25_RECRUITER_EMAIL
const candidateEmail = process.env.FEATURE25_CANDIDATE_EMAIL
const invitationCandidateEmail = process.env.FEATURE25_INVITATION_CANDIDATE_EMAIL
const invitationCandidateName = process.env.FEATURE25_INVITATION_CANDIDATE_NAME
const password = process.env.FEATURE25_PASSWORD
const conversationId = Number(process.env.FEATURE25_CONVERSATION_ID)
const invitationJobId = Number(process.env.FEATURE25_INVITATION_JOB_ID)

if (!recruiterEmail || !candidateEmail || !invitationCandidateEmail || !invitationCandidateName || !password || !conversationId || !invitationJobId) {
  throw new Error('FEATURE25 browser environment is incomplete')
}

async function browserLogin(page, email) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.locator('form.auth-form button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function expectResponsiveVietnamese(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const visibleText = await page.locator('body').innerText()
  expect(visibleText).not.toMatch(/Ãƒ.|Ã‚.|Ã„.|Ã¡Â»|Ã¡Âº/)
}

test('tin nhắn hai phía, polling/read, lỗi gửi, invitation và responsive', async ({ browser }) => {
  const stamp = Date.now()
  const recruiterText = `Tin nhắn trình duyệt recruiter ${stamp}`
  const candidateText = `Phản hồi trình duyệt candidate ${stamp}`
  const failedText = `Nội dung phải được giữ lại ${stamp}`
  const invitationText = `Mời bạn ứng tuyển qua trình duyệt ${stamp}`
  const recruiterErrors = []
  const candidateErrors = []

  const recruiterContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const recruiterPage = await recruiterContext.newPage()
  recruiterPage.on('pageerror', (error) => recruiterErrors.push(error.message))
  await browserLogin(recruiterPage, recruiterEmail)
  await recruiterPage.goto('/messages')
  await expect(recruiterPage.getByRole('heading', { name: 'Trao đổi tuyển dụng' })).toBeVisible()
  const targetThread = recruiterPage.locator('.message-thread').filter({ hasText: 'Ứng viên A FEATURE25' }).first()
  await targetThread.click()
  await expect(recruiterPage.locator('.message-panel form textarea')).toBeVisible()
  await recruiterPage.locator('.message-panel form textarea').fill(recruiterText)
  const recruiterSend = recruiterPage.waitForResponse((response) => response.url().endsWith(`/api/conversations/${conversationId}/messages`) && response.request().method() === 'POST')
  await recruiterPage.locator('.message-panel form').getByRole('button', { name: 'Gửi' }).click()
  expect((await recruiterSend).status()).toBe(201)
  await expect(recruiterPage.locator('.message-panel').getByText(recruiterText, { exact: true })).toBeVisible()

  const candidateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const candidatePage = await candidateContext.newPage()
  candidatePage.on('pageerror', (error) => candidateErrors.push(error.message))
  await browserLogin(candidatePage, candidateEmail)
  await candidatePage.goto('/messages')
  await candidatePage.locator('.message-thread').first().click()
  await expect(candidatePage.locator('.message-panel').getByText(recruiterText, { exact: true })).toBeVisible()
  await expectResponsiveVietnamese(candidatePage)
  await candidatePage.locator('.message-panel form textarea').fill(candidateText)
  const candidateSend = candidatePage.waitForResponse((response) => response.url().endsWith(`/api/conversations/${conversationId}/messages`) && response.request().method() === 'POST')
  await candidatePage.locator('.message-panel form').getByRole('button', { name: 'Gửi' }).click()
  expect((await candidateSend).status()).toBe(201)

  await expect(recruiterPage.locator('.message-panel').getByText(candidateText, { exact: true })).toBeVisible({ timeout: 9_000 })
  await expect(recruiterPage.locator('.app-action-button[href="/messages"] b')).toHaveCount(0, { timeout: 9_000 })
  await recruiterPage.reload()
  await targetThread.click()
  await expect(recruiterPage.locator('.message-panel').getByText(recruiterText, { exact: true })).toBeVisible()
  await expect(recruiterPage.locator('.message-panel').getByText(candidateText, { exact: true })).toBeVisible()

  const otherThread = recruiterPage.locator('.message-thread:not(.active)').first()
  await expect(otherThread).toBeVisible()
  await otherThread.click()
  await expect(recruiterPage.locator('.message-panel').getByText(recruiterText, { exact: true })).toHaveCount(0)
  await recruiterPage.locator('.message-thread').filter({ hasText: 'Ứng viên A FEATURE25' }).first().click()
  await expect(recruiterPage.locator('.message-panel').getByText(candidateText, { exact: true })).toBeVisible()

  await recruiterPage.route(`**/api/conversations/${conversationId}/messages`, async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Lỗi gửi kiểm thử' }) })
    else await route.continue()
  })
  await recruiterPage.locator('.message-panel form textarea').fill(failedText)
  await recruiterPage.locator('.message-panel form').getByRole('button', { name: 'Gửi' }).click()
  await expect(recruiterPage.getByText('Lỗi gửi kiểm thử', { exact: true })).toBeVisible()
  await expect(recruiterPage.locator('.message-panel form textarea')).toHaveValue(failedText)
  await recruiterPage.unroute(`**/api/conversations/${conversationId}/messages`)
  await expectResponsiveVietnamese(recruiterPage)

  await recruiterPage.setViewportSize({ width: 390, height: 844 })
  await expect(recruiterPage.locator('.message-panel form textarea')).toBeVisible()
  await expectResponsiveVietnamese(recruiterPage)
  await recruiterPage.setViewportSize({ width: 1440, height: 900 })

  await recruiterPage.goto(`/recruiter/talent?jobId=${invitationJobId}`)
  const talentRow = recruiterPage.locator('.talent-row').filter({ hasText: invitationCandidateName })
  await expect(talentRow).toBeVisible()
  await expect(talentRow).not.toContainText(invitationCandidateEmail)
  await talentRow.getByRole('button', { name: 'Mời ứng tuyển' }).click()
  const inviteDialog = recruiterPage.getByRole('dialog')
  await inviteDialog.getByLabel('Lời nhắn').fill(invitationText)
  const inviteResponse = recruiterPage.waitForResponse((response) => response.url().endsWith('/api/recruiters/talent/invite') && response.request().method() === 'POST')
  await inviteDialog.getByRole('button', { name: 'Gửi lời mời' }).click()
  expect((await inviteResponse).status()).toBe(201)
  await expect(recruiterPage.getByText('Đã gửi lời mời tới ứng viên.')).toBeVisible()

  const inviteContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const invitePage = await inviteContext.newPage()
  const inviteErrors = []
  invitePage.on('pageerror', (error) => inviteErrors.push(error.message))
  await browserLogin(invitePage, invitationCandidateEmail)
  await invitePage.goto('/invitations')
  await expect(invitePage.getByText(invitationText, { exact: true })).toBeVisible()
  await invitePage.getByRole('button', { name: /Thông báo/ }).click()
  await expect(invitePage.getByRole('dialog', { name: 'Thông báo' }).getByText('Bạn được mời ứng tuyển', { exact: true }).first()).toBeVisible()
  await invitePage.getByRole('dialog', { name: 'Thông báo' }).getByRole('button', { name: 'Đóng thông báo' }).click()
  await invitePage.locator('.invitation-card').filter({ hasText: invitationText }).getByRole('button', { name: 'Xem chi tiết' }).click()
  await invitePage.getByRole('dialog', { name: 'Chi tiết lời mời' }).getByRole('button', { name: 'Chấp nhận' }).click()
  const confirmDialog = invitePage.getByRole('dialog', { name: 'Chấp nhận lời mời?' })
  const acceptResponse = invitePage.waitForResponse((response) => response.url().includes('/api/candidates/me/invitations/') && response.request().method() === 'PATCH')
  await confirmDialog.getByRole('button', { name: 'Xác nhận' }).click()
  expect((await acceptResponse).status()).toBe(200)
  await expect(invitePage.getByText('Bạn đã chấp nhận lời mời.')).toBeVisible()
  await invitePage.reload()
  await expect(invitePage.locator('.invitation-card').filter({ hasText: invitationText })).toContainText('Đã chấp nhận')
  await expectResponsiveVietnamese(invitePage)

  await recruiterPage.reload()
  const acceptedRow = recruiterPage.locator('.talent-row').filter({ hasText: invitationCandidateName })
  await expect(acceptedRow).toContainText('Đã chấp nhận')
  await expect(acceptedRow).toContainText(invitationCandidateEmail)
  await expectResponsiveVietnamese(recruiterPage)

  expect(recruiterErrors).toEqual([])
  expect(candidateErrors).toEqual([])
  expect(inviteErrors).toEqual([])
  await Promise.all([recruiterContext.close(), candidateContext.close(), inviteContext.close()])
})
