import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { disposableEnvironment } from './e2e/support/disposable-env'

const environment = disposableEnvironment()
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const coreWorkflowTests = [
  'public-website.spec.js',
  'qa01-authenticated.spec.js',
  'qa02-verification.spec.js',
  'sec01b2b2-ai-consent.spec.js',
  'auth-recovery.spec.js',
  'admin-management.spec.js',
  'account-management.spec.js',
  'interview-workflow.spec.js',
]

const commonUse = {
  baseURL: environment.frontendBaseURL,
  headless: true,
  launchOptions: { executablePath: chromePath },
  locale: 'vi-VN',
  timezoneId: 'Asia/Ho_Chi_Minh',
  screenshot: 'off',
  trace: 'off',
  video: 'off',
  viewport: { width: 1440, height: 900 },
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [[path.resolve('./e2e/support/secure-reporter.cjs'), { outputFile: path.join(environment.artifactsRoot, 'playwright-results.json') }]],
  outputDir: path.join(environment.artifactsRoot, 'playwright'),
  projects: [
    { name: 'disposable-guard', testMatch: ['disposable-guard.setup.js'], use: commonUse },
    { name: 'disposable-core-workflows', testMatch: coreWorkflowTests, dependencies: ['disposable-guard'], use: commonUse },
    { name: 'disposable-auth-setup', testMatch: ['disposable-auth.setup.js'], dependencies: ['disposable-core-workflows'], use: commonUse },
    { name: 'disposable-business-lifecycle', testMatch: ['business-lifecycle.spec.js'], dependencies: ['disposable-auth-setup'], use: commonUse },
    { name: 'desktop-1440', testMatch: ['business-readonly.spec.js', 'role-matrix-stable.spec.js', 'admin-no-conversation-poll.spec.js'], dependencies: ['disposable-business-lifecycle'], use: commonUse },
    { name: 'disposable-auth-session', testMatch: ['auth-session.spec.js'], dependencies: ['desktop-1440'], use: commonUse },
  ],
})
