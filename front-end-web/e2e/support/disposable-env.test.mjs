import assert from 'node:assert/strict'
import { loadDisposableEnvironment } from './disposable-env.js'

const runId = 'run-20261112-static'
const now = Date.parse('2026-11-12T03:00:00.000Z')
const environment = {
  E2E_RUN_ID: runId,
  E2E_DATABASE_NAME: 'job_connect_e2e_disposable',
  E2E_DATABASE_HOST: '127.0.0.1',
  E2E_DATABASE_PORT: '3307',
  E2E_PASSWORD: 'synthetic-password',
  E2E_API_BASE_URL: 'http://127.0.0.1:5102',
  E2E_FRONTEND_BASE_URL: 'http://127.0.0.1:5178',
  E2E_ARTIFACT_RUN_NAME: 'rerun03-security-test',
}
const record = { version: 1, runId, database: 'job_connect_e2e_disposable' }
const readFileSync = (file) => JSON.stringify(file.endsWith('.job-connect-e2e-canonical.json')
  ? { ...record, migrationCount: 22, verifiedAt: new Date(now).toISOString() }
  : record)

const loaded = loadDisposableEnvironment(environment, {
  tempRoot: 'C:/synthetic-temp',
  readFileSync,
  now,
})
assert.equal(loaded.database, 'job_connect_e2e_disposable')
assert.equal(loaded.apiBaseURL, 'http://127.0.0.1:5102')
assert.match(loaded.artifactsRoot.replaceAll('\\', '/'), /artifacts\/executions\/rerun03-security-test$/)

assert.throws(() => loadDisposableEnvironment({
  ...environment,
  E2E_DATABASE_NAME: 'job_connect_qa01_e2e',
}, { tempRoot: 'C:/synthetic-temp', readFileSync, now }))

assert.throws(() => loadDisposableEnvironment(environment, {
  tempRoot: 'C:/synthetic-temp',
  readFileSync,
  now: now + (61 * 60 * 1000),
}))

console.log('PASS: disposable Playwright environment fails closed')
