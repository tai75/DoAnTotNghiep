const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');

const namespaces = Object.freeze({ resumes: 'resumes', logos: 'logos' });
const managedKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|docx|png|jpe?g)$/i;
const legacyKeyPattern = /^[0-9a-f]{32}\.(pdf|docx|png|jpe?g)$/i;

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertNamespace(namespace) {
  if (!namespaces[namespace]) throw new Error('Unknown storage namespace');
}

function assertManagedKey(key) {
  if (typeof key !== 'string' || !managedKeyPattern.test(key) || path.basename(key) !== key) {
    const error = new Error('Invalid storage key');
    error.code = 'INVALID_STORAGE_KEY';
    throw error;
  }
  return key;
}

function createKey(extension) {
  const normalized = String(extension).toLowerCase().replace(/^\./, '');
  if (!['pdf', 'docx', 'png', 'jpg', 'jpeg'].includes(normalized)) throw new Error('Unsupported storage extension');
  return `${crypto.randomUUID()}.${normalized}`;
}

function activePath(namespace, key) {
  assertNamespace(namespace);
  assertManagedKey(key);
  return path.join(config.storageDirectories[namespace], key);
}

function legacyRoot(namespace) {
  return namespace === namespaces.resumes ? config.legacyUploadsDirectory : config.legacyLogosDirectory;
}

function legacyKeyFromReference(namespace, reference) {
  if (typeof reference !== 'string') return null;
  const candidate = namespace === namespaces.logos ? reference.replace(/^\/assets\/logos\//, '') : reference;
  return legacyKeyPattern.test(candidate) && path.basename(candidate) === candidate ? candidate : null;
}

async function initialize() {
  if (path.resolve(config.storageRoot) === path.resolve(config.repositoryRoot) || isWithin(config.repositoryRoot, config.storageRoot)) {
    throw new Error('STORAGE_ROOT must be outside the application source tree');
  }
  await fs.promises.mkdir(config.storageRoot, { recursive: true });
  const [realRepositoryRoot, realStorageRoot] = await Promise.all([
    fs.promises.realpath(config.repositoryRoot),
    fs.promises.realpath(config.storageRoot)
  ]);
  if (realStorageRoot === realRepositoryRoot || isWithin(realRepositoryRoot, realStorageRoot)) {
    throw new Error('STORAGE_ROOT resolves inside the application source tree');
  }
  await Promise.all(Object.values(config.storageDirectories).map((directory) => fs.promises.mkdir(directory, { recursive: true })));
  const probe = path.join(config.storageDirectories.temporary, `.probe-${crypto.randomUUID()}`);
  const renamed = `${probe}.ok`;
  const linked = `${probe}.linked`;
  try {
    await fs.promises.writeFile(probe, 'storage-probe', { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(probe, renamed);
    await fs.promises.link(renamed, linked);
    await fs.promises.unlink(renamed);
    await fs.promises.unlink(linked);
  } catch (error) {
    await fs.promises.unlink(probe).catch(() => {});
    await fs.promises.unlink(renamed).catch(() => {});
    await fs.promises.unlink(linked).catch(() => {});
    throw new Error(`Storage is not writable: ${error.code || error.message}`);
  }
}

async function readableRegularFile(candidate) {
  try {
    const stat = await fs.promises.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    await fs.promises.access(candidate, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function put(namespace, key, buffer) {
  assertNamespace(namespace);
  const destination = activePath(namespace, key);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(config.storageDirectories.temporary, `${crypto.randomUUID()}.upload`);
  await fs.promises.mkdir(config.storageDirectories.temporary, { recursive: true });
  try {
    await fs.promises.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    // Hard-link publication is atomic and refuses collisions instead of replacing an existing file.
    await fs.promises.link(temporary, destination);
    await fs.promises.unlink(temporary);
    return key;
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function locate(namespace, reference) {
  assertNamespace(namespace);
  if (typeof reference !== 'string') return null;
  const managedReference = namespace === namespaces.logos ? reference.replace(/^\/assets\/logos\//, '') : reference;
  if (managedKeyPattern.test(managedReference) && path.basename(managedReference) === managedReference) {
    const candidate = activePath(namespace, managedReference);
    return await readableRegularFile(candidate) ? { path: candidate, key: managedReference, managed: true } : null;
  }
  const legacyKey = legacyKeyFromReference(namespace, reference);
  if (!legacyKey) return null;
  const candidate = path.join(legacyRoot(namespace), legacyKey);
  return await readableRegularFile(candidate) ? { path: candidate, key: legacyKey, managed: false } : null;
}

async function read(namespace, reference) {
  const entry = await locate(namespace, reference);
  if (!entry) return null;
  return fs.promises.readFile(entry.path);
}

async function removeManaged(namespace, reference) {
  const entry = await locate(namespace, reference);
  if (!entry || !entry.managed) return { removed: false, reason: entry ? 'legacy' : 'missing' };
  try {
    await fs.promises.unlink(entry.path);
    return { removed: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: false, reason: 'missing' };
    throw error;
  }
}

module.exports = {
  namespaces,
  managedKeyPattern,
  assertManagedKey,
  createKey,
  initialize,
  put,
  locate,
  read,
  removeManaged
};
