import { describe, expect, it } from 'vitest'
import guard from '../../scripts/e2e-guard.cjs'

const { EXPECTED, validateE2eEnvironment, assertRuntimeIdentity, assertCanonicalMigrationHistory } = guard

function validEnvironment(overrides = {}) {
  return {
    E2E_DATABASE_URL: `mysql://${EXPECTED.runnerUser}:synthetic-only@${EXPECTED.host}:${EXPECTED.port}/${EXPECTED.database}`,
    E2E_DATABASE_NAME: EXPECTED.database,
    E2E_DATABASE_USER: EXPECTED.runnerUser,
    E2E_DATABASE_HOST: EXPECTED.host,
    E2E_DATABASE_PORT: String(EXPECTED.port),
    E2E_DESTRUCTIVE_CONFIRM: EXPECTED.database,
    ...overrides,
  }
}

function migrations() {
  return Array.from({ length: 22 }, (_, index) => ({ name: `migration-${index + 1}`, checksum: `checksum-${index + 1}` }))
}

function historyFor(local = migrations()) {
  return local.map((item) => ({ migrationName: item.name, checksum: item.checksum, finishedAt: new Date(), rolledBackAt: null }))
}

describe('disposable E2E database environment guard', () => {
  it('fails closed when required E2E variables are missing', () => {
    expect(() => validateE2eEnvironment({})).toThrow(/Thiếu biến môi trường E2E/)
  })

  it.each([
    ['wrong database name', { E2E_DATABASE_NAME: 'job_connect_other' }],
    ['wrong username', { E2E_DATABASE_USER: 'job_connect_other' }],
    ['wrong host', { E2E_DATABASE_HOST: 'localhost' }],
    ['wrong port', { E2E_DATABASE_PORT: '3306' }],
    ['invalid confirmation', { E2E_DESTRUCTIVE_CONFIRM: 'yes' }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateE2eEnvironment(validEnvironment(override))).toThrow()
  })

  it.each(['root', 'admin', 'administrator', 'dba', 'superuser'])('rejects privileged user %s', (user) => {
    const url = `mysql://${user}:synthetic-only@${EXPECTED.host}:${EXPECTED.port}/${EXPECTED.database}`
    expect(() => validateE2eEnvironment(validEnvironment({ E2E_DATABASE_URL: url, E2E_DATABASE_USER: user }))).toThrow(/đặc quyền/)
  })

  it.each(['job_connect', 'job_connect_dev', 'job_connect_qa01_e2e'])('rejects protected database %s', (database) => {
    const url = `mysql://${EXPECTED.runnerUser}:synthetic-only@${EXPECTED.host}:${EXPECTED.port}/${database}`
    expect(() => validateE2eEnvironment(validEnvironment({ E2E_DATABASE_URL: url, E2E_DATABASE_NAME: database, E2E_DESTRUCTIVE_CONFIRM: database }))).toThrow(/Từ chối database/)
  })

  it('never falls back to DATABASE_URL', () => {
    expect(() => validateE2eEnvironment({ DATABASE_URL: validEnvironment().E2E_DATABASE_URL })).toThrow(/E2E_DATABASE_URL/)
  })

  it('accepts only an exact URL and target tuple', () => {
    expect(validateE2eEnvironment(validEnvironment())).toMatchObject({
      database: EXPECTED.database,
      user: EXPECTED.runnerUser,
      host: EXPECTED.host,
      port: EXPECTED.port,
    })
  })
})

describe('disposable E2E runtime identity guard', () => {
  const target = validateE2eEnvironment(validEnvironment())

  it('accepts exact DATABASE(), CURRENT_USER() and @@port', () => {
    expect(assertRuntimeIdentity(target, { databaseName: EXPECTED.database, currentUser: `${EXPECTED.runnerUser}@localhost`, serverPort: EXPECTED.port })).toBeTruthy()
  })

  it.each([
    { databaseName: 'job_connect', currentUser: `${EXPECTED.runnerUser}@localhost`, serverPort: EXPECTED.port },
    { databaseName: EXPECTED.database, currentUser: 'root@localhost', serverPort: EXPECTED.port },
    { databaseName: EXPECTED.database, currentUser: `${EXPECTED.runnerUser}@localhost`, serverPort: 3306 },
  ])('rejects runtime identity mismatch', (identity) => {
    expect(() => assertRuntimeIdentity(target, identity)).toThrow(/Runtime/)
  })
})

describe('disposable E2E canonical migration guard', () => {
  it('accepts exactly 22 successful migrations with matching checksums', () => {
    const local = migrations()
    expect(assertCanonicalMigrationHistory(local, historyFor(local))).toBe(true)
  })

  it('rejects a missing migration', () => {
    const local = migrations()
    expect(() => assertCanonicalMigrationHistory(local, historyFor(local).slice(0, -1))).toThrow(/22\/22/)
  })

  it('rejects a wrong checksum', () => {
    const local = migrations()
    const history = historyFor(local)
    history[5].checksum = 'wrong'
    expect(() => assertCanonicalMigrationHistory(local, history)).toThrow(/Checksum/)
  })

  it('rejects incomplete and rolled-back migrations', () => {
    const local = migrations()
    const incomplete = historyFor(local)
    incomplete[0].finishedAt = null
    expect(() => assertCanonicalMigrationHistory(local, incomplete)).toThrow(/chưa hoàn tất/)
    const rolledBack = historyFor(local)
    rolledBack[0].rolledBackAt = new Date()
    expect(() => assertCanonicalMigrationHistory(local, rolledBack)).toThrow(/rollback/)
  })
})
