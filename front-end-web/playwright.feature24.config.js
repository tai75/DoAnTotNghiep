import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['feature24-live.spec.js'],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.FEATURE24_WEB_URL || 'http://127.0.0.1:5179',
    launchOptions: { executablePath: process.env.FEATURE24_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['line'], ['json', { outputFile: 'test-results/feature24-results.json' }]],
  outputDir: 'test-results/feature24',
})
