const { assertCanonical, createGuardedClient, validateE2eEnvironment } = require('./e2e-guard.cjs');
const { clearManagedStorage, storageLayout, validateExistingStorage, writeCanonicalAttestation } = require('./e2e-storage.cjs');
const { seedDisposableFixtures } = require('./e2e-fixtures.cjs');

async function resetBusinessData(prisma, environment = process.env, options = {}) {
  await assertCanonical(prisma, environment, options);
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name",
  );
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const { tableName } of tables) {
        const escaped = String(tableName).replaceAll('`', '``');
        await transaction.$executeRawUnsafe(`DELETE FROM \`${escaped}\``);
      }
    } finally {
      await transaction.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }
  });
  if (options.clearStorage !== false) await clearManagedStorage(environment, options.storageOptions);
  return tables.length;
}

async function loadStorageAdapter(environment = process.env, options = {}) {
  const layout = await validateExistingStorage(environment, options.storageOptions);
  process.env.STORAGE_ROOT = layout.storageRoot;
  process.env.UPLOADS_DIRECTORY = layout.legacyUploadsRoot;
  process.env.LOGOS_DIRECTORY = layout.legacyLogosRoot;
  // Import only after isolated roots have been injected.
  return require('../src/storage/localStorage');
}

async function seed(prisma, environment = process.env, options = {}) {
  await assertCanonical(prisma, environment, options);
  const password = environment.E2E_PASSWORD;
  const storage = options.storage || await loadStorageAdapter(environment, options);
  return seedDisposableFixtures({ prisma, storage, password });
}

async function tableCounts(prisma) {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name",
  );
  const counts = {};
  for (const { tableName } of tables) {
    const escaped = String(tableName).replaceAll('`', '``');
    const [row] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) count FROM \`${escaped}\``);
    counts[tableName] = Number(row.count);
  }
  return counts;
}

async function main() {
  const command = process.argv[2];
  if (!['identity', 'canonical', 'reset-seed', 'snapshot'].includes(command)) throw new Error('Usage: e2e-db.cjs identity|canonical|reset-seed|snapshot');
  validateE2eEnvironment(process.env);
  const guarded = await createGuardedClient(process.env, { mode: command === 'identity' ? 'identity-only' : 'canonical' });
  try {
    if (command === 'identity' || command === 'canonical') {
      if (command === 'canonical') await writeCanonicalAttestation(process.env, { repositoryRoot: require('node:path').resolve(__dirname, '../..') });
      console.log(JSON.stringify({ status: 'PASS', command, target: { database: guarded.target.database, host: guarded.target.host, port: guarded.target.port, user: guarded.target.user } }));
      return;
    }
    if (command === 'snapshot') {
      console.log(JSON.stringify({ status: 'PASS', command, counts: await tableCounts(guarded.client) }));
      return;
    }
    const clearedTables = await resetBusinessData(guarded.client);
    const fixture = await seed(guarded.client);
    console.log(JSON.stringify({ status: 'PASS', command, clearedTables, fixture, counts: await tableCounts(guarded.client) }));
  } finally {
    await guarded.client.$disconnect();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  assertCanonicalDatabase: assertCanonical,
  resetBusinessData,
  seed,
  tableCounts,
  loadStorageAdapter,
  storageLayout,
};
