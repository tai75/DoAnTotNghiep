const assert = require('node:assert/strict')
const { playwrightEnvironment } = require('./disposable-playwright-launcher.cjs')

const child = playwrightEnvironment({
  PATH: 'kept',
  E2E_RUN_ID: 'run-kept',
  E2E_PASSWORD: 'synthetic-kept',
  DATABASE_URL: 'development-secret',
  E2E_DATABASE_URL: 'runner-secret',
  E2E_DATABASE_USER: 'runner-user',
  E2E_MIGRATION_DATABASE_URL: 'migrator-secret',
  E2E_PROVISIONING_DATABASE_URL: 'provisioner-secret',
  MYSQL_PWD: 'ambient-secret',
  E2E_JWT_SECRET: 'jwt-secret',
  JWT_SECRET: 'jwt-secret-2',
  AUTH_RATE_LIMIT_MAX: '200',
  API_RATE_LIMIT_MAX: '1000',
})

assert.deepEqual(child, {
  PATH: 'kept',
  E2E_RUN_ID: 'run-kept',
  E2E_PASSWORD: 'synthetic-kept',
})

console.log('PASS: Playwright process does not receive database credentials')
