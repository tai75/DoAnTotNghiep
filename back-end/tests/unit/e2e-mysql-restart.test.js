import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import processGuard from '../../scripts/e2e-process-guard.cjs'
import restart from '../../scripts/e2e-mysql-restart.cjs'

const root = processGuard.APPROVED_INSTANCE_ROOT
const executable = restart.APPROVED_EXECUTABLE
const configPath = path.win32.join(root, 'my-disposable.ini')
const datadir = path.win32.join(root, 'data')
const marker = {
  version: 2, resource: 'job-connect-e2e-mysql-qa03b2a', state: 'ready',
  host: '127.0.0.1', port: 3307, database: 'job_connect_e2e_disposable',
  launcherPid: 8240, serverPid: 24636, executablePath: executable,
  configPath, datadir, createdAt: '2026-11-13T02:35:08Z',
  launcherCreatedAt: '2026-11-13T02:35:08Z', serverCreatedAt: '2026-11-13T02:35:09Z',
  verifiedAt: '2026-11-13T04:42:02Z',
}
const configuration = `[mysqld]
basedir=C:/Program Files/MySQL/MySQL Server 8.0
datadir=${datadir}
port=3307
bind-address=127.0.0.1
mysqlx=0
skip_name_resolve=ON
local_infile=OFF
secure_file_priv=NULL
named_pipe=OFF
shared_memory=OFF
default_storage_engine=InnoDB
log_error=${path.win32.join(root, 'logs', 'mysqld-error.log')}
pid_file=${path.win32.join(root, 'runtime', 'mysqld.pid')}
`

function fixture(overrides = {}) {
  const writes = vi.fn()
  const spawn = vi.fn()
  const env = { E2E_MYSQL_INSTANCE_ROOT: root, E2E_RUN_ID: 'run-20261112-b2b1', ...overrides.env }
  const currentMarker = { ...marker, ...overrides.marker }
  const file = {
    lstatSync: vi.fn((item) => {
      if (overrides.reparse && item.toLowerCase() === overrides.reparse.toLowerCase()) return { isSymbolicLink: () => true }
      return { isSymbolicLink: () => false }
    }),
    statSync: vi.fn((item) => {
      if (overrides.missing && item.toLowerCase() === overrides.missing.toLowerCase()) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return { isFile: () => ![root, datadir, path.win32.join(datadir, 'mysql'), path.win32.join(datadir, 'job_connect_e2e_disposable'), path.win32.join(datadir, '#innodb_redo')].some((entry) => entry.toLowerCase() === item.toLowerCase()), isDirectory: () => [root, datadir, path.win32.join(datadir, 'mysql'), path.win32.join(datadir, 'job_connect_e2e_disposable'), path.win32.join(datadir, '#innodb_redo')].some((entry) => entry.toLowerCase() === item.toLowerCase()) }
    }),
    readFileSync: vi.fn((item) => {
      if (item.endsWith(processGuard.MARKER_NAME)) return JSON.stringify(currentMarker)
      if (item.toLowerCase() === configPath.toLowerCase()) return overrides.config ?? configuration
      if (item.endsWith(processGuard.PID_FILE)) {
        if (overrides.pid === null || overrides.pid === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return String(overrides.pid)
      }
      throw new Error('unexpected read')
    }),
    realpathSync: { native: vi.fn((item) => item) },
    writeFileSync: writes,
  }
  const validateStorage = vi.fn(async () => {
    if (overrides.storageError) throw new Error('storage invalid')
  })
  const snapshot = vi.fn(() => overrides.snapshot || { processes: [], listeners: [] })
  return { env, options: { fs: file, validateStorage, snapshot, spawn }, file, writes, spawn, snapshot, validateStorage }
}

async function check(f) {
  const result = await restart.preflight(f.env, f.options)
  expect(f.writes).not.toHaveBeenCalled()
  expect(f.spawn).not.toHaveBeenCalled()
  expect(result.startup).toBe('STARTUP_NOT_APPROVED')
  expect(result.processChain).toBe('PROCESS_CHAIN_UNVERIFIED')
  return result
}

describe('existing disposable MySQL restart preflight is read only', () => {
  it('accepts exact paths and an absent PID file without any write or spawn', async () => {
    const result = await check(fixture())
    expect(result.status).toBe('PASS')
    expect(Object.values(result.gates)).toEqual(Array(8).fill('PASS'))
  })
  it.each([undefined, 'C:\\ProgramData\\MySQL'])('rejects missing or unapproved root %s', async (value) => {
    const f = fixture({ env: { E2E_MYSQL_INSTANCE_ROOT: value } })
    expect((await check(f)).status).toBe('FAIL')
    expect(f.validateStorage).not.toHaveBeenCalled()
  })
  it('rejects missing storage environment', async () => expect((await check(fixture({ env: { E2E_RUN_ID: undefined } }))).code).toBe('E2E_ENV_MISSING'))
  it('rejects invalid storage marker/lock', async () => expect((await check(fixture({ storageError: true }))).gates.storage).toBe('FAIL'))
  it('rejects a symlink or junction path', async () => expect((await check(fixture({ reparse: root }))).gates.root).toBe('FAIL'))
  it.each([
    [{ code: 'EPERM', stderr: '' }, 'PROCESS_COMMAND_PERMISSION_DENIED'],
    ['executablePath', 'C:\\other\\mysqld.exe'],
    ['configPath', 'C:\\ProgramData\\MySQL\\my.ini'],
    ['datadir', 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Data'],
  ])('rejects wrong %s', async (key, value) => expect((await check(fixture({ marker: { [key]: value } }))).gates.paths).toBe('FAIL'))
  it('rejects a missing datadir', async () => expect((await check(fixture({ missing: datadir }))).gates.paths).toBe('FAIL'))
  it.each([
    '!include C:/evil/my.ini\n',
    'init_file=C:/evil.sql\n',
    'port=3306\n',
    `datadir=C:/ProgramData/MySQL/MySQL Server 8.0/Data\n`,
  ])('rejects config substitution and unsafe options', async (suffix) => {
    expect((await check(fixture({ config: configuration + suffix }))).gates.config).toBe('FAIL')
  })
  it('rejects a competing listener', async () => expect((await check(fixture({ snapshot: { processes: [], listeners: [{ port: 3307, pid: 44 }] } }))).code).toBe('COMPETING_LISTENER'))
  it('rejects a process using the disposable config', async () => {
    const item = { pid: 55, commandLine: `other.exe --defaults-file=${configPath}`, creationDate: '2026-11-14T00:00:00Z' }
    expect((await check(fixture({ snapshot: { processes: [item], listeners: [] } }))).code).toBe('EXISTING_PROCESS')
  })
  it('detects PID reuse', async () => {
    const item = { pid: marker.serverPid, commandLine: 'mysqld.exe', creationDate: '2026-11-14T00:00:00Z' }
    expect((await check(fixture({ snapshot: { processes: [item], listeners: [] } }))).code).toBe('PID_REUSE')
  })
  it('detects a stale PID without deleting it', async () => expect((await check(fixture({ pid: marker.serverPid }))).code).toBe('STALE_PID_FILE'))
  it('fails closed when process inspection is unavailable', async () => {
    const f = fixture()
    f.options.snapshot = () => { throw new Error('access denied') }
    expect((await check(f)).status).toBe('UNKNOWN')
  })
  it.each([
    [{ stderr: 'Get-CimInstance: Access denied HRESULT 0x80041003', status: 1 }, 'PROCESS_QUERY_PERMISSION_DENIED'],
    [{ stderr: 'Invalid class HRESULT 0x80041010', status: 1 }, 'WMI_CIM_UNAVAILABLE'],
    [{ code: 'ETIMEDOUT', message: 'timed out' }, 'PROCESS_QUERY_TIMEOUT'],
    [{ stderr: 'PowerShell failed', status: 1 }, 'PROCESS_COMMAND_FAILED'],
  ])('classifies read-only process command errors without exposing stderr', (failure, expected) => {
    const execFileSyncImpl = vi.fn(() => { throw failure })
    expect(() => restart.systemSnapshot({ execFileSyncImpl })).toThrow(expected)
    expect(execFileSyncImpl).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({ timeout: 15000 }))
  })
  it('rejects malformed process output', () => {
    expect(() => restart.systemSnapshot({ execFileSyncImpl: () => 'not-json' })).toThrow('PROCESS_OUTPUT_PARSE_ERROR')
  })
  it.each([
    [{ processes: [] }, 'PROCESS_QUERY_INCOMPLETE'],
    [{ processes: [{ pid: 9 }], listeners: [] }, 'PROCESS_IDENTITY_UNKNOWN'],
    [{ processes: [{ pid: 9, commandLine: 'x', creationDate: '2026-11-14T00:00:00Z' }, { pid: 9, commandLine: 'x', creationDate: '2026-11-14T00:00:00Z' }], listeners: [] }, 'PROCESS_EVIDENCE_CONFLICT'],
  ])('fails closed on partial or conflicting process evidence', async (snapshot, code) => {
    const result = await check(fixture({ snapshot }))
    expect(result.status).toBe('UNKNOWN')
    expect(result.code).toBe(code)
  })
  it('accepts a complete read-only query provider only after all existing checks', async () => {
    const f = fixture()
    delete f.options.snapshot
    f.options.execFileSyncImpl = vi.fn(() => JSON.stringify({ processes: [], listeners: [] }))
    expect((await check(f)).status).toBe('PASS')
    expect(f.options.execFileSyncImpl).toHaveBeenCalledTimes(1)
  })
  it('does not treat an incomplete fallback as safe', async () => {
    const f = fixture()
    delete f.options.snapshot
    f.options.execFileSyncImpl = () => JSON.stringify({ processes: [], listeners: null })
    expect((await check(f)).code).toBe('PROCESS_QUERY_INCOMPLETE')
  })
  it('allows concurrent read-only preflights without creating a lock', async () => {
    const a = fixture(); const b = fixture()
    const [left, right] = await Promise.all([check(a), check(b)])
    expect([left.status, right.status]).toEqual(['PASS', 'PASS'])
  })
  it('denies the startup CLI and does not call a spawn function', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const before = process.exitCode
    try {
      await restart.main(['start-existing'])
      expect(output).toHaveBeenCalledWith(expect.stringContaining('STARTUP_NOT_APPROVED'))
      expect(process.exitCode).toBe(2)
    } finally { process.exitCode = before; output.mockRestore() }
  })
})
