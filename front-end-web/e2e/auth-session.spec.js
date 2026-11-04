import { expect, test } from '@playwright/test'

const accounts = {
  candidate: { email: 'candidate@jobconnect.local', path: '/jobs' },
  recruiter: { email: 'recruiter@jobconnect.local', path: '/recruiter' },
  admin: { email: 'admin@jobconnect.local', path: '/admin' },
}

for (const [role, account] of Object.entries(accounts)) {
  test(`${role}: UI login, refresh restore, logout`, async ({ page }, testInfo) => {
    test.skip(process.env.QA_RUN_AUTH_SESSION !== '1', 'Opt-in because logout revokes every active refresh token for the user; run after authenticated suites.')
    test.skip(testInfo.project.name !== 'desktop-1440', 'Authentication behavior is viewport-independent and runs once per role.')
    const password = process.env.QA_PASSWORD
    if (!password) throw new Error('QA_PASSWORD is required; do not hardcode it in the test suite.')

    await page.goto('/login')
    await page.getByLabel('Email').fill(account.email)
    await page.getByLabel('Mật khẩu').fill(password)
    await page.locator('form.auth-form button[type="submit"]').click()
    await expect(page).toHaveURL(new RegExp(`${account.path.replace('/', '\\/')}(?:[/?]|$)`))

    await page.reload()
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(new RegExp(`${account.path.replace('/', '\\/')}(?:[/?]|$)`))

    await page.locator('.app-account-button').click()
    await page.locator('.app-account-menu button').click()
    if (role === 'candidate') {
      await expect(page.locator('.app-login-link')).toBeVisible()
      await page.goto('/profile')
      await expect(page).toHaveURL(/\/login/)
    } else {
      await expect(page).toHaveURL(/\/login/)
    }
  })
}
