const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

async function checksum(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function safeManifestPath(value) {
  return typeof value === 'string' && /^(resumes\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|docx)|logos\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g))$/i.test(value);
}

function validManifestEntry(entry) {
  return entry && safeManifestPath(entry.path)
    && Number.isSafeInteger(entry.size) && entry.size >= 0
    && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(entry.sha256);
}

async function listFiles(root) {
  const files = [];
  for (const namespace of ['resumes', 'logos']) {
    const directory = path.join(root, namespace);
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries) {
      if (entry.isFile()) files.push(`${namespace}/${entry.name}`);
    }
  }
  return files.sort();
}

async function inventory(root, references = []) {
  const files = await listFiles(root);
  const fileSet = new Set(files);
  const normalizedReferences = [...new Set(references.map((value) => String(value).replace(/\\/g, '/')))];
  return {
    files,
    orphaned: files.filter((file) => !normalizedReferences.includes(file)),
    missing: normalizedReferences.filter((reference) => !fileSet.has(reference))
  };
}

async function backup({ sourceRoot, destination, databaseSnapshotId }) {
  if (!databaseSnapshotId) throw new Error('databaseSnapshotId is required for a coordinated backup');
  const files = await listFiles(sourceRoot);
  const unsafe = files.filter((relative) => !safeManifestPath(relative));
  if (unsafe.length) throw new Error(`Storage contains unsafe file names: ${unsafe.join(', ')}`);
  await fs.promises.mkdir(destination, { recursive: false });
  const manifest = { version: 1, createdAt: new Date().toISOString(), databaseSnapshotId, files: [] };
  for (const relative of files) {
    const source = path.join(sourceRoot, ...relative.split('/'));
    const target = path.join(destination, ...relative.split('/'));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    const stat = await fs.promises.stat(target);
    manifest.files.push({ path: relative, size: stat.size, sha256: await checksum(target) });
  }
  await fs.promises.writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return manifest;
}

async function verify(backupRoot) {
  const manifest = JSON.parse(await fs.promises.readFile(path.join(backupRoot, 'manifest.json'), 'utf8'));
  const failures = [];
  if (manifest.version !== 1 || typeof manifest.databaseSnapshotId !== 'string' || !manifest.databaseSnapshotId || !Array.isArray(manifest.files)) {
    return { valid: false, failures: ['manifest'], manifest };
  }
  const seen = new Set();
  for (const expected of manifest.files || []) {
    if (!validManifestEntry(expected) || seen.has(expected.path)) {
      failures.push(String(expected.path));
      continue;
    }
    seen.add(expected.path);
    const target = path.join(backupRoot, ...expected.path.split('/'));
    try {
      const stat = await fs.promises.stat(target);
      const actualChecksum = await checksum(target);
      if (stat.size !== expected.size || actualChecksum !== expected.sha256) failures.push(expected.path);
    } catch { failures.push(expected.path); }
  }
  const unexpected = (await listFiles(backupRoot)).filter((relative) => !seen.has(relative));
  failures.push(...unexpected.map((relative) => `unexpected:${relative}`));
  return { valid: failures.length === 0, failures, manifest };
}

async function restore({ backupRoot, targetRoot, expectedDatabaseSnapshotId }) {
  if (!expectedDatabaseSnapshotId) throw new Error('expectedDatabaseSnapshotId is required');
  let existing = [];
  try { existing = await fs.promises.readdir(targetRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing.length) throw new Error('Restore target must be empty');
  const result = await verify(backupRoot);
  if (!result.valid) throw new Error(`Backup verification failed: ${result.failures.join(', ')}`);
  if (result.manifest.databaseSnapshotId !== expectedDatabaseSnapshotId) throw new Error('Database snapshot ID does not match the storage backup');
  await fs.promises.mkdir(targetRoot, { recursive: true });
  for (const expected of result.manifest.files) {
    const source = path.join(backupRoot, ...expected.path.split('/'));
    const target = path.join(targetRoot, ...expected.path.split('/'));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  }
  const restoredFiles = await listFiles(targetRoot);
  return { restored: restoredFiles.length, databaseSnapshotId: result.manifest.databaseSnapshotId };
}

module.exports = { checksum, listFiles, inventory, backup, verify, restore, safeManifestPath };
