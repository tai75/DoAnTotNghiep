import { describe, expect, it } from 'vitest'
import processGuard from '../../scripts/e2e-process-guard.cjs'

const {
  acquireRefreshLock,
  assertMarkerUnchanged,
  assertNoReparsePointsSync,
  atomicReplaceMarker,
  buildRecoveryMarker,
  parseMarkerRaw,
  readServerPid,
  validateInstanceRoot,
  validateMarkerV2Schema,
  validateOwnershipSnapshot,
  validateRefreshIdentities,
  validateRefreshSnapshot,
} = processGuard
const now = Date.parse('2026-11-12T04:10:00.000Z')
const config = 'C:\\temp\\job-connect-e2e\\my.ini'
const data = 'C:\\temp\\job-connect-e2e\\data'
const executable = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe'

function valid() {
  return {
    marker: { version: 2, resource: 'job-connect-e2e-mysql-qa03b2a', state: 'ready', host: '127.0.0.1', port: 3307, database: 'job_connect_e2e_disposable', launcherPid: 100, serverPid: 101, executablePath: executable, configPath: config, datadir: data, createdAt: '2026-11-12T04:00:00.000Z', launcherCreatedAt: '2026-11-12T04:09:38.617Z', serverCreatedAt: '2026-11-12T04:09:38.742Z', verifiedAt: '2026-11-12T04:09:50.000Z' },
    launcher: { processId: 100, parentProcessId: 50, executablePath: executable, commandLine: `mysqld --defaults-file=${config}`, creationDate: '2026-11-12T04:09:38.617Z' },
    server: { processId: 101, parentProcessId: 100, executablePath: executable, commandLine: `mysqld --defaults-file=${config}`, creationDate: '2026-11-12T04:09:38.742Z' },
    listeners: [{ address: '127.0.0.1', port: 3307, owningProcess: 101 }],
    mysql80Pid: 5284,
    runtimeDatadir: data,
  }
}

describe('Windows MySQL process ownership guard', () => {
  it('accepts a valid launcher/server ownership chain', () => expect(validateOwnershipSnapshot(valid(), { now })).toMatchObject({ launcherPid: 100, serverPid: 101 }))
  it('rejects parent PID mismatch', () => { const x = valid(); x.server.parentProcessId = 999; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/ParentProcessId/) })
  it('rejects listener owner mismatch', () => { const x = valid(); x.listeners[0].owningProcess = 999; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/listener owner/) })
  it('rejects wrong defaults-file', () => { const x = valid(); x.server.commandLine = 'mysqld --defaults-file=C:\\ProgramData\\MySQL\\my.ini'; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/defaults-file/) })
  it('rejects wrong runtime datadir', () => { const x = valid(); x.runtimeDatadir = 'C:\\ProgramData\\MySQL\\Data'; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/datadir/) })
  it('rejects PID reuse by creation date', () => { const x = valid(); x.server.creationDate = '2026-11-12T04:09:39.000Z'; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/PID reuse/) })
  it('rejects stale marker', () => { const x = valid(); x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/stale/) })
  it('rejects MySQL80 process/config', () => { const x = valid(); x.launcher.executablePath = executable; x.launcher.commandLine = 'mysqld --defaults-file=C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini'; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/defaults-file/) })
  it('rejects missing launcher process', () => { const x = valid(); x.launcher = null; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/Launcher process/) })
  it('rejects missing server process', () => { const x = valid(); x.server = null; expect(() => validateOwnershipSnapshot(x, { now })).toThrow(/Server process/) })
  it('rejects a missing PID file', () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    expect(() => readServerPid('C:\\synthetic', { readFileSync: () => { throw error } })).toThrow(/PID file/)
  })
  it('rejects an instance root outside the exact allowlist', () => {
    expect(() => validateInstanceRoot('C:\\ProgramData\\MySQL\\MySQL Server 8.0')).toThrow(/exact allowlist/)
  })
})

describe('controlled ownership marker refresh security', () => {
  it('accepts an expired marker only with valid live process and database identities', () => {
    const x = valid()
    x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'
    expect(validateRefreshSnapshot(x)).toMatchObject({ launcherPid: 100, serverPid: 101 })
    expect(validateRefreshIdentities(x.marker,
      { databaseName: 'job_connect_e2e_disposable', currentUser: 'job_connect_e2e_runner@127.0.0.1', serverPort: 3307, runtimeDatadir: data },
      { databaseName: 'job_connect_e2e_disposable', currentUser: 'job_connect_e2e_migrator@127.0.0.1', serverPort: 3307, runtimeDatadir: data },
    )).toBe(true)
  })

  it('rejects expired marker with PID reuse', () => { const x = valid(); x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'; x.server.creationDate = '2026-11-12T04:09:39.000Z'; expect(() => validateRefreshSnapshot(x)).toThrow(/PID reuse/) })
  it('rejects expired marker with wrong listener owner', () => { const x = valid(); x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'; x.listeners[0].owningProcess = 999; expect(() => validateRefreshSnapshot(x)).toThrow(/listener owner/) })
  it('rejects expired marker with wrong datadir', () => { const x = valid(); x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'; x.runtimeDatadir = 'C:\\ProgramData\\MySQL\\Data'; expect(() => validateRefreshSnapshot(x)).toThrow(/datadir/) })
  it('rejects expired marker with wrong defaults-file', () => { const x = valid(); x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'; x.server.commandLine = 'mysqld --defaults-file=C:\\ProgramData\\MySQL\\my.ini'; expect(() => validateRefreshSnapshot(x)).toThrow(/defaults-file/) })
  it('rejects expired marker with wrong parent PID', () => { const x = valid(); x.marker.verifiedAt = '2026-11-12T02:00:00.000Z'; x.server.parentProcessId = 999; expect(() => validateRefreshSnapshot(x)).toThrow(/ParentProcessId/) })
  it('rejects MySQL80 PID overlap', () => { const x = valid(); x.mysql80Pid = 100; expect(() => validateRefreshSnapshot(x)).toThrow(/MySQL80/) })

  it('rejects a concurrent refresh lock', () => {
    const error = Object.assign(new Error('exists'), { code: 'EEXIST' })
    expect(() => acquireRefreshLock('C:\\synthetic', { openSync: () => { throw error } })).toThrow(/đang chạy/)
  })

  it('rejects a marker modified during live revalidation', () => {
    expect(() => assertMarkerUnchanged('{"verifiedAt":"old"}', '{"verifiedAt":"new"}')).toThrow(/đã thay đổi/)
  })

  it('cleans the temporary file when atomic replacement fails', () => {
    let cleaned = false
    expect(() => atomicReplaceMarker('C:\\synthetic\\marker.json', valid().marker, {
      openSync: () => 7,
      writeFileSync: () => {},
      fsyncSync: () => {},
      closeSync: () => {},
      renameSync: () => { throw new Error('replace failed') },
      existsSync: () => true,
      unlinkSync: () => { cleaned = true },
    })).toThrow(/replace failed/)
    expect(cleaned).toBe(true)
  })

  it('rejects missing or invalid marker JSON', () => {
    expect(() => parseMarkerRaw('{invalid')).toThrow(/JSON/)
    expect(() => validateMarkerV2Schema(null)).toThrow(/marker v2/)
  })

  it('rejects symlink, junction or reparse path', () => {
    expect(() => assertNoReparsePointsSync('C:\\synthetic\\root', { lstatSync: () => ({ isSymbolicLink: () => true }) })).toThrow(/symlink|junction|reparse/)
  })

  it('rejects marker fields that could leak credentials', () => {
    const marker = { ...valid().marker, password: 'must-not-leak' }
    expect(() => validateMarkerV2Schema(marker)).toThrow(/field ngoài/)
    expect(JSON.stringify(valid().marker)).not.toContain('must-not-leak')
  })
})

describe('controlled ownership marker recovery security', () => {
  function recovered() {
    const x = valid()
    x.marker.configPath = 'C:\\temp\\job-connect-e2e\\my-disposable.ini'
    x.marker.datadir = 'C:\\temp\\job-connect-e2e\\data'
    x.launcher.processId = 300
    x.server.processId = 301
    x.server.parentProcessId = 300
    x.launcher.creationDate = '2026-11-12T05:00:00.000Z'
    x.server.creationDate = '2026-11-12T05:00:00.100Z'
    x.listeners[0].owningProcess = 301
    x.oldProcesses = []
    return x
  }

  it('builds a new marker only from a distinct live ownership chain', () => {
    const x = recovered()
    const marker = buildRecoveryMarker(x.marker, x, 'C:\\temp\\job-connect-e2e', { now: Date.parse('2026-11-12T05:00:10.000Z') })
    expect(marker).toMatchObject({ launcherPid: 300, serverPid: 301, verifiedAt: '2026-11-12T05:00:10.000Z' })
    expect(marker.createdAt).toBe(x.launcher.creationDate)
  })

  it('rejects reuse of an old launcher or server PID', () => {
    const x = recovered()
    x.launcher.processId = x.marker.launcherPid
    expect(() => buildRecoveryMarker(x.marker, x, 'C:\\temp\\job-connect-e2e')).toThrow(/PID/)
  })

  it('rejects any process still occupying an old PID', () => {
    const x = recovered()
    x.oldProcesses = [{ processId: x.marker.serverPid }]
    expect(() => buildRecoveryMarker(x.marker, x, 'C:\\temp\\job-connect-e2e')).toThrow(/PID cÅ©/)
  })

  it('rejects a marker outside the exact recovery config/datadir paths', () => {
    const x = recovered()
    x.marker.datadir = 'C:\\ProgramData\\MySQL\\Data'
    expect(() => buildRecoveryMarker(x.marker, x, 'C:\\temp\\job-connect-e2e')).toThrow(/config\/datadir/)
  })

  it('does not add credentials to a recovered marker', () => {
    const x = recovered()
    const marker = buildRecoveryMarker(x.marker, x, 'C:\\temp\\job-connect-e2e')
    expect(Object.keys(marker).sort()).toEqual(Object.keys(x.marker).sort())
    expect(JSON.stringify(marker)).not.toMatch(/password|credential/i)
  })
})
