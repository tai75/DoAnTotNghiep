import { afterEach, describe, expect, it } from 'vitest'
import qaDatabase from '../../scripts/qa01-db.cjs'

const originalUrl = process.env.QA01_DATABASE_URL
const { assertMigrationHistory, qaUrl } = qaDatabase

afterEach(() => {
  if (originalUrl === undefined) delete process.env.QA01_DATABASE_URL
  else process.env.QA01_DATABASE_URL = originalUrl
})

describe('QA-01 database identity guard', () => {
  it('accepts only the dedicated user on the loopback QA database', () => {
    process.env.QA01_DATABASE_URL = 'mysql://job_connect_qa01:test-only@127.0.0.1:3306/job_connect_qa01_e2e'
    const parsed = qaUrl()
    expect(parsed.hostname).toBe('127.0.0.1')
    expect(parsed.pathname).toBe('/job_connect_qa01_e2e')
  })

  it.each([
    'mysql://root:test-only@127.0.0.1:3306/job_connect_qa01_e2e',
    'mysql://job_connect_qa01:test-only@127.0.0.1:3306/job_connect',
    'mysql://job_connect_qa01:test-only@example.test:3306/job_connect_qa01_e2e',
  ])('rejects unsafe target %s', (url) => {
    process.env.QA01_DATABASE_URL = url
    expect(() => qaUrl()).toThrow('QA-01 safety stop')
  })

  it('accepts only an exact successful migration history with matching checksums', () => {
    const migrations = [{ name: '001', checksum: 'aaa' }, { name: '002', checksum: 'bbb' }]
    const valid = migrations.map((migration) => ({ migrationName: migration.name, checksum: migration.checksum, finishedAt: new Date(), rolledBackAt: null }))
    expect(() => assertMigrationHistory(migrations, valid)).not.toThrow()
    expect(() => assertMigrationHistory(migrations, valid.slice(0, 1))).toThrow('not canonical')
    expect(() => assertMigrationHistory(migrations, [...valid, { migrationName: '003', checksum: 'ccc', finishedAt: new Date(), rolledBackAt: null }])).toThrow('unexpected=003')
    expect(() => assertMigrationHistory(migrations, [{ ...valid[0], rolledBackAt: new Date() }, valid[1]])).toThrow('invalid=001')
    expect(() => assertMigrationHistory(migrations, [{ ...valid[0], checksum: 'changed' }, valid[1]])).toThrow('invalid=001')
  })
})
