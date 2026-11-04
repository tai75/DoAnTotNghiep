import { defineConfig } from '@playwright/test'

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['line'], ['json', { outputFile: 'test-results/mobile-e2e-results.json' }]],
  outputDir: 'test-results/mobile-e2e',
  use: {
    // Keep the browser origin aligned with CORS_ORIGIN and the refresh-cookie
    // host used by global setup. `localhost` and `127.0.0.1` are not
    // interchangeable for either CORS or cookies.
    baseURL: process.env.QA_BASE_URL || 'http://localhost:5173',
    headless: true,
    launchOptions: { executablePath: chromePath },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-375', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-430', use: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
})
