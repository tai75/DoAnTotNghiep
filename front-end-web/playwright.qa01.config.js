import { defineConfig } from '@playwright/test'

// QA-01 is a preserved database. Keeping an inert config prevents the old
// reset-seed webServer chain from being invoked accidentally.
export default defineConfig({
  testDir: './e2e',
  testMatch: [],
  reporter: 'line',
})
