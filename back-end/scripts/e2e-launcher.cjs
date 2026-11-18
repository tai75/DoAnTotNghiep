const path = require('node:path');
const { spawn } = require('node:child_process');
const { createGuardedClient, validateE2eEnvironment, EXPECTED } = require('./e2e-guard.cjs');
const { validateExistingStorage } = require('./e2e-storage.cjs');
const { assertLiveOwnership } = require('./e2e-process-guard.cjs');

const E2E_AUTH_RATE_LIMIT_MODE = 'guarded-disposable';
const MIN_E2E_AUTH_RATE_LIMIT_MAX = 11;
const MAX_E2E_AUTH_RATE_LIMIT_MAX = 200;
const MIN_E2E_API_RATE_LIMIT_MAX = 301;
const MAX_E2E_API_RATE_LIMIT_MAX = 1200;

const SENSITIVE_DATABASE_ENV = [
  'DATABASE_URL',
  'E2E_DATABASE_URL',
  'E2E_MIGRATION_DATABASE_URL',
  'E2E_MIGRATION_DATABASE_USER',
  'E2E_MIGRATION_APPROVED',
  'E2E_PROVISIONING_DATABASE_URL',
  'E2E_PROVISIONING_DATABASE_USER',
  'MYSQL_PWD',
  'E2E_JWT_SECRET',
  'E2E_PASSWORD',
  'E2E_AUTH_RATE_LIMIT_MODE',
  'E2E_AUTH_RATE_LIMIT_MAX',
  'E2E_API_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_MAX',
  'API_RATE_LIMIT_MAX',
  'BIND_HOST',
  'PORT',
];

function withoutDatabaseCredentials(environment) {
  const sanitized = { ...environment };
  for (const name of SENSITIVE_DATABASE_ENV) delete sanitized[name];
  return sanitized;
}

function loopbackUrl(environment, name, expectedPort) {
  let url;
  try {
    url = new URL(environment[name]);
  } catch {
    throw new Error(`${name} phải là URL loopback hợp lệ`);
  }
  if (url.protocol !== 'http:' || url.hostname !== EXPECTED.host || Number(url.port) !== expectedPort
    || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${name} phải khớp chính xác http://${EXPECTED.host}:${expectedPort}`);
  }
  return url;
}

function validateAuthRateLimitOverride(environment, target, layout) {
  if (environment.E2E_AUTH_RATE_LIMIT_MODE !== E2E_AUTH_RATE_LIMIT_MODE) {
    throw new Error('Thiếu xác nhận auth rate-limit dành riêng cho guarded disposable E2E');
  }
  const rawLimit = environment.E2E_AUTH_RATE_LIMIT_MAX;
  if (!/^\d+$/.test(String(rawLimit || ''))) throw new Error('E2E_AUTH_RATE_LIMIT_MAX phải là số nguyên hữu hạn');
  const limit = Number(rawLimit);
  if (limit < MIN_E2E_AUTH_RATE_LIMIT_MAX || limit > MAX_E2E_AUTH_RATE_LIMIT_MAX) {
    throw new Error(`E2E_AUTH_RATE_LIMIT_MAX phải nằm trong ${MIN_E2E_AUTH_RATE_LIMIT_MAX}-${MAX_E2E_AUTH_RATE_LIMIT_MAX}`);
  }
  if (target.database !== EXPECTED.database || target.user !== EXPECTED.runnerUser
    || target.host !== EXPECTED.host || target.port !== EXPECTED.port
    || environment.E2E_DESTRUCTIVE_CONFIRM !== EXPECTED.database) {
    throw new Error('Auth rate-limit override từ chối target không khớp exact disposable allowlist');
  }
  if (!layout?.storageRoot || !layout?.legacyUploadsRoot || !layout?.legacyLogosRoot) {
    throw new Error('Auth rate-limit override yêu cầu disposable storage đã được xác minh');
  }
  const apiUrl = loopbackUrl(environment, 'E2E_API_BASE_URL', 5102);
  const frontendUrl = loopbackUrl(environment, 'E2E_FRONTEND_BASE_URL', 5178);
  return Object.freeze({ limit, apiUrl, frontendUrl });
}

function validateApiRateLimitOverride(environment, target, layout) {
  const guarded = validateAuthRateLimitOverride(environment, target, layout);
  const rawLimit = environment.E2E_API_RATE_LIMIT_MAX;
  if (!/^\d+$/.test(String(rawLimit || ''))) throw new Error('E2E_API_RATE_LIMIT_MAX phải là số nguyên hữu hạn');
  const limit = Number(rawLimit);
  if (limit < MIN_E2E_API_RATE_LIMIT_MAX || limit > MAX_E2E_API_RATE_LIMIT_MAX) {
    throw new Error(`E2E_API_RATE_LIMIT_MAX phải nằm trong ${MIN_E2E_API_RATE_LIMIT_MAX}-${MAX_E2E_API_RATE_LIMIT_MAX}`);
  }
  return Object.freeze({ ...guarded, apiLimit: limit });
}

function isolatedChildEnvironment(environment, target, layout, rateLimitOverride = validateApiRateLimitOverride(environment, target, layout)) {
  if (!environment.E2E_JWT_SECRET || environment.E2E_JWT_SECRET.length < 32) throw new Error('E2E_JWT_SECRET phải có ít nhất 32 ký tự');
  if (!environment.E2E_PASSWORD || environment.E2E_PASSWORD.length < 12) throw new Error('E2E_PASSWORD phải có ít nhất 12 ký tự');
  return {
    ...withoutDatabaseCredentials(environment),
    DATABASE_URL: target.datasourceUrl,
    JWT_SECRET: environment.E2E_JWT_SECRET,
    NODE_ENV: 'e2e-disposable',
    AUTH_RATE_LIMIT_MAX: String(rateLimitOverride.limit),
    API_RATE_LIMIT_MAX: String(rateLimitOverride.apiLimit),
    BIND_HOST: EXPECTED.host,
    PORT: rateLimitOverride.apiUrl.port,
    API_PUBLIC_URL: rateLimitOverride.apiUrl.origin,
    FRONTEND_URL: rateLimitOverride.frontendUrl.origin,
    CORS_ORIGINS: rateLimitOverride.frontendUrl.origin,
    STORAGE_ROOT: layout.storageRoot,
    UPLOADS_DIRECTORY: layout.legacyUploadsRoot,
    LOGOS_DIRECTORY: layout.legacyLogosRoot,
    ALERT_WORKER_ENABLED: 'false',
    MATCHING_V2_ENABLED: 'false',
    MATCHING_V3_ENABLED: 'false',
    GEMINI_API_KEY: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  };
}

function spawnInherited(executable, args, options) {
  const child = spawn(executable, args, { ...options, shell: false, stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exitCode = signal ? 1 : code);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return child;
}

async function launchServer(environment = process.env, options = {}) {
  const ownershipGuard = options.assertLiveOwnershipImpl || assertLiveOwnership;
  const storageGuard = options.validateExistingStorageImpl || validateExistingStorage;
  const guardedClientFactory = options.createGuardedClientImpl || createGuardedClient;
  const spawnImpl = options.spawnImpl || spawnInherited;
  await ownershipGuard(environment, options);
  const target = validateE2eEnvironment(environment);
  const layout = await storageGuard(environment, options.storageOptions);
  const guarded = await guardedClientFactory(environment, { mode: 'canonical', clientFactory: options.clientFactory });
  await guarded.client.$disconnect();
  const rateLimitOverride = validateApiRateLimitOverride(environment, target, layout);
  const childEnv = isolatedChildEnvironment(environment, target, layout, rateLimitOverride);
  return spawnImpl(process.execPath, [path.resolve(__dirname, '../src/server.js')], { cwd: path.resolve(__dirname, '..'), env: childEnv });
}

async function launchMigration(environment = process.env, options = {}) {
  if (environment.E2E_MIGRATION_APPROVED !== EXPECTED.database) throw new Error('Thiếu xác nhận migration riêng cho disposable database');
  await assertLiveOwnership(environment, options);
  const target = validateE2eEnvironment(environment, { role: 'migrator' });
  const guarded = await createGuardedClient(environment, { role: 'migrator', mode: 'identity-only', clientFactory: options.clientFactory });
  await guarded.client.$disconnect();
  const prismaCli = path.resolve(__dirname, '../node_modules/prisma/build/index.js');
  return spawnInherited(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...withoutDatabaseCredentials(environment),
      DATABASE_URL: target.datasourceUrl,
      NODE_ENV: 'e2e-disposable',
      GEMINI_API_KEY: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    },
  });
}

async function main() {
  const command = process.argv[2];
  if (command === 'server') return launchServer();
  if (command === 'migrate') return launchMigration();
  throw new Error('Usage: e2e-launcher.cjs server|migrate');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  E2E_AUTH_RATE_LIMIT_MODE,
  MAX_E2E_API_RATE_LIMIT_MAX,
  MAX_E2E_AUTH_RATE_LIMIT_MAX,
  isolatedChildEnvironment,
  launchMigration,
  launchServer,
  validateApiRateLimitOverride,
  validateAuthRateLimitOverride,
  withoutDatabaseCredentials,
};
