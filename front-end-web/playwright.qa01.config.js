import { defineConfig } from '@playwright/test'

const required = ['QA01_DATABASE_URL', 'QA01_PASSWORD', 'QA01_JWT_SECRET']
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`QA-01 requires explicit isolated environment variables: ${missing.join(', ')}`)

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['qa01-authenticated.spec.js', 'auth-recovery.spec.js'],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['line'], ['json', { outputFile: 'test-results/qa01-results.json' }]],
  outputDir: 'test-results/qa01',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    launchOptions: { executablePath: chromePath },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'qa01-chromium', use: { viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'npm run qa01:db:reset-seed && npm run qa01:server',
      cwd: '../back-end',
      url: 'http://127.0.0.1:5101/api/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        QA01_DATABASE_URL: process.env.QA01_DATABASE_URL,
        QA01_PASSWORD: process.env.QA01_PASSWORD,
        DATABASE_URL: process.env.QA01_DATABASE_URL,
        JWT_SECRET: process.env.QA01_JWT_SECRET,
        JWT_EXPIRES_IN: '5m',
        REFRESH_TOKEN_EXPIRES_IN: '1h',
        REFRESH_COOKIE_NAME: 'job_connect_qa01_refresh',
        PORT: '5101',
        FRONTEND_URL: 'http://127.0.0.1:5174',
        API_PUBLIC_URL: 'http://127.0.0.1:5101',
        CORS_ORIGINS: 'http://127.0.0.1:5174',
        ALERT_WORKER_ENABLED: 'false',
        MATCHING_V2_ENABLED: 'false',
        MATCHING_V3_ENABLED: 'false',
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        GEMINI_API_KEY: '',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:5101',
        VITE_MATCHING_V2_ENABLED: 'false',
      },
    },
  ],
})
