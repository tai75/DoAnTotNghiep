const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED = Object.freeze({
  database: 'job_connect_e2e_disposable',
  runnerUser: 'job_connect_e2e_runner',
  migratorUser: 'job_connect_e2e_migrator',
  host: '127.0.0.1',
  port: 3307,
  migrationCount: 22,
});

const REQUIRED_RUNNER_ENV = Object.freeze([
  'E2E_DATABASE_URL',
  'E2E_DATABASE_NAME',
  'E2E_DATABASE_USER',
  'E2E_DATABASE_HOST',
  'E2E_DATABASE_PORT',
  'E2E_DESTRUCTIVE_CONFIRM',
]);

const FORBIDDEN_DATABASES = new Set([
  'job_connect',
  'job_connect_dev',
  'job_connect_development',
  'job_connect_qa01_e2e',
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
]);

const FORBIDDEN_USERS = /^(root|admin|administrator|mysql|dba|superuser)$/i;

class E2eSafetyError extends Error {
  constructor(message, code = 'E2E_SAFETY_STOP') {
    super(message);
    this.name = 'E2eSafetyError';
    this.code = code;
  }
}

function required(environment, names) {
  const missing = names.filter((name) => typeof environment[name] !== 'string' || !environment[name].trim());
  if (missing.length) throw new E2eSafetyError(`Thiếu biến môi trường E2E bắt buộc: ${missing.join(', ')}`, 'E2E_ENV_MISSING');
}

function safeUrl(raw, variableName) {
  try {
    return new URL(raw);
  } catch {
    throw new E2eSafetyError(`${variableName} không phải URL hợp lệ`, 'E2E_URL_INVALID');
  }
}

function validateTargetFields({ url, database, user, host, port, confirmation, role }) {
  if (url.protocol !== 'mysql:') throw new E2eSafetyError('E2E chỉ cho phép giao thức mysql', 'E2E_PROTOCOL_MISMATCH');
  if (FORBIDDEN_DATABASES.has(database)) throw new E2eSafetyError('Từ chối database development, QA-01 hoặc database hệ thống', 'E2E_DATABASE_FORBIDDEN');
  if (FORBIDDEN_USERS.test(user)) throw new E2eSafetyError('Từ chối tài khoản MySQL đặc quyền', 'E2E_USER_FORBIDDEN');
  if (database !== EXPECTED.database) throw new E2eSafetyError('Tên disposable database không nằm trong allowlist', 'E2E_DATABASE_MISMATCH');
  const expectedUser = role === 'migrator' ? EXPECTED.migratorUser : EXPECTED.runnerUser;
  if (user !== expectedUser) throw new E2eSafetyError('Disposable database user không nằm trong allowlist', 'E2E_USER_MISMATCH');
  if (host !== EXPECTED.host) throw new E2eSafetyError('Disposable database host không nằm trong allowlist', 'E2E_HOST_MISMATCH');
  if (port !== EXPECTED.port) throw new E2eSafetyError('Disposable database port không nằm trong allowlist', 'E2E_PORT_MISMATCH');
  if (confirmation !== EXPECTED.database) throw new E2eSafetyError('Xác nhận destructive target không hợp lệ', 'E2E_CONFIRMATION_MISMATCH');

  const urlDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const urlUser = decodeURIComponent(url.username);
  const urlPort = Number(url.port || 3306);
  if (url.hostname !== host || urlPort !== port || urlDatabase !== database || urlUser !== user) {
    throw new E2eSafetyError('E2E URL không khớp exact target fields', 'E2E_URL_TARGET_MISMATCH');
  }
  if (!url.password) throw new E2eSafetyError('E2E database URL phải chứa credential riêng', 'E2E_DATABASE_PASSWORD_MISSING');
}

function validateE2eEnvironment(environment = process.env, options = {}) {
  const role = options.role || 'runner';
  const urlName = role === 'migrator' ? 'E2E_MIGRATION_DATABASE_URL' : 'E2E_DATABASE_URL';
  const userName = role === 'migrator' ? 'E2E_MIGRATION_DATABASE_USER' : 'E2E_DATABASE_USER';
  const names = role === 'migrator'
    ? ['E2E_MIGRATION_DATABASE_URL', 'E2E_MIGRATION_DATABASE_USER', 'E2E_DATABASE_NAME', 'E2E_DATABASE_HOST', 'E2E_DATABASE_PORT', 'E2E_DESTRUCTIVE_CONFIRM']
    : REQUIRED_RUNNER_ENV;
  required(environment, names);

  const url = safeUrl(environment[urlName], urlName);
  const target = {
    url,
    role,
    database: environment.E2E_DATABASE_NAME.trim(),
    user: environment[userName].trim(),
    host: environment.E2E_DATABASE_HOST.trim(),
    port: Number(environment.E2E_DATABASE_PORT),
    confirmation: environment.E2E_DESTRUCTIVE_CONFIRM.trim(),
  };
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new E2eSafetyError('E2E_DATABASE_PORT không hợp lệ', 'E2E_PORT_INVALID');
  }
  validateTargetFields(target);
  return Object.freeze({
    role,
    database: target.database,
    user: target.user,
    host: target.host,
    port: target.port,
    datasourceUrl: url.toString(),
  });
}

function assertRuntimeIdentity(target, identity) {
  const currentUser = String(identity?.currentUser || '');
  const runtimeUser = currentUser.split('@')[0];
  if (identity?.databaseName !== target.database) throw new E2eSafetyError('Runtime DATABASE() không khớp disposable target', 'E2E_RUNTIME_DATABASE_MISMATCH');
  if (runtimeUser !== target.user) throw new E2eSafetyError('Runtime CURRENT_USER() không khớp disposable user', 'E2E_RUNTIME_USER_MISMATCH');
  if (Number(identity?.serverPort) !== target.port) throw new E2eSafetyError('Runtime @@port không khớp disposable port', 'E2E_RUNTIME_PORT_MISMATCH');
  return { database: identity.databaseName, currentUser, port: Number(identity.serverPort) };
}

function migrationInventory(migrationsDirectory = path.resolve(__dirname, '../prisma/migrations')) {
  const entries = fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const migrations = entries.map((entry) => {
    const file = path.join(migrationsDirectory, entry.name, 'migration.sql');
    if (!fs.existsSync(file)) throw new E2eSafetyError(`Migration thiếu migration.sql: ${entry.name}`, 'E2E_MIGRATION_FILE_MISSING');
    return {
      name: entry.name,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    };
  });
  if (migrations.length !== EXPECTED.migrationCount) {
    throw new E2eSafetyError(`Expected ${EXPECTED.migrationCount} migrations, found ${migrations.length}`, 'E2E_MIGRATION_COUNT_MISMATCH');
  }
  return migrations;
}

function assertCanonicalMigrationHistory(localMigrations, history) {
  if (localMigrations.length !== EXPECTED.migrationCount || history.length !== EXPECTED.migrationCount) {
    throw new E2eSafetyError('Migration history không đủ 22/22', 'E2E_MIGRATION_HISTORY_INCOMPLETE');
  }
  const rowsByName = new Map();
  for (const row of history) {
    const rows = rowsByName.get(row.migrationName) || [];
    rows.push(row);
    rowsByName.set(row.migrationName, rows);
  }
  for (const migration of localMigrations) {
    const rows = rowsByName.get(migration.name) || [];
    if (rows.length !== 1) throw new E2eSafetyError(`Migration thiếu hoặc trùng: ${migration.name}`, 'E2E_MIGRATION_HISTORY_INVALID');
    const [row] = rows;
    if (row.checksum !== migration.checksum) throw new E2eSafetyError(`Checksum sai: ${migration.name}`, 'E2E_MIGRATION_CHECKSUM_MISMATCH');
    if (!row.finishedAt || row.rolledBackAt) throw new E2eSafetyError(`Migration chưa hoàn tất hoặc đã rollback: ${migration.name}`, 'E2E_MIGRATION_NOT_SUCCESSFUL');
  }
  const localNames = new Set(localMigrations.map(({ name }) => name));
  if ([...rowsByName.keys()].some((name) => !localNames.has(name))) {
    throw new E2eSafetyError('Migration history chứa migration ngoài allowlist', 'E2E_MIGRATION_UNEXPECTED');
  }
  return true;
}

async function queryRuntimeIdentity(client) {
  const [identity] = await client.$queryRawUnsafe(
    'SELECT DATABASE() databaseName, CURRENT_USER() currentUser, @@port serverPort',
  );
  return identity;
}

async function assertIdentityOnly(client, environment = process.env, options = {}) {
  const target = validateE2eEnvironment(environment, options);
  const identity = await queryRuntimeIdentity(client);
  assertRuntimeIdentity(target, identity);
  return target;
}

async function assertCanonical(client, environment = process.env, options = {}) {
  const target = await assertIdentityOnly(client, environment, options);
  const migrations = migrationInventory(options.migrationsDirectory);
  const history = await client.$queryRawUnsafe(
    'SELECT migration_name migrationName, checksum, finished_at finishedAt, rolled_back_at rolledBackAt FROM _prisma_migrations ORDER BY started_at',
  );
  assertCanonicalMigrationHistory(migrations, history);
  return { ...target, migrationCount: migrations.length };
}

async function createGuardedClient(environment = process.env, options = {}) {
  const target = validateE2eEnvironment(environment, options);
  const clientFactory = options.clientFactory || ((datasourceUrl) => {
    // Lazy import is intentional: URL validation must happen before Prisma construction.
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasourceUrl });
  });
  const client = clientFactory(target.datasourceUrl);
  try {
    if (options.mode === 'canonical') await assertCanonical(client, environment, options);
    else await assertIdentityOnly(client, environment, options);
    return { client, target };
  } catch (error) {
    await client.$disconnect?.().catch(() => {});
    throw error;
  }
}

module.exports = {
  EXPECTED,
  E2eSafetyError,
  validateE2eEnvironment,
  assertRuntimeIdentity,
  assertCanonicalMigrationHistory,
  migrationInventory,
  queryRuntimeIdentity,
  assertIdentityOnly,
  assertCanonical,
  createGuardedClient,
};
