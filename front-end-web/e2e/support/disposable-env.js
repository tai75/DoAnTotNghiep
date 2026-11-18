import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXPECTED_DATABASE = 'job_connect_e2e_disposable'
const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = '3307'
const ROOT_NAME = 'job-connect-e2e-disposable'

function artifactRunRoot(root, runName) {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(runName || '')) throw new Error('Invalid E2E_ARTIFACT_RUN_NAME')
  const base = path.resolve(root, 'artifacts')
  const execution = path.resolve(base, 'executions', runName)
  const relative = path.relative(base, execution)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact execution root is outside the allowlist')
  return { base, execution }
}

function required(environment, names) {
  const missing = names.filter((name) => typeof environment[name] !== 'string' || !environment[name].trim())
  if (missing.length) throw new Error(`Thiếu biến môi trường Playwright disposable: ${missing.join(', ')}`)
}

function safeLoopbackUrl(value, name) {
  let parsed
  try { parsed = new URL(value) } catch { throw new Error(`${name} không phải URL hợp lệ`) }
  if (parsed.protocol !== 'http:' || parsed.hostname !== EXPECTED_HOST) throw new Error(`${name} phải là HTTP loopback 127.0.0.1`)
  return parsed.origin
}

function parseJsonFile(file, readFileSync) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error(`Không thể đọc attestation disposable: ${file}`) }
}

function validateRecord(record, runId, name) {
  if (!record || record.version !== 1 || record.runId !== runId || record.database !== EXPECTED_DATABASE) {
    throw new Error(`${name} không khớp run ID hoặc disposable database`)
  }
}

export function loadDisposableEnvironment(environment = process.env, options = {}) {
  required(environment, [
    'E2E_RUN_ID', 'E2E_DATABASE_NAME', 'E2E_DATABASE_HOST', 'E2E_DATABASE_PORT',
    'E2E_PASSWORD', 'E2E_API_BASE_URL', 'E2E_FRONTEND_BASE_URL', 'E2E_ARTIFACT_RUN_NAME',
  ])
  const runId = environment.E2E_RUN_ID.trim()
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(runId)) throw new Error('E2E_RUN_ID không hợp lệ')
  if (environment.E2E_DATABASE_NAME !== EXPECTED_DATABASE) throw new Error('Playwright từ chối database ngoài disposable allowlist')
  if (environment.E2E_DATABASE_HOST !== EXPECTED_HOST || environment.E2E_DATABASE_PORT !== EXPECTED_PORT) throw new Error('Playwright từ chối host/port ngoài disposable allowlist')
  if (environment.E2E_PASSWORD.length < 12) throw new Error('E2E_PASSWORD phải có ít nhất 12 ký tự')

  const tempRoot = path.resolve(options.tempRoot || os.tmpdir())
  const root = path.resolve(tempRoot, ROOT_NAME, runId)
  const lockPath = path.resolve(tempRoot, ROOT_NAME, '.job-connect-e2e.lock')
  const markerPath = path.join(root, '.job-connect-e2e-marker.json')
  const attestationPath = path.join(root, '.job-connect-e2e-canonical.json')
  const readFileSync = options.readFileSync || fs.readFileSync
  const lock = parseJsonFile(lockPath, readFileSync)
  const marker = parseJsonFile(markerPath, readFileSync)
  const attestation = parseJsonFile(attestationPath, readFileSync)
  validateRecord(lock, runId, 'Run lock')
  validateRecord(marker, runId, 'Storage marker')
  validateRecord(attestation, runId, 'Canonical attestation')
  if (attestation.migrationCount !== 22) throw new Error('Canonical attestation không xác nhận đủ 22 migration')
  const verifiedAt = Date.parse(attestation.verifiedAt)
  const now = Number(options.now || Date.now())
  if (!Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > 60 * 60 * 1000) throw new Error('Canonical attestation đã hết hạn')

  const artifact = artifactRunRoot(root, environment.E2E_ARTIFACT_RUN_NAME)
  return Object.freeze({
    runId,
    database: EXPECTED_DATABASE,
    apiBaseURL: safeLoopbackUrl(environment.E2E_API_BASE_URL, 'E2E_API_BASE_URL'),
    frontendBaseURL: safeLoopbackUrl(environment.E2E_FRONTEND_BASE_URL, 'E2E_FRONTEND_BASE_URL'),
    password: environment.E2E_PASSWORD,
    root,
    authRoot: path.join(root, 'auth'),
    artifactRunName: environment.E2E_ARTIFACT_RUN_NAME,
    artifactsBaseRoot: artifact.base,
    artifactsRoot: artifact.execution,
  })
}

let cached
export function disposableEnvironment() {
  cached ||= loadDisposableEnvironment()
  return cached
}

export function authStatePath(role) {
  if (!['candidate', 'recruiter', 'admin'].includes(role)) throw new Error('Vai trò auth state không hợp lệ')
  return path.join(disposableEnvironment().authRoot, `${role}.json`)
}

export const disposableAccounts = Object.freeze({
  candidate: 'candidate@jobconnect.local',
  recruiter: 'recruiter@jobconnect.local',
  admin: 'admin@jobconnect.local',
})
