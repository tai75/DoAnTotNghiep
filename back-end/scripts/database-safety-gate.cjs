require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const MYSQL_BIN = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin';
const PRISMA = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const sourceUrl = new URL(process.env.DATABASE_URL);
const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
const cloneDatabase = `job_connect_safety_clone_${stamp.slice(0, 15).toLowerCase()}`;
const backupDirectory = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'JobConnect', 'backups');
const backupPath = path.join(backupDirectory, `job_connect_dev_${stamp}.sql`);
const migrationsDirectory = path.join(process.cwd(), 'prisma', 'migrations');

function cloneUrl() {
  const value = new URL(sourceUrl);
  value.pathname = `/${cloneDatabase}`;
  return value.toString();
}

function mysqlArgs() {
  return [
    `--host=${sourceUrl.hostname}`,
    `--port=${sourceUrl.port || '3306'}`,
    `--user=${decodeURIComponent(sourceUrl.username)}`,
    '--protocol=TCP',
  ];
}

function childEnv(extra = {}) {
  return {
    ...process.env,
    MYSQL_PWD: decodeURIComponent(sourceUrl.password),
    ...extra,
  };
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} exited with ${result.status}`);
  return result;
}

function safeJson(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

function migrationFiles() {
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      file: path.join(migrationsDirectory, entry.name, 'migration.sql'),
    }))
    .filter((entry) => fs.existsSync(entry.file))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      ...entry,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(entry.file)).digest('hex'),
    }));
}

async function tableCounts(client) {
  const tables = await client.$queryRawUnsafe(`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name
  `);
  const counts = {};
  for (const { tableName } of tables) {
    const escaped = tableName.replaceAll('`', '``');
    const [row] = await client.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM \`${escaped}\``);
    counts[tableName] = Number(row.count);
  }
  return counts;
}

async function foreignKeyIntegrity(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT constraint_name AS constraintName,
           table_name AS childTable,
           column_name AS childColumn,
           referenced_table_name AS parentTable,
           referenced_column_name AS parentColumn,
           ordinal_position AS ordinalPosition
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND referenced_table_name IS NOT NULL
    ORDER BY table_name, constraint_name, ordinal_position
  `);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.childTable}:${row.constraintName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const failures = [];
  for (const columns of groups.values()) {
    const first = columns[0];
    const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;
    const join = columns.map((column) => `c.${quote(column.childColumn)} = p.${quote(column.parentColumn)}`).join(' AND ');
    const hasValue = columns.map((column) => `c.${quote(column.childColumn)} IS NOT NULL`).join(' AND ');
    const missingParent = columns.map((column) => `p.${quote(column.parentColumn)} IS NULL`).join(' AND ');
    const [result] = await client.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM ${quote(first.childTable)} c LEFT JOIN ${quote(first.parentTable)} p ON ${join} WHERE ${hasValue} AND ${missingParent}`,
    );
    const count = Number(result.count);
    if (count) failures.push({ constraint: first.constraintName, childTable: first.childTable, parentTable: first.parentTable, count });
  }
  return { foreignKeysChecked: groups.size, orphanRows: failures.reduce((sum, item) => sum + item.count, 0), failures };
}

async function dataMigrationInvariants(client) {
  const [matchScores] = await client.$queryRawUnsafe(`
    SELECT COUNT(*) AS total,
           SUM(ms.candidate_id <> a.candidate_id) AS candidateMismatch,
           SUM(ms.skill_score IS NULL OR ms.experience_score IS NULL
               OR ms.position_score IS NULL OR ms.location_score IS NULL
               OR ms.salary_score IS NULL OR ms.employment_score IS NULL
               OR ms.computed_at IS NULL OR ms.algorithm_version IS NULL) AS incompleteRows
    FROM match_scores ms
    LEFT JOIN applications a ON a.id = ms.application_id
  `);
  const invalidEmploymentTypes = await client.$queryRawUnsafe(`
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE employment_type IS NOT NULL
      AND employment_type NOT IN ('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID')
  `);
  const duplicateScores = await client.$queryRawUnsafe(`
    SELECT candidate_id, job_id, COUNT(*) AS count
    FROM match_scores
    GROUP BY candidate_id, job_id
    HAVING COUNT(*) > 1
  `);
  return {
    matchScores,
    invalidEmploymentTypes: Number(invalidEmploymentTypes[0].count),
    duplicateMatchScoreKeys: duplicateScores.length,
  };
}

async function main() {
  const files = migrationFiles();
  if (files.length !== 16) throw new Error(`Expected 16 migrations, found ${files.length}`);
  fs.mkdirSync(backupDirectory, { recursive: true });
  if (fs.existsSync(backupPath)) throw new Error('Refusing to overwrite an existing backup');

  const admin = new PrismaClient();
  let cloneCreated = false;
  try {
    const [history] = await admin.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'
    `);
    if (Number(history.count) !== 0) throw new Error('Source migration history changed; re-audit before cloning');

    run(path.join(MYSQL_BIN, 'mysqldump.exe'), [
      ...mysqlArgs(),
      '--single-transaction',
      '--routines',
      '--triggers',
      '--events',
      '--hex-blob',
      '--set-gtid-purged=OFF',
      `--result-file=${backupPath}`,
      sourceUrl.pathname.slice(1),
    ], { env: childEnv() });

    const backup = fs.readFileSync(backupPath);
    const backupSha256 = crypto.createHash('sha256').update(backup).digest('hex');

    await admin.$executeRawUnsafe(
      `CREATE DATABASE \`${cloneDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    cloneCreated = true;
    const dumpInput = fs.openSync(backupPath, 'r');
    try {
      run(path.join(MYSQL_BIN, 'mysql.exe'), [...mysqlArgs(), `--database=${cloneDatabase}`], {
        env: childEnv(),
        stdio: [dumpInput, 'pipe', 'pipe'],
      });
    } finally {
      fs.closeSync(dumpInput);
    }

    const source = new PrismaClient({ datasourceUrl: sourceUrl.toString() });
    const clone = new PrismaClient({ datasourceUrl: cloneUrl() });
    try {
      const sourceCounts = await tableCounts(source);
      const cloneCountsBefore = await tableCounts(clone);
      if (safeJson(sourceCounts) !== safeJson(cloneCountsBefore)) throw new Error('Clone row counts do not match source backup point');

      const beforeInvariants = await dataMigrationInvariants(clone);
      const beforeForeignKeys = await foreignKeyIntegrity(clone);
      if (beforeForeignKeys.orphanRows !== 0) throw new Error('Clone contains foreign-key orphan rows');
      if (beforeInvariants.invalidEmploymentTypes || beforeInvariants.duplicateMatchScoreKeys
        || Number(beforeInvariants.matchScores.candidateMismatch) || Number(beforeInvariants.matchScores.incompleteRows)) {
        throw new Error('Clone does not satisfy migration data postconditions');
      }

      const prismaEnv = childEnv({ DATABASE_URL: cloneUrl() });
      for (const migration of files) {
        console.log(`=== resolve applied on clone: ${migration.name} ===`);
        run(process.execPath, [PRISMA, 'migrate', 'resolve', '--applied', migration.name], { env: prismaEnv });
      }

      run(process.execPath, [PRISMA, 'migrate', 'status'], { env: prismaEnv });
      run(process.execPath, [PRISMA, 'migrate', 'diff',
        '--from-schema-datasource', 'prisma/schema.prisma',
        '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], { env: prismaEnv });

      const historyRows = await clone.$queryRawUnsafe(`
        SELECT migration_name AS migrationName, checksum, finished_at AS finishedAt,
               rolled_back_at AS rolledBackAt, applied_steps_count AS appliedStepsCount
        FROM _prisma_migrations
        ORDER BY started_at
      `);
      const historyByName = new Map(historyRows.map((row) => [row.migrationName, row]));
      const checksumMismatches = files.filter((migration) => historyByName.get(migration.name)?.checksum !== migration.checksum)
        .map((migration) => migration.name);
      const unsuccessful = historyRows.filter((row) => !row.finishedAt || row.rolledBackAt);
      const cloneCountsAfter = await tableCounts(clone);
      const afterForeignKeys = await foreignKeyIntegrity(clone);
      const afterInvariants = await dataMigrationInvariants(clone);

      if (safeJson(cloneCountsBefore) !== safeJson(cloneCountsAfter)) throw new Error('Resolve changed business row counts');
      if (historyRows.length !== 16 || checksumMismatches.length || unsuccessful.length) throw new Error('Clone migration history verification failed');
      if (afterForeignKeys.orphanRows !== 0) throw new Error('Foreign-key integrity failed after resolve');

      console.log(safeJson({
        status: 'PASS',
        sourceDatabase: sourceUrl.pathname.slice(1),
        cloneDatabase,
        backup: {
          path: backupPath,
          bytes: backup.length,
          sha256: backupSha256,
        },
        migrations: {
          count: files.length,
          orderedNames: files.map((migration) => migration.name),
          historyRows: historyRows.length,
          checksumMismatches,
          unsuccessful: unsuccessful.length,
        },
        integrity: {
          businessTables: Object.keys(cloneCountsAfter).length,
          businessRows: Object.values(cloneCountsAfter).reduce((sum, count) => sum + count, 0),
          rowCountsUnchangedByResolve: safeJson(cloneCountsBefore) === safeJson(cloneCountsAfter),
          foreignKeys: afterForeignKeys,
          dataMigrationInvariants: afterInvariants,
        },
      }));
    } finally {
      await source.$disconnect();
      await clone.$disconnect();
    }
  } catch (error) {
    console.error(safeJson({
      status: 'FAIL',
      message: error.message,
      cloneDatabase: cloneCreated ? cloneDatabase : null,
      backupPath: fs.existsSync(backupPath) ? backupPath : null,
    }));
    process.exitCode = 1;
  } finally {
    await admin.$disconnect();
  }
}

main();
