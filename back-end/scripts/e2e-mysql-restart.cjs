// Read-only preflight. This module intentionally has no startup or filesystem write path.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { APPROVED_INSTANCE_ROOT, MARKER_NAME, PID_FILE, validateInstanceRoot, validateMarkerV2Schema, assertNoReparsePointsSync } = require('./e2e-process-guard.cjs');
const { validateExistingStorage, validateRunId } = require('./e2e-storage.cjs');

const STATES = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN', NOT_RUN: 'NOT RUN' });
const GATES = Object.freeze(['environment', 'root', 'storage', 'paths', 'config', 'datadir', 'processes', 'pidFile']);
const APPROVED_EXECUTABLE = path.win32.join('C:\\Program Files', 'MySQL', 'MySQL Server 8.0', 'bin', 'mysqld.exe');
const FORBIDDEN_CONFIG = /^(?:!include(?:dir)?\b|loose[-_]|(?:initialize|initialize[-_]insecure|bootstrap|skip[-_]grant[-_]tables|init[-_]file|plugin[-_]load(?:[-_]add)?|defaults[-_](?:file|extra[-_]file)|datadir[-_]copy|innodb[-_]force[-_]recovery)\b)/i;

function safety(code) { const error = new Error(code); error.code = code; return error; }
function samePath(left, right) { return path.win32.normalize(String(left)).replace(/[\\/]+$/, '').toLowerCase() === path.win32.normalize(String(right)).replace(/[\\/]+$/, '').toLowerCase(); }
function assertFile(actual, expected, filesystem) {
  if (!samePath(actual, expected)) throw safety('PATH_MISMATCH');
  assertNoReparsePointsSync(expected, { lstatSync: filesystem.lstatSync.bind(filesystem) });
  if (!filesystem.statSync(expected).isFile()) throw safety('FILE_MISSING');
  if (!samePath(filesystem.realpathSync.native(expected), expected)) throw safety('PATH_ALIAS');
}
function assertDirectory(actual, expected, filesystem) {
  if (!samePath(actual, expected)) throw safety('DATADIR_MISMATCH');
  assertNoReparsePointsSync(expected, { lstatSync: filesystem.lstatSync.bind(filesystem) });
  if (!filesystem.statSync(expected).isDirectory()) throw safety('DATADIR_MISSING');
  if (!samePath(filesystem.realpathSync.native(expected), expected)) throw safety('PATH_ALIAS');
}

function inspectConfig(raw, root) {
  const expected = {
    basedir: path.win32.dirname(path.win32.dirname(APPROVED_EXECUTABLE)),
    datadir: path.win32.join(root, 'data'),
    port: '3307',
    'bind-address': '127.0.0.1',
    mysqlx: '0',
    skip_name_resolve: 'ON',
    local_infile: 'OFF',
    secure_file_priv: 'NULL',
    named_pipe: 'OFF',
    shared_memory: 'OFF',
    default_storage_engine: 'InnoDB',
    log_error: path.win32.join(root, 'logs', 'mysqld-error.log'),
    pid_file: path.win32.join(root, PID_FILE),
  };
  const seen = new Map();
  let section = null;
  for (const source of String(raw).split(/\r?\n/)) {
    const line = source.trim();
    if (!line || /^[#;]/.test(line)) continue;
    if (FORBIDDEN_CONFIG.test(line)) throw safety('CONFIG_UNSAFE_OPTION');
    if (/^\[.*\]$/.test(line)) {
      if (section !== null || line.toLowerCase() !== '[mysqld]') throw safety('CONFIG_SECTION_MISMATCH');
      section = 'mysqld';
      continue;
    }
    if (section !== 'mysqld') throw safety('CONFIG_SECTION_MISMATCH');
    const match = /^([a-z][a-z0-9_-]*)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!match) throw safety('CONFIG_UNSAFE_OPTION');
    const key = match[1].toLowerCase();
    if (!(key in expected) || seen.has(key)) throw safety('CONFIG_UNSAFE_OPTION');
    seen.set(key, match[2]);
  }
  if (seen.size !== Object.keys(expected).length) throw safety('CONFIG_INCOMPLETE');
  for (const [key, value] of Object.entries(expected)) {
    const observed = seen.get(key);
    if (['basedir', 'datadir', 'log_error', 'pid_file'].includes(key) ? !samePath(observed, value) : observed !== value) {
      throw safety('CONFIG_MISMATCH');
    }
  }
  return true;
}

function snapshotFailure(error) {
  const diagnostic = `${error?.stderr || ''} ${error?.message || ''}`;
  if (error?.code === 'EPERM' || error?.code === 'EACCES') return safety('PROCESS_COMMAND_PERMISSION_DENIED');
  if (error?.code === 'ETIMEDOUT' || /timed out/i.test(diagnostic)) return safety('PROCESS_QUERY_TIMEOUT');
  if (/0x80041003|access denied|permissiondenied/i.test(diagnostic)) return safety('PROCESS_QUERY_PERMISSION_DENIED');
  if (/0x80041010|invalid class|not recognized|not found.*(?:cim|wmi)/i.test(diagnostic)) return safety('WMI_CIM_UNAVAILABLE');
  return safety('PROCESS_COMMAND_FAILED');
}

function systemSnapshot(options = {}) {
  // One fixed, read-only PowerShell query; no user-controlled text enters the command.
  const script = "$ErrorActionPreference='Stop';$p=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'mysqld.exe' -or $_.CommandLine -like '*job-connect-e2e-mysql-qa03b2a*'} | ForEach-Object {[ordered]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;executablePath=$_.ExecutablePath;commandLine=$_.CommandLine;creationDate=$_.CreationDate.ToUniversalTime().ToString('o')}});try{$l=@(Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction Stop | ForEach-Object {[ordered]@{address=$_.LocalAddress;port=[int]$_.LocalPort;pid=[int]$_.OwningProcess}})}catch{if($_.CategoryInfo.Category -eq 'ObjectNotFound'){$l=@()}else{throw}};[ordered]@{processes=$p;listeners=$l}|ConvertTo-Json -Depth 5 -Compress";
  let raw;
  try { raw = (options.execFileSyncImpl || execFileSync)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 }); }
  catch (error) { throw snapshotFailure(error); }
  try { return JSON.parse(raw); }
  catch { throw safety('PROCESS_OUTPUT_PARSE_ERROR'); }
}

function inspectProcesses(snapshot, root, marker) {
  if (!snapshot || !Array.isArray(snapshot.processes) || !Array.isArray(snapshot.listeners)) throw safety('PROCESS_QUERY_INCOMPLETE');
  if (snapshot.processes.some((item) => !item || !Number.isSafeInteger(Number(item.pid)))
    || snapshot.listeners.some((item) => !item || !Number.isSafeInteger(Number(item.pid)) || Number(item.port) !== 3307)) throw safety('PROCESS_QUERY_INCOMPLETE');
  if (new Set(snapshot.processes.map((item) => Number(item.pid))).size !== snapshot.processes.length
    || new Set(snapshot.listeners.map((item) => `${item.address}:${item.port}:${item.pid}`)).size !== snapshot.listeners.length) throw safety('PROCESS_EVIDENCE_CONFLICT');
  if (snapshot.listeners.some((item) => Number(item.port) === 3307)) throw safety('COMPETING_LISTENER');
  const config = path.win32.join(root, 'my-disposable.ini');
  const datadir = path.win32.join(root, 'data');
  const needle = [config, datadir].map((item) => item.toLowerCase().replaceAll('\\', '/'));
  for (const item of snapshot.processes) {
    if (!Number.isInteger(Number(item.pid)) || !item.commandLine || !item.creationDate) throw safety('PROCESS_IDENTITY_UNKNOWN');
    if ([marker.launcherPid, marker.serverPid].includes(Number(item.pid))) {
      const created = Number(item.pid) === marker.launcherPid ? marker.launcherCreatedAt : marker.serverCreatedAt;
      if (Date.parse(item.creationDate) !== Date.parse(created)) throw safety('PID_REUSE');
      throw safety('EXISTING_PROCESS');
    }
    const command = item.commandLine.toLowerCase().replaceAll('\\', '/');
    if (needle.some((part) => command.includes(part))) throw safety('EXISTING_PROCESS');
  }
  return true;
}

async function preflight(environment = process.env, options = {}) {
  const filesystem = options.fs || fs;
  const result = { status: STATES.NOT_RUN, startup: 'STARTUP_NOT_APPROVED', processChain: 'PROCESS_CHAIN_UNVERIFIED', gates: Object.fromEntries(GATES.map((key) => [key, STATES.NOT_RUN])) };
  async function gate(name, action) {
    try { return await action(); }
    catch (error) {
      result.gates[name] = ['PROCESS_IDENTITY_UNKNOWN', 'PROCESS_QUERY_PERMISSION_DENIED', 'PROCESS_COMMAND_PERMISSION_DENIED', 'WMI_CIM_UNAVAILABLE', 'PROCESS_COMMAND_FAILED', 'PROCESS_OUTPUT_PARSE_ERROR', 'PROCESS_QUERY_TIMEOUT', 'PROCESS_QUERY_INCOMPLETE', 'PROCESS_EVIDENCE_CONFLICT'].includes(error?.code) ? STATES.UNKNOWN : STATES.FAIL;
      result.status = result.gates[name];
      result.code = error?.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'PREFLIGHT_CHECK_FAILED';
      return undefined;
    }
  }
  const env = await gate('environment', () => {
    if (!environment.E2E_MYSQL_INSTANCE_ROOT || !environment.E2E_RUN_ID) throw safety('E2E_ENV_MISSING');
    validateRunId(environment.E2E_RUN_ID);
    result.gates.environment = STATES.PASS;
    return environment;
  });
  if (!env) return result;
  const root = await gate('root', () => {
    const approved = validateInstanceRoot(env.E2E_MYSQL_INSTANCE_ROOT);
    assertNoReparsePointsSync(approved, { lstatSync: filesystem.lstatSync.bind(filesystem) });
    if (!filesystem.statSync(approved).isDirectory() || !samePath(filesystem.realpathSync.native(approved), approved)) throw safety('ROOT_IDENTITY_MISMATCH');
    result.gates.root = STATES.PASS;
    return approved;
  });
  if (!root) return result;
  const storage = await gate('storage', async () => {
    await (options.validateStorage || validateExistingStorage)(env, { repositoryRoot: path.resolve(__dirname, '../..') });
    result.gates.storage = STATES.PASS;
    return true;
  });
  if (!storage) return result;
  const marker = await gate('paths', () => {
    const parsed = JSON.parse(filesystem.readFileSync(path.join(root, MARKER_NAME), 'utf8'));
    validateMarkerV2Schema(parsed);
    const executable = APPROVED_EXECUTABLE;
    const config = path.win32.join(root, 'my-disposable.ini');
    const datadir = path.win32.join(root, 'data');
    assertFile(parsed.executablePath, executable, filesystem);
    assertFile(parsed.configPath, config, filesystem);
    assertDirectory(parsed.datadir, datadir, filesystem);
    result.gates.paths = STATES.PASS;
    return parsed;
  });
  if (!marker) return result;
  const config = await gate('config', () => {
    inspectConfig(filesystem.readFileSync(path.win32.join(root, 'my-disposable.ini'), 'utf8'), root);
    result.gates.config = STATES.PASS;
    return true;
  });
  if (!config) return result;
  const datadir = await gate('datadir', () => {
    for (const name of ['auto.cnf', 'ibdata1']) assertFile(path.win32.join(root, 'data', name), path.win32.join(root, 'data', name), filesystem);
    for (const name of ['mysql', 'job_connect_e2e_disposable', '#innodb_redo']) assertDirectory(path.win32.join(root, 'data', name), path.win32.join(root, 'data', name), filesystem);
    result.gates.datadir = STATES.PASS;
    return true;
  });
  if (!datadir) return result;
  const processes = await gate('processes', () => {
    let snapshot;
    try { snapshot = (options.snapshot || (() => systemSnapshot(options)))(); }
    catch (error) { throw error?.code && /^[A-Z0-9_]+$/.test(error.code) ? error : safety('PROCESS_COMMAND_FAILED'); }
    inspectProcesses(snapshot, root, marker);
    result.gates.processes = STATES.PASS;
    return snapshot;
  });
  if (!processes) return result;
  const pid = await gate('pidFile', () => {
    let raw;
    try { raw = filesystem.readFileSync(path.join(root, PID_FILE), 'utf8').trim(); }
    catch (error) {
      if (error?.code === 'ENOENT') {
        result.gates.pidFile = STATES.PASS;
        result.pidFile = 'ABSENT';
        return true;
      }
      throw error;
    }
    if (!/^\d+$/.test(raw)) throw safety('PID_FILE_INVALID');
    const value = Number(raw);
    if (value !== marker.serverPid) throw safety('PID_FILE_MISMATCH');
    if (!processes.processes.some((item) => Number(item.pid) === value)) throw safety('STALE_PID_FILE');
    throw safety('EXISTING_PROCESS');
  });
  if (!pid) return result;
  result.status = STATES.PASS;
  return result;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== 'preflight') {
    process.stdout.write(JSON.stringify({ status: 'FAIL', code: argv[0] === 'start-existing' ? 'STARTUP_NOT_APPROVED' : 'UNSUPPORTED_COMMAND' }) + '\n');
    process.exitCode = 2;
    return;
  }
  const result = await preflight();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status !== STATES.PASS) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { process.stdout.write(JSON.stringify({ status: 'UNKNOWN', code: 'PREFLIGHT_UNEXPECTED_ERROR' }) + '\n'); process.exitCode = 1; });

module.exports = { STATES, APPROVED_EXECUTABLE, inspectConfig, inspectProcesses, snapshotFailure, systemSnapshot, preflight, main };
