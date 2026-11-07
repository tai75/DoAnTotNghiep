import { defineConfig } from '@playwright/test'

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'notification-center.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5176',
    headless: true,
    launchOptions: { executablePath: chromePath },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5176',
    url: 'http://127.0.0.1:5176/login',
    reuseExistingServer: false,
    timeout: 120_000
  }
})
