const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EXPECTED, E2eSafetyError } = require('./e2e-guard.cjs');

const ROOT_NAME = 'job-connect-e2e-disposable';
const QA01_ROOT_NAME = 'job-connect-qa01-storage';
const MARKER_FILE = '.job-connect-e2e-marker.json';
const LOCK_FILE = '.job-connect-e2e.lock';
const ATTESTATION_FILE = '.job-connect-e2e-canonical.json';

function validateRunId(runId) {
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(runId)) {
    throw new E2eSafetyError('E2E_RUN_ID không hợp lệ hoặc chứa path traversal', 'E2E_RUN_ID_INVALID');
  }
  return runId;
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function storageLayout(runId, options = {}) {
  validateRunId(runId);
  const tempRoot = path.resolve(options.tempRoot || os.tmpdir());
  const baseRoot = path.resolve(tempRoot, ROOT_NAME);
  const root = path.resolve(baseRoot, runId);
  return Object.freeze({
    tempRoot,
    baseRoot,
    root,
    storageRoot: path.join(root, 'storage'),
    resumesRoot: path.join(root, 'storage', 'resumes'),
    logosRoot: path.join(root, 'storage', 'logos'),
    temporaryRoot: path.join(root, 'storage', 'tmp'),
    legacyUploadsRoot: path.join(root, 'legacy', 'uploads'),
    legacyLogosRoot: path.join(root, 'legacy', 'logos'),
    authRoot: path.join(root, 'auth'),
    artifactsRoot: path.join(root, 'artifacts'),
    markerPath: path.join(root, MARKER_FILE),
    // Shared across run IDs because every run targets the same disposable DB.
    lockPath: path.join(baseRoot, LOCK_FILE),
    attestationPath: path.join(root, ATTESTATION_FILE),
  });
}

function validateStorageRoot(root, runId, options = {}) {
  const layout = storageLayout(runId, options);
  const resolved = path.resolve(root);
  if (resolved !== layout.root) throw new E2eSafetyError('Storage root không khớp disposable path đã derive', 'E2E_STORAGE_ROOT_MISMATCH');
  if (!isWithin(layout.tempRoot, resolved)) throw new E2eSafetyError('Storage root phải nằm dưới OS temp', 'E2E_STORAGE_OUTSIDE_TEMP');
  const repositoryRoot = options.repositoryRoot && path.resolve(options.repositoryRoot);
  if (repositoryRoot && (resolved === repositoryRoot || isWithin(repositoryRoot, resolved) || isWithin(resolved, repositoryRoot))) {
    throw new E2eSafetyError('Từ chối repository path làm disposable storage', 'E2E_STORAGE_REPOSITORY_PATH');
  }
  const qaRoot = path.resolve(layout.tempRoot, QA01_ROOT_NAME);
  if (resolved === qaRoot || isWithin(qaRoot, resolved) || isWithin(resolved, qaRoot)) {
    throw new E2eSafetyError('Từ chối QA-01 storage path', 'E2E_STORAGE_QA01_PATH');
  }
  return layout;
}

async function assertNoReparsePoints(target, options = {}) {
  const lstat = options.lstat || fs.promises.lstat;
  const parse = path.parse(path.resolve(target));
  const relative = path.relative(parse.root, path.resolve(target));
  let current = parse.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new E2eSafetyError('Từ chối symlink/junction/reparse point trong storage path', 'E2E_STORAGE_REPARSE_POINT');
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
}

function expectedMarker(runId) {
  return { version: 1, runId: validateRunId(runId), database: EXPECTED.database };
}

function validateMarker(marker, runId) {
  if (!marker || typeof marker !== 'object') throw new E2eSafetyError('Thiếu disposable storage marker', 'E2E_STORAGE_MARKER_MISSING');
  const expected = expectedMarker(runId);
  if (marker.version !== expected.version || marker.runId !== expected.runId || marker.database !== expected.database) {
    throw new E2eSafetyError('Disposable storage marker không khớp run/database', 'E2E_STORAGE_MARKER_MISMATCH');
  }
  return true;
}

async function readAndValidateMarker(layout, runId, options = {}) {
  const readFile = options.readFile || fs.promises.readFile;
  let raw;
  try {
    raw = await readFile(layout.markerPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new E2eSafetyError('Thiếu disposable storage marker', 'E2E_STORAGE_MARKER_MISSING');
    throw error;
  }
  let marker;
  try { marker = JSON.parse(raw); } catch { throw new E2eSafetyError('Disposable storage marker không phải JSON hợp lệ', 'E2E_STORAGE_MARKER_INVALID'); }
  validateMarker(marker, runId);
  return marker;
}

async function readAndValidateLock(layout, runId, options = {}) {
  const readFile = options.readFile || fs.promises.readFile;
  let raw;
  try {
    raw = await readFile(layout.lockPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new E2eSafetyError('Thiếu disposable E2E run lock', 'E2E_STORAGE_LOCK_MISSING');
    throw error;
  }
  let lock;
  try { lock = JSON.parse(raw); } catch { throw new E2eSafetyError('Disposable E2E run lock không phải JSON hợp lệ', 'E2E_STORAGE_LOCK_INVALID'); }
  validateMarker(lock, runId);
  return lock;
}

async function acquireRunLock(layout, runId, options = {}) {
  const open = options.open || fs.promises.open;
  try {
    const handle = await open(layout.lockPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(expectedMarker(runId)), 'utf8');
    await handle.close();
  } catch (error) {
    if (error?.code === 'EEXIST') throw new E2eSafetyError('Disposable E2E run đang bị lock bởi run khác', 'E2E_STORAGE_LOCKED');
    throw error;
  }
}

async function releaseRunLock(layout, runId, options = {}) {
  await readAndValidateLock(layout, runId, options);
  const unlink = options.unlink || fs.promises.unlink;
  await unlink(layout.lockPath);
}

async function initializeStorage(environment = process.env, options = {}) {
  const runId = validateRunId(environment.E2E_RUN_ID);
  const layout = validateStorageRoot(storageLayout(runId, options).root, runId, options);
  const mkdir = options.mkdir || fs.promises.mkdir;
  const writeFile = options.writeFile || fs.promises.writeFile;
  await assertNoReparsePoints(layout.baseRoot, options);
  await mkdir(layout.baseRoot, { recursive: true });
  await assertNoReparsePoints(layout.baseRoot, options);
  await acquireRunLock(layout, runId, options);
  try {
    await mkdir(layout.root, { recursive: true });
    await assertNoReparsePoints(layout.root, options);
    await Promise.all([
      layout.resumesRoot, layout.logosRoot, layout.temporaryRoot,
      layout.legacyUploadsRoot, layout.legacyLogosRoot, layout.authRoot, layout.artifactsRoot,
    ].map((directory) => mkdir(directory, { recursive: true })));
    await writeFile(layout.markerPath, JSON.stringify(expectedMarker(runId), null, 2), { flag: 'wx', mode: 0o600 });
    return layout;
  } catch (error) {
    await releaseRunLock(layout, runId, options).catch(() => {});
    throw error;
  }
}

async function validateExistingStorage(environment = process.env, options = {}) {
  const runId = validateRunId(environment.E2E_RUN_ID);
  const layout = validateStorageRoot(storageLayout(runId, options).root, runId, options);
  await assertNoReparsePoints(layout.baseRoot, options);
  await assertNoReparsePoints(layout.root, options);
  await readAndValidateMarker(layout, runId, options);
  await readAndValidateLock(layout, runId, options);
  return layout;
}

async function clearManagedStorage(environment = process.env, options = {}) {
  const layout = await validateExistingStorage(environment, options);
  const rm = options.rm || fs.promises.rm;
  const mkdir = options.mkdir || fs.promises.mkdir;
  for (const directory of [layout.resumesRoot, layout.logosRoot, layout.temporaryRoot]) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  }
  return layout;
}

async function cleanupStorage(environment = process.env, options = {}) {
  const layout = await validateExistingStorage(environment, options);
  const rm = options.rm || fs.promises.rm;
  await rm(layout.root, { recursive: true, force: false });
  await releaseRunLock(layout, environment.E2E_RUN_ID, options);
  return layout.root;
}

async function writeCanonicalAttestation(environment = process.env, options = {}) {
  const layout = await validateExistingStorage(environment, options);
  const writeFile = options.writeFile || fs.promises.writeFile;
  const payload = {
    ...expectedMarker(environment.E2E_RUN_ID),
    migrationCount: EXPECTED.migrationCount,
    verifiedAt: new Date(options.now || Date.now()).toISOString(),
  };
  await writeFile(layout.attestationPath, JSON.stringify(payload, null, 2), { flag: 'w', mode: 0o600 });
  return payload;
}

function validateCanonicalAttestation(attestation, runId, options = {}) {
  validateMarker(attestation, runId);
  if (attestation.migrationCount !== EXPECTED.migrationCount) throw new E2eSafetyError('Canonical attestation thiếu migration', 'E2E_ATTESTATION_MIGRATION_MISMATCH');
  const verifiedAt = Date.parse(attestation.verifiedAt);
  const now = Number(options.now || Date.now());
  if (!Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > (options.maxAgeMs || 60 * 60 * 1000)) {
    throw new E2eSafetyError('Canonical attestation đã hết hạn hoặc không hợp lệ', 'E2E_ATTESTATION_EXPIRED');
  }
  return true;
}

async function main() {
  const command = process.argv[2];
  if (command === 'init') {
    const layout = await initializeStorage(process.env, { repositoryRoot: path.resolve(__dirname, '../..') });
    console.log(JSON.stringify({ status: 'PASS', command, root: layout.root }));
    return;
  }
  if (command === 'verify') {
    const layout = await validateExistingStorage(process.env, { repositoryRoot: path.resolve(__dirname, '../..') });
    console.log(JSON.stringify({ status: 'PASS', command, root: layout.root }));
    return;
  }
  if (command === 'cleanup') {
    const root = await cleanupStorage(process.env, { repositoryRoot: path.resolve(__dirname, '../..') });
    console.log(JSON.stringify({ status: 'PASS', command, root }));
    return;
  }
  throw new Error('Usage: e2e-storage.cjs init|verify|cleanup');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  ROOT_NAME,
  QA01_ROOT_NAME,
  MARKER_FILE,
  LOCK_FILE,
  ATTESTATION_FILE,
  validateRunId,
  isWithin,
  storageLayout,
  validateStorageRoot,
  assertNoReparsePoints,
  expectedMarker,
  validateMarker,
  readAndValidateMarker,
  readAndValidateLock,
  acquireRunLock,
  releaseRunLock,
  initializeStorage,
  validateExistingStorage,
  clearManagedStorage,
  cleanupStorage,
  writeCanonicalAttestation,
  validateCanonicalAttestation,
};
