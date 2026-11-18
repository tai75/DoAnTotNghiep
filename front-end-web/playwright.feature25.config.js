import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['feature25-live.spec.js'],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: process.env.FEATURE25_WEB_URL || 'http://127.0.0.1:5179',
    launchOptions: { executablePath: process.env.FEATURE25_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['line'], ['json', { outputFile: 'test-results/feature25-results.json' }]],
  outputDir: 'test-results/feature25',
})
