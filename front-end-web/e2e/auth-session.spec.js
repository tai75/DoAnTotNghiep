import { expect, test } from '@playwright/test'
import { disposableAccounts, disposableEnvironment } from './support/disposable-env'

const accounts = {
  candidate: { email: disposableAccounts.candidate, path: '/jobs' },
  recruiter: { email: disposableAccounts.recruiter, path: '/recruiter' },
  admin: { email: disposableAccounts.admin, path: '/admin' },
}

for (const [role, account] of Object.entries(accounts)) {
  test(`${role}: UI login, refresh restore, logout`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'disposable-auth-session', 'Authentication behavior runs only in the final disposable project.')
    const { password } = disposableEnvironment()

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
