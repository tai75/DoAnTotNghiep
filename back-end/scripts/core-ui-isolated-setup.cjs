// Dedicated Core UI fixture runner. Never targets the development or legacy disposable instance.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { seedDisposableFixtures } = require('./e2e-fixtures.cjs');

const BASE = path.resolve(os.homedir(), 'AppData/Local/JobConnectIsolated');
const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin';
const BACKEND = path.resolve(__dirname, '..');
const FRONTEND = path.resolve(BACKEND, '../front-end-web');
const DB = 'job_connect_core_ui_isolated';
const PORT = 3407;
const MIGRATIONS = path.join(BACKEND, 'prisma/migrations');
const migrationFiles = () => fs.readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => ({
    name: entry.name,
    checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(MIGRATIONS, entry.name, 'migration.sql'))).digest('hex'),
  })).sort((a, b) => a.name.localeCompare(b.name));
const insist = (condition, message) => { if (!condition) throw Error(message); };
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, ...options });
const serial = (value) => String(value).replaceAll('\\', '/');
const secret = () => crypto.randomBytes(32).toString('hex');
const safeUrl = (user, password) => `mysql://${user}:${password}@127.0.0.1:${PORT}/${DB}`;

function listeners() {
  return run('netstat.exe', ['-ano', '-p', 'tcp']).split(/\r?\n/)
    .filter((line) => /\bLISTENING\b/i.test(line) && /:(3407|5103|5179)\s/i.test(line))
    .map((line) => line.trim()).join('\n');
}
function listenerPid(port) {
  const line = listeners().split(/\r?\n/).find((entry) => new RegExp(`:${port}\\s`).test(entry));
  return line ? Number(line.trim().split(/\s+/).at(-1)) : 0;
}
function launchMysql(config) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const script = `$p=Start-Process -FilePath ${quote(path.join(MYSQL, 'mysqld.exe'))} -ArgumentList ${quote(`--defaults-file=${config}`)} -WindowStyle Hidden -PassThru;[Console]::Write($p.Id)`;
  const pid = Number(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).trim());
  insist(Number.isInteger(pid) && pid > 0, 'MySQL launcher PID missing');
  return pid;
}
async function migrationMonitored(prismaCli, environment, serverPid, datadir) {
  const current = () => listenerPid(PORT) === serverPid;
  insist(current(), 'MySQL listener changed before migration');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema=prisma/schema.prisma'],
      { cwd: BACKEND, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += String(chunk).slice(0, 2048); });
    let changed = false;
    const monitor = setInterval(() => { if (!current()) { changed = true; child.kill(); } }, 500);
    child.on('error', (error) => { clearInterval(monitor); reject(error); });
    child.on('close', (code) => {
      clearInterval(monitor);
      if (changed || !current()) reject(Error('MySQL listener changed during migration'));
      else if (code !== 0) reject(Error(`Prisma migrate deploy failed (${code}): ${output.slice(-900)}`));
      else resolve();
    });
  });
  const [port, actualDir] = mysql(['-e', 'SELECT @@port, @@datadir;'], process.env.CORE_UI_ROOT_PASSWORD).trim().split('\t');
  insist(Number(port) === PORT && path.resolve(actualDir).toLowerCase() === path.resolve(datadir).toLowerCase(), 'MySQL identity changed after migration');
}
function protect(directory) {
  run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`, '/grant:r', 'SYSTEM:(OI)(CI)F']);
}
function mysql(args, password = '') {
  return run(path.join(MYSQL, 'mysql.exe'), ['--no-defaults', '--protocol=TCP', '--host=127.0.0.1', `--port=${PORT}`, '--user=root', '--batch', '--skip-column-names', ...args],
    { env: { ...process.env, MYSQL_PWD: password }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function checkRepo() {
  const branch = run('git.exe', ['branch', '--show-current'], { cwd: path.resolve(BACKEND, '..') }).trim();
  const head = run('git.exe', ['rev-parse', 'HEAD'], { cwd: path.resolve(BACKEND, '..') }).trim();
  const status = run('git.exe', ['status', '--porcelain=v1'], { cwd: path.resolve(BACKEND, '..') }).trim().split(/\r?\n/).filter(Boolean);
  insist(branch === 'dev2' && head === '19868fee522a390e8cf27258c9a2dc612cea1353', 'Git identity mismatch');
  insist(status.length >= 105, 'Existing dirty worktree baseline missing');
}
function checkMigrations() {
  const files = migrationFiles();
  insist(files.length === 23 && files[22].name === '20261114160000_add_auth_sessions', 'Expected 23 migrations');
  insist(files[22].checksum === '85955dc27479a1e5a0e94f53d43b513f02b8086db8f28315ea92fb8f407b59b3', 'Migration 23 checksum mismatch');
  return files;
}
async function waitUntil(probe, label) {
  for (let n = 0; n < 90; n++) {
    try { const result = await probe(); if (result) return result; } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error(`${label} did not become ready`);
}
function daemon(file, args, cwd, environment, stdout, stderr) {
  const out = fs.openSync(stdout, 'a');
  const err = fs.openSync(stderr, 'a');
  const child = spawn(file, args, { cwd, env: environment, detached: true, windowsHide: true, shell: false, stdio: ['ignore', out, err] });
  fs.closeSync(out); fs.closeSync(err); child.unref();
  return child.pid;
}
function writePrivate(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 }); }

async function main() {
  insist(process.platform === 'win32', 'Windows-only isolated runner');
  insist(fs.existsSync(path.join(MYSQL, 'mysqld.exe')) && fs.existsSync(path.join(MYSQL, 'mysql.exe')), 'MySQL 8 binaries missing');
  checkRepo(); const files = checkMigrations();
  insist(!listeners(), 'Isolated port occupied');
  insist(fs.existsSync('C:/ProgramData/MySQL/MySQL Server 8.0/Data'), 'Development MySQL identity cannot be checked');
  const runId = crypto.randomBytes(8).toString('hex');
  const root = path.join(BASE, `core-ui-${runId}`);
  insist(root.toLowerCase() !== path.resolve(os.tmpdir(), 'job-connect-e2e-mysql-qa03b2a').toLowerCase(), 'Legacy root forbidden');
  insist(!fs.existsSync(root), 'Run root exists');
  fs.mkdirSync(root, { recursive: true }); protect(root);
  for (const part of ['data', 'logs', 'runtime', 'storage', 'storage/resumes', 'storage/logos', 'storage/tmp']) fs.mkdirSync(path.join(root, part), { recursive: true });
  const datadir = path.join(root, 'data');
  insist(fs.readdirSync(datadir).length === 0, 'Datadir not empty');
  const config = path.join(root, 'my-isolated.ini');
  fs.writeFileSync(config, `[mysqld]\nbasedir=${serial(path.dirname(MYSQL))}\ndatadir=${serial(datadir)}\nport=${PORT}\nbind-address=127.0.0.1\nmysqlx=0\nlog_error=${serial(path.join(root, 'logs/mysql-error.log'))}\npid_file=${serial(path.join(root, 'runtime/mysqld.pid'))}\n`, { flag: 'wx' });
  const identity = { database: DB, host: '127.0.0.1', port: PORT, root, datadir, config, runId, createdAt: new Date().toISOString() };
  writePrivate(path.join(root, 'ownership.json'), { ...identity, phase: 'allocated' });
  const init = run(path.join(MYSQL, 'mysqld.exe'), [`--basedir=${MYSQL}`, `--datadir=${datadir}`, '--initialize-insecure'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  void init;
  const mysqlPid = launchMysql(config);
  await waitUntil(() => {
    const state = mysql(['-e', 'SELECT @@port, @@datadir, @@version;']);
    const [port, actualDir, version] = state.trim().split('\t');
    insist(Number(port) === PORT && path.resolve(actualDir).toLowerCase() === path.resolve(datadir).toLowerCase() && /^8\./.test(version), 'MySQL runtime identity mismatch');
    return true;
  }, 'MySQL');
  const mysqlServerPid = listenerPid(PORT);
  insist(mysqlServerPid > 0 && mysqlServerPid !== mysqlPid, 'MySQL launcher/server process chain missing');
  const rootPassword = secret(), runnerPassword = secret(), migratorPassword = secret(), testPassword = secret(), jwtSecret = secret();
  mysql(['-e', `ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}'; CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'core_ui_migrator'@'127.0.0.1' IDENTIFIED BY '${migratorPassword}'; CREATE USER 'core_ui_runner'@'127.0.0.1' IDENTIFIED BY '${runnerPassword}'; GRANT ALL PRIVILEGES ON \`${DB}\`.* TO 'core_ui_migrator'@'127.0.0.1'; GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB}\`.* TO 'core_ui_runner'@'127.0.0.1';`]);
  const credentials = { runnerUrl: safeUrl('core_ui_runner', runnerPassword), migratorUrl: safeUrl('core_ui_migrator', migratorPassword), password: testPassword, jwtSecret, rootPassword };
  writePrivate(path.join(root, 'credentials.json'), credentials);
  const backendEnv = { ...process.env, DATABASE_URL: credentials.runnerUrl, JWT_SECRET: jwtSecret, BIND_HOST: '127.0.0.1', PORT: '5103', API_PUBLIC_URL: 'http://127.0.0.1:5103', FRONTEND_URL: 'http://127.0.0.1:5179', CORS_ORIGINS: 'http://127.0.0.1:5179', STORAGE_ROOT: path.join(root, 'storage'), UPLOADS_DIRECTORY: path.join(root, 'storage/uploads'), LOGOS_DIRECTORY: path.join(root, 'storage/legacy-logos'), ALERT_WORKER_ENABLED: 'false', GEMINI_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', NODE_ENV: 'development' };
  const prismaCli = path.join(BACKEND, 'node_modules/prisma/build/index.js');
  process.env.CORE_UI_ROOT_PASSWORD = rootPassword;
  await migrationMonitored(prismaCli, { ...backendEnv, DATABASE_URL: credentials.migratorUrl }, mysqlServerPid, datadir);
  delete process.env.CORE_UI_ROOT_PASSWORD;
  const client = new PrismaClient({ datasources: { db: { url: credentials.migratorUrl } } });
  try {
    const history = await client.$queryRawUnsafe('SELECT migration_name name, checksum, finished_at finished, rolled_back_at rolled FROM _prisma_migrations ORDER BY migration_name');
    insist(history.length === 23 && files.every((file, i) => file.name === history[i].name && file.checksum === history[i].checksum && history[i].finished && !history[i].rolled), '23-migration history/checksum guard failed');
    const [runtime] = await client.$queryRawUnsafe('SELECT DATABASE() db, @@port port, @@datadir datadir, CURRENT_USER() user');
    insist(runtime.db === DB && Number(runtime.port) === PORT && path.resolve(runtime.datadir).toLowerCase() === path.resolve(datadir).toLowerCase(), 'Runtime database identity mismatch');
    writePrivate(path.join(root, 'attestation.json'), { runId, database: DB, host: '127.0.0.1', port: PORT, datadir, migrationCount: 23, migrations: files, verifiedAt: new Date().toISOString() });
    Object.assign(process.env, backendEnv);
    const storage = require('../src/storage/localStorage');
    await storage.initialize();
    const accounts = Object.fromEntries(['candidate', 'recruiter', 'admin'].map((role) => [role, `core-ui-${runId}-${role}@example.invalid`]));
    const fixture = await seedDisposableFixtures({ prisma: client, storage, password: testPassword, accounts });
    writePrivate(path.join(root, 'fixture.json'), { accounts, users: fixture.users, companyId: fixture.companyId, baseJobId: fixture.baseJobId });
  } finally { await client.$disconnect(); }
  insist(!listeners().split(/\r?\n/).filter(Boolean).some((line) => /:(5103|5179)\s/.test(line)), 'Application port collision before startup');
  const backendPid = daemon(process.execPath, [path.join(BACKEND, 'src/server.js')], BACKEND, backendEnv, path.join(root, 'logs/backend.stdout.log'), path.join(root, 'logs/backend.stderr.log'));
  await waitUntil(async () => (await fetch('http://127.0.0.1:5103/api/health/ready')).ok, 'backend');
  const viteEnv = { ...process.env, VITE_API_PROXY_TARGET: 'http://127.0.0.1:5103' };
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'MYSQL_PWD']) delete viteEnv[key];
  const frontendPid = daemon(process.execPath, [path.join(FRONTEND, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5179', '--strictPort'], FRONTEND, viteEnv, path.join(root, 'logs/frontend.stdout.log'), path.join(root, 'logs/frontend.stderr.log'));
  await waitUntil(async () => (await fetch('http://127.0.0.1:5179/')).ok, 'frontend');
  fs.writeFileSync(path.join(root, 'runtime/pids.json'), JSON.stringify({ mysqlPid, mysqlServerPid, backendPid, frontendPid }), { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ ...identity, mysqlPid, mysqlServerPid, backendPid, frontendPid, readyAt: new Date().toISOString() }), { flag: 'wx' });
  console.log(JSON.stringify({ status: 'READY', runId, root, datadir, database: DB, mysqlPid, mysqlServerPid, backendPid, frontendPid, migrations: files.length, fixture: '3 roles', backend: 5103, frontend: 5179 }));
}
main().catch((error) => { console.error('SETUP_STOPPED:', error.message); process.exitCode = 1; });
