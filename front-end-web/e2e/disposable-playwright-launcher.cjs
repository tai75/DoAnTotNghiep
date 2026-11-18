const path = require('node:path')
const { spawn } = require('node:child_process')

const BROWSER_DENIED_ENV = Object.freeze([
  'DATABASE_URL',
  'E2E_DATABASE_URL',
  'E2E_DATABASE_USER',
  'E2E_MIGRATION_DATABASE_URL',
  'E2E_MIGRATION_DATABASE_USER',
  'E2E_MIGRATION_APPROVED',
  'E2E_PROVISIONING_DATABASE_URL',
  'E2E_PROVISIONING_DATABASE_USER',
  'MYSQL_PWD',
  'E2E_JWT_SECRET',
  'JWT_SECRET',
  'AUTH_RATE_LIMIT_MAX',
  'API_RATE_LIMIT_MAX',
])

function playwrightEnvironment(environment) {
  const sanitized = { ...environment }
  for (const name of BROWSER_DENIED_ENV) delete sanitized[name]
  return sanitized
}

function launch(environment = process.env) {
  const cli = path.resolve(__dirname, '../node_modules/@playwright/test/cli.js')
  const config = path.resolve(__dirname, '../playwright.disposable.config.js')
  const child = spawn(process.execPath, [cli, 'test', `--config=${config}`], {
    cwd: path.resolve(__dirname, '..'),
    env: playwrightEnvironment(environment),
    shell: false,
    stdio: 'inherit',
  })
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  return child
}

if (require.main === module) launch()

module.exports = { BROWSER_DENIED_ENV, playwrightEnvironment, launch }
