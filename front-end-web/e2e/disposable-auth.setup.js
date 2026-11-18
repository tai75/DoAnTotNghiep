import fs from 'node:fs/promises'
import { expect, request, test } from '@playwright/test'
import { authStatePath, disposableAccounts, disposableEnvironment } from './support/disposable-env'

for (const [role, email] of Object.entries(disposableAccounts)) {
  test(`prepare isolated ${role} auth state`, async () => {
    const environment = disposableEnvironment()
    await fs.mkdir(environment.authRoot, { recursive: true })
    const context = await request.newContext({ baseURL: environment.apiBaseURL })
    try {
      const response = await context.post('/api/auth/login', { data: { email, password: environment.password } })
      expect(response.status()).toBe(200)
      await context.storageState({ path: authStatePath(role) })
    } finally {
      await context.dispose()
    }
  })
}
