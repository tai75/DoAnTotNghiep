const bcrypt = require('bcryptjs')
const { createGuardedClient, EXPECTED } = require('./e2e-guard.cjs')
const { assertLiveOwnership } = require('./e2e-process-guard.cjs')
const { validateExistingStorage } = require('./e2e-storage.cjs')
const { runGuardedPrismaChecks } = require('./e2e-prisma-guard.cjs')

const IDS = Object.freeze([176, 177, 178])
const EXPECTED_USERS = Object.freeze([
  { id: 176, email: 'candidate@jobconnect.local', role: 'CANDIDATE', profile: 'candidate' },
  { id: 177, email: 'recruiter@jobconnect.local', role: 'RECRUITER', profile: 'recruiter' },
  { id: 178, email: 'admin@jobconnect.local', role: 'ADMIN', profile: 'admin' },
])

function validateUsers(rows) {
  if (!Array.isArray(rows) || rows.length !== 3) throw new Error('Synthetic identity count mismatch')
  for (const expected of EXPECTED_USERS) {
    const row = rows.find((item) => Number(item.id) === expected.id)
    if (!row || row.email !== expected.email || row.role !== expected.role || row.status !== 'ACTIVE') {
      throw new Error(`Synthetic identity mismatch for user ${expected.id}`)
    }
    if (expected.profile === 'candidate' && (Number(row.candidateProfiles) !== 1 || Number(row.recruiterProfiles) !== 0)) {
      throw new Error('Candidate fixture provenance mismatch')
    }
    if (expected.profile === 'recruiter' && (Number(row.candidateProfiles) !== 0 || Number(row.recruiterProfiles) !== 1)) {
      throw new Error('Recruiter fixture provenance mismatch')
    }
    if (expected.profile === 'admin' && (Number(row.candidateProfiles) !== 0 || Number(row.recruiterProfiles) !== 0)) {
      throw new Error('Admin fixture provenance mismatch')
    }
    if (typeof row.passwordHash !== 'string' || !/^\$2[aby]\$\d{2}\$/.test(row.passwordHash)) {
      throw new Error(`Synthetic password hash is invalid for user ${expected.id}`)
    }
  }
  return true
}

function validateRunnerGrants(rows) {
  const grants = rows.flatMap((row) => Object.values(row)).map(String)
  const combined = grants.join('\n').toUpperCase()
  if (!combined.includes('JOB_CONNECT_E2E_DISPOSABLE') || !combined.includes('SELECT')
    || !combined.includes('INSERT') || !combined.includes('UPDATE') || !combined.includes('DELETE')) {
    throw new Error('Runner is missing scoped DML privileges')
  }
  if (/\b(ALL PRIVILEGES|CREATE|DROP|ALTER|INDEX|REFERENCES|TRIGGER|EVENT|EXECUTE|GRANT OPTION|SHUTDOWN|RELOAD|SUPER)\b/.test(combined)) {
    throw new Error('Runner has a forbidden privilege')
  }
  const databaseGrants = grants.filter((grant) => / ON [`']?job_connect_e2e_disposable[`']?\.\*/i.test(grant))
  if (!databaseGrants.length || grants.some((grant) => / ON \*\.\*/i.test(grant) && !/^GRANT USAGE /i.test(grant))) {
    throw new Error('Runner grant scope mismatch')
  }
  return true
}

function safeUsers(rows) {
  return rows.map(({ id, email, role, status, tokenVersion, candidateProfiles, recruiterProfiles }) => ({
    id: Number(id), email, role, status, tokenVersion: Number(tokenVersion),
    candidateProfiles: Number(candidateProfiles), recruiterProfiles: Number(recruiterProfiles),
  }))
}

async function queryUsers(client, lock = false) {
  return client.$queryRawUnsafe(`
    SELECT u.id, u.email, u.role, u.status, u.password_hash passwordHash,
           u.token_version tokenVersion, u.created_at createdAt, u.updated_at updatedAt,
           (SELECT COUNT(*) FROM candidates c WHERE c.user_id = u.id) candidateProfiles,
           (SELECT COUNT(*) FROM recruiters r WHERE r.user_id = u.id) recruiterProfiles
    FROM users u WHERE u.id IN (176, 177, 178) ORDER BY u.id${lock ? ' FOR UPDATE' : ''}
  `)
}

async function querySessions(client, lock = false) {
  const rows = await client.$queryRawUnsafe(`
    SELECT id, user_id userId, expires_at expiresAt, revoked_at revokedAt
    FROM refresh_tokens WHERE user_id IN (176, 177, 178)
    ORDER BY user_id, id${lock ? ' FOR UPDATE' : ''}
  `)
  const now = Date.now()
  return IDS.map((userId) => {
    const sessions = rows.filter((row) => Number(row.userId) === userId)
    const active = sessions.filter((row) => !row.revokedAt && new Date(row.expiresAt).getTime() > now)
    const expired = sessions.filter((row) => !row.revokedAt && new Date(row.expiresAt).getTime() <= now)
    const revoked = sessions.filter((row) => Boolean(row.revokedAt))
    const expiries = active.map((row) => new Date(row.expiresAt).getTime())
    return {
      userId, total: sessions.length, active: active.length, expired: expired.length, revoked: revoked.length,
      latestActiveExpiry: expiries.length ? new Date(Math.max(...expiries)).toISOString() : null,
    }
  })
}

async function preflight(environment = process.env, options = {}) {
  await (options.assertLiveOwnershipImpl || assertLiveOwnership)(environment, options)
  await (options.validateExistingStorageImpl || validateExistingStorage)(environment, { repositoryRoot: require('node:path').resolve(__dirname, '../..') })
  if (!options.skipPrismaChecks) await (options.runGuardedPrismaChecksImpl || runGuardedPrismaChecks)(environment, options.prismaOptions)
  const guarded = await (options.createGuardedClientImpl || createGuardedClient)(environment, { mode: 'canonical' })
  try {
    const grants = await guarded.client.$queryRawUnsafe('SHOW GRANTS')
    validateRunnerGrants(grants)
    const users = await queryUsers(guarded.client)
    validateUsers(users)
    const sessions = await querySessions(guarded.client)
    return {
      target: { host: EXPECTED.host, port: EXPECTED.port, database: EXPECTED.database, runner: EXPECTED.runnerUser },
      users: safeUsers(users), sessions,
      activeSessions: sessions.reduce((sum, row) => sum + row.active, 0),
      dmlOnly: true, canonicalMigrations: EXPECTED.migrationCount,
    }
  } finally {
    await guarded.client.$disconnect()
  }
}

function assertOnlyPasswordChanged(before, after, newHash) {
  validateUsers(after)
  for (const left of before) {
    const right = after.find((row) => Number(row.id) === Number(left.id))
    for (const field of ['email', 'role', 'status', 'tokenVersion']) {
      if (String(left[field]) !== String(right[field])) throw new Error(`Unexpected ${field} change for user ${left.id}`)
    }
    for (const field of ['createdAt', 'updatedAt']) {
      if (new Date(left[field]).getTime() !== new Date(right[field]).getTime()) throw new Error(`Unexpected ${field} change for user ${left.id}`)
    }
    if (right.passwordHash !== newHash) throw new Error(`Password hash mismatch for user ${left.id}`)
  }
}

async function rotate(environment = process.env, options = {}) {
  const secret = environment.E2E_NEW_SYNTHETIC_PASSWORD
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Missing strong in-memory rotation credential')
  const checked = await preflight(environment, options)
  if (checked.activeSessions !== 0) {
    const error = new Error('Active refresh sessions require separately approved revocation DML')
    error.code = 'E2E_ACTIVE_REFRESH_SESSIONS'
    error.preflight = checked
    throw error
  }
  const guarded = await (options.createGuardedClientImpl || createGuardedClient)(environment, { mode: 'canonical' })
  try {
    const newHash = await bcrypt.hash(secret, 12)
    if (bcrypt.getRounds(newHash) !== 12) throw new Error('bcrypt cost mismatch')
    const result = await guarded.client.$transaction(async (transaction) => {
      const before = await queryUsers(transaction, true)
      validateUsers(before)
      const sessions = await querySessions(transaction, true)
      if (JSON.stringify(sessions) !== JSON.stringify(checked.sessions)) throw new Error('Refresh-session state changed after preflight')
      if (sessions.some((row) => row.active !== 0)) throw new Error('Active refresh session detected inside rotation transaction')
      const newAgainstOld = await Promise.all(before.map((row) => bcrypt.compare(secret, row.passwordHash)))
      if (newAgainstOld.some(Boolean)) throw new Error('Generated credential unexpectedly matches an existing hash')
      const affected = await transaction.$executeRawUnsafe(
        'UPDATE users SET password_hash = ? WHERE id IN (?, ?, ?)', newHash, ...IDS,
      )
      if (Number(affected) !== 3) throw new Error(`Rotation affected ${affected} rows instead of 3`)
      const after = await queryUsers(transaction)
      assertOnlyPasswordChanged(before, after, newHash)
      const scope = await transaction.$queryRawUnsafe('SELECT id FROM users WHERE password_hash = ? ORDER BY id', newHash)
      if (scope.length !== 3 || scope.some((row, index) => Number(row.id) !== IDS[index])) throw new Error('Password hash escaped the exact user allowlist')
      return { affected: Number(affected), after }
    }, { isolationLevel: 'Serializable', timeout: 30000 })
    const comparisons = await Promise.all(result.after.map((row) => bcrypt.compare(secret, row.passwordHash)))
    if (comparisons.some((value) => !value)) throw new Error('Post-commit bcrypt verification failed')
    return { ...checked, affected: result.affected, bcryptCost: 12, bcryptVerified: comparisons.length, oldHashesRejectedNewCredential: 3 }
  } finally {
    await guarded.client.$disconnect()
  }
}

async function main() {
  const command = process.argv[2]
  if (command === 'preflight') {
    const result = await preflight()
    const status = result.activeSessions ? 'BLOCKED_ACTIVE_SESSIONS' : 'PASS'
    console.log(JSON.stringify({ status, ...result }))
    if (result.activeSessions) process.exitCode = 3
    return
  }
  if (command === 'rotate') {
    const result = await rotate()
    console.log(JSON.stringify({ status: 'PASS', ...result }))
    return
  }
  throw new Error('Usage: e2e-credential-rotation.cjs preflight|rotate')
}

if (require.main === module) main().catch((error) => {
  const safe = { status: 'FAIL', code: error.code || 'E2E_ROTATION_FAILED', message: error.message }
  if (error.preflight) safe.preflight = error.preflight
  console.error(JSON.stringify(safe))
  process.exitCode = 1
})

module.exports = { EXPECTED_USERS, assertOnlyPasswordChanged, preflight, querySessions, rotate, validateRunnerGrants, validateUsers }
