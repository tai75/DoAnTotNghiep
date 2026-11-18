const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createGuardedClient, E2eSafetyError, EXPECTED } = require('./e2e-guard.cjs');

const MARKER_NAME = '.job-connect-e2e-mysql-marker.json';
const PID_FILE = path.join('runtime', 'mysqld.pid');
const REFRESH_LOCK_NAME = '.job-connect-e2e-process-refresh.lock';
const MAX_MARKER_AGE_MS = 60 * 60 * 1000;
const APPROVED_INSTANCE_ROOT = path.resolve(os.tmpdir(), 'job-connect-e2e-mysql-qa03b2a');
const MARKER_V2_FIELDS = Object.freeze([
  'version', 'resource', 'state', 'host', 'port', 'database', 'launcherPid', 'serverPid',
  'executablePath', 'configPath', 'datadir', 'createdAt', 'launcherCreatedAt',
  'serverCreatedAt', 'verifiedAt',
]);

function fail(message, code) { throw new E2eSafetyError(message, code); }
function normalize(value) { return path.resolve(String(value)).replaceAll('/', '\\').toLowerCase(); }
function parseDate(value, code) {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail('Process ownership timestamp không hợp lệ', code);
  return result;
}

function defaultsFile(commandLine) {
  const match = String(commandLine || '').match(/--defaults-file=(?:"([^"]+)"|(\S+))/i);
  return match ? (match[1] || match[2]) : null;
}

function validateInstanceRoot(value) {
  if (!value || normalize(value) !== normalize(APPROVED_INSTANCE_ROOT)) fail('Standalone MySQL root không nằm trong exact allowlist', 'E2E_PROCESS_ROOT_MISMATCH');
  return APPROVED_INSTANCE_ROOT;
}

function validateMarkerV2Schema(marker) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)
    || marker.version !== 2 || marker.resource !== 'job-connect-e2e-mysql-qa03b2a' || marker.state !== 'ready'
    || marker.host !== EXPECTED.host || Number(marker.port) !== EXPECTED.port || marker.database !== EXPECTED.database) {
    fail('Ownership marker v2 thiếu hoặc không hợp lệ', 'E2E_PROCESS_MARKER_INVALID');
  }
  const keys = Object.keys(marker).sort();
  const expected = [...MARKER_V2_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('Ownership marker v2 chứa field ngoài schema allowlist', 'E2E_PROCESS_MARKER_FIELDS_INVALID');
  }
  if (!Number.isInteger(marker.launcherPid) || !Number.isInteger(marker.serverPid)) fail('Ownership marker thiếu launcher/server PID', 'E2E_PROCESS_PID_INVALID');
  for (const field of ['executablePath', 'configPath', 'datadir', 'createdAt', 'launcherCreatedAt', 'serverCreatedAt', 'verifiedAt']) {
    if (typeof marker[field] !== 'string' || !marker[field]) fail(`Ownership marker thiếu ${field}`, 'E2E_PROCESS_MARKER_INVALID');
  }
  parseDate(marker.createdAt, 'E2E_PROCESS_MARKER_TIME_INVALID');
  parseDate(marker.launcherCreatedAt, 'E2E_PROCESS_LAUNCHER_TIME_INVALID');
  parseDate(marker.serverCreatedAt, 'E2E_PROCESS_SERVER_TIME_INVALID');
  parseDate(marker.verifiedAt, 'E2E_PROCESS_VERIFIED_TIME_INVALID');
  return true;
}

function validateOwnershipEvidence(snapshot) {
  const { marker, launcher, server, listeners } = snapshot;
  validateMarkerV2Schema(marker);
  if (!launcher) fail('Launcher process không tồn tại', 'E2E_PROCESS_LAUNCHER_MISSING');
  if (!server) fail('Server process không tồn tại', 'E2E_PROCESS_SERVER_MISSING');
  if (launcher.processId !== marker.launcherPid || server.processId !== marker.serverPid) fail('Process PID không khớp marker', 'E2E_PROCESS_PID_MISMATCH');
  if (server.parentProcessId !== marker.launcherPid) fail('Server ParentProcessId không khớp launcher', 'E2E_PROCESS_PARENT_MISMATCH');
  if (snapshot.mysql80Pid && [marker.launcherPid, marker.serverPid].includes(Number(snapshot.mysql80Pid))) fail('Standalone process trùng MySQL80 service', 'E2E_PROCESS_MYSQL80_OVERLAP');
  if (normalize(launcher.executablePath) !== normalize(marker.executablePath) || normalize(server.executablePath) !== normalize(marker.executablePath)) {
    fail('ExecutablePath không khớp standalone MySQL', 'E2E_PROCESS_EXECUTABLE_MISMATCH');
  }
  if (normalize(defaultsFile(launcher.commandLine) || '') !== normalize(marker.configPath)
    || normalize(defaultsFile(server.commandLine) || '') !== normalize(marker.configPath)) {
    fail('Process --defaults-file không khớp', 'E2E_PROCESS_CONFIG_MISMATCH');
  }
  const matchingListeners = (listeners || []).filter((listener) => listener.address === EXPECTED.host && Number(listener.port) === EXPECTED.port);
  if (matchingListeners.length !== 1 || matchingListeners[0].owningProcess !== marker.serverPid) {
    fail('TCP listener owner không khớp server PID', 'E2E_PROCESS_LISTENER_MISMATCH');
  }
  if (normalize(snapshot.runtimeDatadir) !== normalize(marker.datadir)) fail('Runtime @@datadir không khớp standalone datadir', 'E2E_PROCESS_DATADIR_MISMATCH');
  const markerCreated = parseDate(marker.createdAt, 'E2E_PROCESS_MARKER_TIME_INVALID');
  const launcherCreated = parseDate(launcher.creationDate, 'E2E_PROCESS_LAUNCHER_TIME_INVALID');
  const serverCreated = parseDate(server.creationDate, 'E2E_PROCESS_SERVER_TIME_INVALID');
  if (markerCreated > launcherCreated || launcherCreated > serverCreated) fail('Ownership timeline không hợp lệ', 'E2E_PROCESS_MARKER_STALE');
  if (parseDate(marker.launcherCreatedAt, 'E2E_PROCESS_LAUNCHER_TIME_INVALID') !== launcherCreated
    || parseDate(marker.serverCreatedAt, 'E2E_PROCESS_SERVER_TIME_INVALID') !== serverCreated) {
    fail('CreationDate mismatch, có khả năng PID reuse', 'E2E_PROCESS_PID_REUSE');
  }
  return { launcherCreated, serverCreated };
}

function validateOwnershipSnapshot(snapshot, options = {}) {
  const { marker } = snapshot;
  const now = Number(options.now || Date.now());
  const maxAgeMs = Number(options.maxAgeMs || MAX_MARKER_AGE_MS);
  const { serverCreated } = validateOwnershipEvidence(snapshot);
  const verifiedAt = parseDate(marker.verifiedAt, 'E2E_PROCESS_VERIFIED_TIME_INVALID');
  if (serverCreated > verifiedAt || verifiedAt > now || now - verifiedAt > maxAgeMs) {
    fail('Ownership marker stale hoặc timeline không hợp lệ', 'E2E_PROCESS_MARKER_STALE');
  }
  return Object.freeze({ launcherPid: marker.launcherPid, serverPid: marker.serverPid, configPath: marker.configPath, datadir: marker.datadir });
}

function validateRefreshSnapshot(snapshot) {
  validateOwnershipEvidence(snapshot);
  return Object.freeze({ launcherPid: snapshot.marker.launcherPid, serverPid: snapshot.marker.serverPid });
}

function validateRefreshIdentities(marker, runner, migrator) {
  const runnerUser = String(runner?.currentUser || '').split('@')[0];
  const migratorUser = String(migrator?.currentUser || '').split('@')[0];
  if (runner?.databaseName !== EXPECTED.database || runnerUser !== EXPECTED.runnerUser || Number(runner?.serverPort) !== EXPECTED.port) {
    fail('Disposable runner identity không khớp', 'E2E_PROCESS_RUNNER_IDENTITY_MISMATCH');
  }
  if (migrator?.databaseName !== EXPECTED.database || migratorUser !== EXPECTED.migratorUser || Number(migrator?.serverPort) !== EXPECTED.port) {
    fail('Disposable migrator identity không khớp', 'E2E_PROCESS_MIGRATOR_IDENTITY_MISMATCH');
  }
  if (normalize(runner.runtimeDatadir) !== normalize(marker.datadir) || normalize(migrator.runtimeDatadir) !== normalize(marker.datadir)) {
    fail('Runner/migrator runtime datadir không khớp marker', 'E2E_PROCESS_DATADIR_MISMATCH');
  }
  return true;
}

function validateLegacySnapshot(snapshot) {
  const { marker, launcher, server, listeners, configPath, datadir, executablePath } = snapshot;
  if (!marker || marker.resource !== 'job-connect-e2e-mysql-qa03b2a' || marker.state !== 'ready') fail('Legacy marker không hợp lệ', 'E2E_PROCESS_MARKER_INVALID');
  if (!launcher || !server) fail('Legacy process ownership thiếu process', 'E2E_PROCESS_MISSING');
  if (launcher.processId !== Number(marker.pid) || server.parentProcessId !== launcher.processId) fail('Legacy parent/child mismatch', 'E2E_PROCESS_PARENT_MISMATCH');
  if ((listeners || []).length !== 1 || listeners[0].address !== EXPECTED.host || Number(listeners[0].port) !== EXPECTED.port || listeners[0].owningProcess !== server.processId) {
    fail('Legacy listener mismatch', 'E2E_PROCESS_LISTENER_MISMATCH');
  }
  if (normalize(launcher.executablePath) !== normalize(executablePath) || normalize(server.executablePath) !== normalize(executablePath)) fail('Legacy executable mismatch', 'E2E_PROCESS_EXECUTABLE_MISMATCH');
  if (normalize(defaultsFile(launcher.commandLine) || '') !== normalize(configPath) || normalize(defaultsFile(server.commandLine) || '') !== normalize(configPath)) fail('Legacy config mismatch', 'E2E_PROCESS_CONFIG_MISMATCH');
  if (normalize(snapshot.runtimeDatadir) !== normalize(datadir)) fail('Legacy datadir mismatch', 'E2E_PROCESS_DATADIR_MISMATCH');
  const markerCreated = parseDate(marker.createdAt, 'E2E_PROCESS_MARKER_TIME_INVALID');
  const launcherCreated = parseDate(launcher.creationDate, 'E2E_PROCESS_LAUNCHER_TIME_INVALID');
  const serverCreated = parseDate(server.creationDate, 'E2E_PROCESS_SERVER_TIME_INVALID');
  if (markerCreated > launcherCreated || launcherCreated > serverCreated) fail('Legacy marker timeline mismatch', 'E2E_PROCESS_MARKER_STALE');
  return true;
}

function parseMarkerRaw(raw) {
  let marker;
  try { marker = JSON.parse(raw); } catch { fail('Ownership marker không phải JSON hợp lệ', 'E2E_PROCESS_MARKER_INVALID'); }
  return marker;
}

function readMarker(instanceRoot) { return parseMarkerRaw(fs.readFileSync(path.join(instanceRoot, MARKER_NAME), 'utf8')); }
function readServerPid(instanceRoot, options = {}) {
  const readFileSync = options.readFileSync || fs.readFileSync;
  let value;
  try { value = readFileSync(path.join(instanceRoot, PID_FILE), 'utf8').trim(); }
  catch (error) {
    if (error?.code === 'ENOENT') fail('Thiếu MySQL PID file', 'E2E_PROCESS_PID_FILE_MISSING');
    throw error;
  }
  if (!/^\d+$/.test(value)) fail('PID file thiếu hoặc không hợp lệ', 'E2E_PROCESS_PID_FILE_INVALID');
  return Number(value);
}

function windowsSnapshot(launcherPid, serverPid) {
  const script = `$ErrorActionPreference='Stop';$ids=@(${launcherPid},${serverPid});$p=@();foreach($id in $ids){$w=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue;if($w){$p+=[ordered]@{processId=[int]$w.ProcessId;parentProcessId=[int]$w.ParentProcessId;creationDate=$w.CreationDate.ToUniversalTime().ToString('o');executablePath=$w.ExecutablePath;commandLine=$w.CommandLine}}};$l=Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 3307 -ErrorAction SilentlyContinue|ForEach-Object{[ordered]@{address=$_.LocalAddress;port=[int]$_.LocalPort;owningProcess=[int]$_.OwningProcess}};$svc=(sc.exe queryex MySQL80|Select-String 'PID').ToString();$mysql80=if($svc-match 'PID\s*:\s*(\d+)'){[int]$Matches[1]}else{0};[ordered]@{processes=$p;listeners=@($l);mysql80Pid=$mysql80}|ConvertTo-Json -Depth 6 -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }));
}

function windowsRecoverySnapshot(oldMarker, serverPid) {
  const oldPids = [oldMarker.launcherPid, oldMarker.serverPid].map(Number);
  const script = `$ErrorActionPreference='Stop';$server=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(serverPid)}" -ErrorAction SilentlyContinue;if(-not $server){throw 'Standalone server PID does not exist'};$launcherPid=[int]$server.ParentProcessId;$ids=@($launcherPid,${Number(serverPid)});$p=@();foreach($id in $ids){$w=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue;if($w){$p+=[ordered]@{processId=[int]$w.ProcessId;parentProcessId=[int]$w.ParentProcessId;creationDate=$w.CreationDate.ToUniversalTime().ToString('o');executablePath=$w.ExecutablePath;commandLine=$w.CommandLine}}};$old=@();foreach($id in @(${oldPids.join(',')})){if($ids-notcontains$id){$w=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue;if($w){$old+=[ordered]@{processId=[int]$w.ProcessId;creationDate=$w.CreationDate.ToUniversalTime().ToString('o');executablePath=$w.ExecutablePath;commandLine=$w.CommandLine}}}};$l=Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 3307 -ErrorAction SilentlyContinue|ForEach-Object{[ordered]@{address=$_.LocalAddress;port=[int]$_.LocalPort;owningProcess=[int]$_.OwningProcess}};$svc=(sc.exe queryex MySQL80|Select-String 'PID').ToString();$mysql80=if($svc-match 'PID\\s*:\\s*(\\d+)'){[int]$Matches[1]}else{0};[ordered]@{launcherPid=$launcherPid;processes=$p;oldProcesses=$old;listeners=@($l);mysql80Pid=$mysql80}|ConvertTo-Json -Depth 6 -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }));
}

function loadStaticSnapshot(instanceRoot, marker, options = {}) {
  const launcherPid = Number(marker.launcherPid || marker.pid);
  const serverPid = readServerPid(instanceRoot);
  const raw = (options.snapshotProvider || windowsSnapshot)(launcherPid, serverPid);
  const processes = Array.isArray(raw.processes) ? raw.processes : raw.processes ? [raw.processes] : [];
  const listeners = Array.isArray(raw.listeners) ? raw.listeners : raw.listeners ? [raw.listeners] : [];
  return { launcher: processes.find((item) => item.processId === launcherPid), server: processes.find((item) => item.processId === serverPid), listeners, mysql80Pid: Number(raw.mysql80Pid || 0) };
}

function loadRecoverySnapshot(instanceRoot, oldMarker, options = {}) {
  const serverPid = readServerPid(instanceRoot, options);
  const raw = (options.recoverySnapshotProvider || windowsRecoverySnapshot)(oldMarker, serverPid);
  const processes = Array.isArray(raw.processes) ? raw.processes : raw.processes ? [raw.processes] : [];
  const oldProcesses = Array.isArray(raw.oldProcesses) ? raw.oldProcesses : raw.oldProcesses ? [raw.oldProcesses] : [];
  const listeners = Array.isArray(raw.listeners) ? raw.listeners : raw.listeners ? [raw.listeners] : [];
  const launcherPid = Number(raw.launcherPid || processes.find((item) => item.processId === serverPid)?.parentProcessId);
  return {
    launcher: processes.find((item) => item.processId === launcherPid),
    server: processes.find((item) => item.processId === serverPid),
    oldProcesses,
    listeners,
    mysql80Pid: Number(raw.mysql80Pid || 0),
  };
}

async function runtimeIdentity(environment, role = 'runner', options = {}) {
  const guarded = await createGuardedClient(environment, { role, mode: 'identity-only', clientFactory: role === 'runner' ? options.clientFactory : options.migratorClientFactory });
  try {
    const [row] = await guarded.client.$queryRawUnsafe('SELECT DATABASE() databaseName, CURRENT_USER() currentUser, @@port serverPort, @@datadir runtimeDatadir');
    return { databaseName: row.databaseName, currentUser: row.currentUser, serverPort: Number(row.serverPort), runtimeDatadir: row.runtimeDatadir };
  } finally { await guarded.client.$disconnect(); }
}

async function runtimeDatadir(environment, options = {}) { return (await runtimeIdentity(environment, 'runner', options)).runtimeDatadir; }

function assertNoReparsePointsSync(target, options = {}) {
  const lstatSync = options.lstatSync || fs.lstatSync;
  const parse = path.parse(path.resolve(target));
  let current = parse.root;
  for (const segment of path.relative(parse.root, path.resolve(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) fail('Standalone root chứa symlink/junction/reparse point', 'E2E_PROCESS_REPARSE_POINT');
  }
}

function acquireRefreshLock(instanceRoot, options = {}) {
  const lockPath = path.join(instanceRoot, REFRESH_LOCK_NAME);
  const openSync = options.openSync || fs.openSync;
  const closeSync = options.closeSync || fs.closeSync;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  const unlinkSync = options.unlinkSync || fs.unlinkSync;
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ version: 1, pid: process.pid, createdAt: new Date(options.now || Date.now()).toISOString() })}\n`, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code === 'EEXIST') fail('Ownership marker refresh đang chạy', 'E2E_PROCESS_REFRESH_LOCKED');
    throw error;
  }
  return () => unlinkSync(lockPath);
}

function assertMarkerUnchanged(initialRaw, currentRaw) {
  if (currentRaw !== initialRaw) fail('Ownership marker đã thay đổi trong lúc refresh', 'E2E_PROCESS_MARKER_CHANGED');
}

function atomicReplaceMarker(markerPath, marker, options = {}) {
  const openSync = options.openSync || fs.openSync;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  const fsyncSync = options.fsyncSync || fs.fsyncSync;
  const closeSync = options.closeSync || fs.closeSync;
  const renameSync = options.renameSync || fs.renameSync;
  const unlinkSync = options.unlinkSync || fs.unlinkSync;
  const existsSync = options.existsSync || fs.existsSync;
  const temporary = `${markerPath}.refresh-${process.pid}-${Date.now()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, markerPath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) { try { unlinkSync(temporary); } catch {} }
    throw error;
  }
}

function buildRecoveryMarker(oldMarker, snapshot, instanceRoot, options = {}) {
  validateMarkerV2Schema(oldMarker);
  const expectedConfig = path.join(instanceRoot, 'my-disposable.ini');
  const expectedDatadir = path.join(instanceRoot, 'data');
  if (normalize(oldMarker.configPath) !== normalize(expectedConfig) || normalize(oldMarker.datadir) !== normalize(expectedDatadir)) {
    fail('Marker cÅ© khÃ´ng khá»›p config/datadir standalone allowlist', 'E2E_PROCESS_RECOVERY_PATH_MISMATCH');
  }
  if (!snapshot.launcher || !snapshot.server) fail('Recovery thiáº¿u launcher/server process', 'E2E_PROCESS_RECOVERY_PROCESS_MISSING');
  if ([oldMarker.launcherPid, oldMarker.serverPid].includes(snapshot.launcher.processId)
    || [oldMarker.launcherPid, oldMarker.serverPid].includes(snapshot.server.processId)) {
    fail('Recovery tá»« chá»‘i PID cÅ© hoáº·c PID reuse', 'E2E_PROCESS_RECOVERY_PID_REUSE');
  }
  if ((snapshot.oldProcesses || []).length) fail('Process sá»Ÿ há»¯u PID cÅ© váº«n tá»“n táº¡i', 'E2E_PROCESS_RECOVERY_OLD_PROCESS_ALIVE');
  const now = new Date(options.now || Date.now()).toISOString();
  return {
    version: 2,
    resource: oldMarker.resource,
    state: oldMarker.state,
    host: oldMarker.host,
    port: oldMarker.port,
    database: oldMarker.database,
    launcherPid: snapshot.launcher.processId,
    serverPid: snapshot.server.processId,
    executablePath: oldMarker.executablePath,
    configPath: expectedConfig,
    datadir: expectedDatadir,
    createdAt: snapshot.launcher.creationDate,
    launcherCreatedAt: snapshot.launcher.creationDate,
    serverCreatedAt: snapshot.server.creationDate,
    verifiedAt: now,
  };
}

async function refreshMarker(environment = process.env, options = {}) {
  const instanceRoot = validateInstanceRoot(environment.E2E_MYSQL_INSTANCE_ROOT);
  assertNoReparsePointsSync(instanceRoot, options);
  const release = acquireRefreshLock(instanceRoot, options);
  const markerPath = path.join(instanceRoot, MARKER_NAME);
  const readFileSync = options.readFileSync || fs.readFileSync;
  try {
    const initialRaw = readFileSync(markerPath, 'utf8');
    const marker = parseMarkerRaw(initialRaw);
    validateMarkerV2Schema(marker);
    const staticPart = loadStaticSnapshot(instanceRoot, marker, options);
    const [runner, migrator] = await Promise.all([
      runtimeIdentity(environment, 'runner', options),
      runtimeIdentity(environment, 'migrator', options),
    ]);
    validateRefreshIdentities(marker, runner, migrator);
    validateRefreshSnapshot({ marker, ...staticPart, runtimeDatadir: runner.runtimeDatadir });
    assertMarkerUnchanged(initialRaw, readFileSync(markerPath, 'utf8'));
    const refreshed = { ...marker, verifiedAt: new Date(options.now || Date.now()).toISOString() };
    validateOwnershipSnapshot({ marker: refreshed, ...staticPart, runtimeDatadir: runner.runtimeDatadir }, options);
    atomicReplaceMarker(markerPath, refreshed, options);
    const normal = await assertLiveOwnership(environment, options);
    return {
      markerPath,
      before: marker.verifiedAt,
      after: refreshed.verifiedAt,
      launcherPid: normal.launcherPid,
      serverPid: normal.serverPid,
      runner: runner.currentUser,
      migrator: migrator.currentUser,
    };
  } finally { release(); }
}

async function recoverMarker(environment = process.env, options = {}) {
  const instanceRoot = validateInstanceRoot(environment.E2E_MYSQL_INSTANCE_ROOT);
  assertNoReparsePointsSync(instanceRoot, options);
  const release = acquireRefreshLock(instanceRoot, options);
  const markerPath = path.join(instanceRoot, MARKER_NAME);
  const readFileSync = options.readFileSync || fs.readFileSync;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  try {
    const initialRaw = readFileSync(markerPath, 'utf8');
    const oldMarker = parseMarkerRaw(initialRaw);
    validateMarkerV2Schema(oldMarker);
    const staticPart = loadRecoverySnapshot(instanceRoot, oldMarker, options);
    const [runner, migrator] = await Promise.all([
      runtimeIdentity(environment, 'runner', options),
      runtimeIdentity(environment, 'migrator', options),
    ]);
    validateRefreshIdentities(oldMarker, runner, migrator);
    const recovered = buildRecoveryMarker(oldMarker, staticPart, instanceRoot, options);
    validateOwnershipSnapshot({ marker: recovered, ...staticPart, runtimeDatadir: runner.runtimeDatadir }, options);
    assertMarkerUnchanged(initialRaw, readFileSync(markerPath, 'utf8'));
    const stamp = recovered.verifiedAt.replaceAll(':', '-');
    const backupPath = path.join(instanceRoot, `${MARKER_NAME}.recovery-${stamp}.backup.json`);
    writeFileSync(backupPath, initialRaw, { flag: 'wx', mode: 0o600 });
    atomicReplaceMarker(markerPath, recovered, options);
    const normal = await assertLiveOwnership(environment, options);
    return {
      markerPath,
      backupPath,
      oldLauncherPid: oldMarker.launcherPid,
      oldServerPid: oldMarker.serverPid,
      launcherPid: normal.launcherPid,
      serverPid: normal.serverPid,
      runner: runner.currentUser,
      migrator: migrator.currentUser,
      verifiedAt: recovered.verifiedAt,
    };
  } finally { release(); }
}

async function assertLiveOwnership(environment = process.env, options = {}) {
  const instanceRoot = validateInstanceRoot(environment.E2E_MYSQL_INSTANCE_ROOT);
  const marker = readMarker(instanceRoot);
  const staticPart = loadStaticSnapshot(instanceRoot, marker, options);
  const snapshot = { marker, ...staticPart, runtimeDatadir: await runtimeDatadir(environment, options) };
  return validateOwnershipSnapshot(snapshot, options);
}

async function upgradeMarker(environment = process.env, options = {}) {
  const instanceRoot = validateInstanceRoot(environment.E2E_MYSQL_INSTANCE_ROOT);
  const markerPath = path.join(instanceRoot, MARKER_NAME);
  const legacy = readMarker(instanceRoot);
  if (legacy.version === 2) fail('Ownership marker đã ở schema v2', 'E2E_PROCESS_ALREADY_UPGRADED');
  const staticPart = loadStaticSnapshot(instanceRoot, legacy, options);
  const configPath = path.resolve(legacy.config);
  const datadir = path.resolve(legacy.data);
  const executablePath = path.resolve(legacy.binary);
  const liveDatadir = await runtimeDatadir(environment, options);
  validateLegacySnapshot({ marker: legacy, ...staticPart, configPath, datadir, executablePath, runtimeDatadir: liveDatadir });
  const backupPath = path.join(instanceRoot, `${MARKER_NAME}.v1.backup.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(legacy, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const upgraded = {
    version: 2,
    resource: legacy.resource,
    state: legacy.state,
    host: EXPECTED.host,
    port: EXPECTED.port,
    database: EXPECTED.database,
    launcherPid: staticPart.launcher.processId,
    serverPid: staticPart.server.processId,
    executablePath,
    configPath,
    datadir,
    createdAt: legacy.createdAt,
    launcherCreatedAt: staticPart.launcher.creationDate,
    serverCreatedAt: staticPart.server.creationDate,
    verifiedAt: new Date(options.now || Date.now()).toISOString(),
  };
  validateOwnershipSnapshot({ marker: upgraded, ...staticPart, runtimeDatadir: liveDatadir }, options);
  const temporary = `${markerPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(upgraded, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, markerPath);
  return { markerPath, backupPath, marker: upgraded };
}

async function main() {
  const command = process.argv[2];
  if (command === 'verify') { console.log(JSON.stringify({ status: 'PASS', ...(await assertLiveOwnership()) })); return; }
  if (command === 'refresh') { console.log(JSON.stringify({ status: 'PASS', ...(await refreshMarker()) })); return; }
  if (command === 'recover-marker') { console.log(JSON.stringify({ status: 'PASS', ...(await recoverMarker()) })); return; }
  if (command === 'upgrade-marker') { const result = await upgradeMarker(); console.log(JSON.stringify({ status: 'PASS', markerPath: result.markerPath, backupPath: result.backupPath, launcherPid: result.marker.launcherPid, serverPid: result.marker.serverPid })); return; }
  throw new Error('Usage: e2e-process-guard.cjs verify|refresh|recover-marker|upgrade-marker');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  MARKER_NAME, PID_FILE, REFRESH_LOCK_NAME, MAX_MARKER_AGE_MS, APPROVED_INSTANCE_ROOT,
  defaultsFile, validateInstanceRoot, validateMarkerV2Schema, validateOwnershipSnapshot,
  validateRefreshSnapshot, validateRefreshIdentities, validateLegacySnapshot, parseMarkerRaw, readServerPid,
  assertNoReparsePointsSync, acquireRefreshLock, assertMarkerUnchanged, atomicReplaceMarker,
  buildRecoveryMarker, runtimeIdentity, assertLiveOwnership, refreshMarker, recoverMarker, upgradeMarker,
};
