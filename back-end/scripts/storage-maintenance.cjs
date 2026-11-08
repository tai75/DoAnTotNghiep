const path = require('path');
const config = require('../src/config/env');
const prisma = require('../src/config/prisma');
const maintenance = require('../src/storage/maintenance');
const storage = require('../src/storage/localStorage');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

function assertOutsideSource(target) {
  const relative = path.relative(config.repositoryRoot, target);
  if (target === config.repositoryRoot || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Backup and restore paths must be outside the source repository');
  }
}

async function references() {
  const [resumes, companies] = await Promise.all([
    prisma.candidateResume.findMany({ select: { path: true } }),
    prisma.company.findMany({ where: { logoUrl: { not: null } }, select: { logoUrl: true } })
  ]);
  return [
    ...resumes.filter(({ path: value }) => storage.managedKeyPattern.test(value)).map(({ path: value }) => `resumes/${value}`),
    ...companies.map(({ logoUrl }) => logoUrl?.replace(/^\/assets\/logos\//, '')).filter((value) => storage.managedKeyPattern.test(value)).map((value) => `logos/${value}`)
  ];
}

async function main() {
  const command = process.argv[2];
  if (command === 'reconcile') {
    const result = await maintenance.inventory(config.storageRoot, await references());
    console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
  } else if (command === 'backup') {
    const destination = argument('destination');
    const databaseSnapshotId = argument('database-snapshot-id');
    if (!destination) throw new Error('--destination is required');
    const resolvedDestination = path.resolve(destination);
    assertOutsideSource(resolvedDestination);
    const result = await maintenance.backup({ sourceRoot: config.storageRoot, destination: resolvedDestination, databaseSnapshotId });
    console.log(JSON.stringify({ backedUp: result.files.length, databaseSnapshotId }, null, 2));
  } else if (command === 'verify') {
    const source = argument('source');
    if (!source) throw new Error('--source is required');
    const result = await maintenance.verify(path.resolve(source));
    console.log(JSON.stringify({ valid: result.valid, failures: result.failures }, null, 2));
    if (!result.valid) process.exitCode = 1;
  } else if (command === 'restore') {
    if (process.env.ALLOW_STORAGE_RESTORE !== 'true') throw new Error('ALLOW_STORAGE_RESTORE=true is required');
    const source = argument('source');
    const target = argument('target');
    const databaseSnapshotId = argument('database-snapshot-id');
    if (!source || !target || !databaseSnapshotId) throw new Error('--source, --target and --database-snapshot-id are required');
    const resolvedTarget = path.resolve(target);
    assertOutsideSource(resolvedTarget);
    if (resolvedTarget === path.resolve(config.storageRoot)) throw new Error('Restore into the active storage root is not allowed');
    const result = await maintenance.restore({
      backupRoot: path.resolve(source), targetRoot: resolvedTarget, expectedDatabaseSnapshotId: databaseSnapshotId
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Usage: storage-maintenance.cjs reconcile | backup --destination PATH --database-snapshot-id ID | verify --source PATH | restore --source PATH --target EMPTY_PATH --database-snapshot-id ID');
  }
}

main().catch((error) => {
  console.error({ name: error.name, message: error.message });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
