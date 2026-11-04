import { request } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const accounts = {
  candidate: 'candidate@jobconnect.local',
  recruiter: 'recruiter@jobconnect.local',
  admin: 'admin@jobconnect.local',
}

export default async function globalSetup() {
  if (process.env.QA_SKIP_AUTH_SETUP === '1') return
  const password = process.env.QA_PASSWORD
  if (!password) throw new Error('QA_PASSWORD is required; do not hardcode it in the test suite.')
  const directory = path.resolve('.auth')
  await fs.mkdir(directory, { recursive: true })

  for (const [role, email] of Object.entries(accounts)) {
    const context = await request.newContext({ baseURL: process.env.QA_API_URL || 'http://localhost:5000' })
    const response = await context.post('/api/auth/login', { data: { email, password } })
    if (!response.ok()) throw new Error(`Cannot prepare ${role} auth state: HTTP ${response.status()}`)
    await context.storageState({ path: path.join(directory, `${role}.json`) })
    await context.dispose()
  }
}
