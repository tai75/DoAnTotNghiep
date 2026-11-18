require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const MYSQL_BIN = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin';
const PRISMA = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const migrationDb = `job_connect_audit_migrations_${suffix}`;
const restoreDb = `job_connect_audit_restore_${suffix}`;
const dumpPath = path.join(os.tmpdir(), `job_connect_audit_${suffix}.sql`);

const sourceUrl = new URL(process.env.DATABASE_URL);

function urlFor(database) {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} exited with ${result.status}`);
  }
  return result;
}

function mysqlArgs() {
  return [
    `--host=${sourceUrl.hostname}`,
    `--port=${sourceUrl.port || '3306'}`,
    `--user=${decodeURIComponent(sourceUrl.username)}`,
    '--protocol=TCP',
  ];
}

function safeJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
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
    const [row] = await client.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM \`${escaped}\``,
    );
    counts[tableName] = Number(row.count);
  }
  return counts;
}

async function main() {
  const admin = new PrismaClient();
  const childEnv = {
    ...process.env,
    MYSQL_PWD: decodeURIComponent(sourceUrl.password),
  };

  try {
    await admin.$executeRawUnsafe(
      `CREATE DATABASE \`${migrationDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await admin.$executeRawUnsafe(
      `CREATE DATABASE \`${restoreDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    console.log(`Created isolated test databases: ${migrationDb}, ${restoreDb}`);

    run(
      path.join(MYSQL_BIN, 'mysqldump.exe'),
      [
        ...mysqlArgs(),
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--hex-blob',
        '--set-gtid-purged=OFF',
        `--result-file=${dumpPath}`,
        sourceUrl.pathname.slice(1),
      ],
      { env: childEnv },
    );

    const dump = fs.readFileSync(dumpPath);
    const dumpHash = crypto.createHash('sha256').update(dump).digest('hex');
    console.log(
      safeJson({
        backup: 'created',
        bytes: dump.length,
        sha256: dumpHash,
      }),
    );

    const dumpInput = fs.openSync(dumpPath, 'r');
    try {
      run(
        path.join(MYSQL_BIN, 'mysql.exe'),
        [...mysqlArgs(), `--database=${restoreDb}`],
        { env: childEnv, stdio: [dumpInput, 'pipe', 'pipe'] },
      );
    } finally {
      fs.closeSync(dumpInput);
    }

    const source = new PrismaClient({ datasourceUrl: sourceUrl.toString() });
    const restored = new PrismaClient({ datasourceUrl: urlFor(restoreDb) });
    try {
      const sourceCounts = await tableCounts(source);
      const restoredCounts = await tableCounts(restored);
      const equal = safeJson(sourceCounts) === safeJson(restoredCounts);
      console.log(
        safeJson({
          restore: equal ? 'row-counts-match' : 'row-count-mismatch',
          tablesCompared: Object.keys(sourceCounts).length,
          totalSourceRows: Object.values(sourceCounts).reduce((a, b) => a + b, 0),
          totalRestoredRows: Object.values(restoredCounts).reduce((a, b) => a + b, 0),
          differences: Object.fromEntries(
            Object.keys({ ...sourceCounts, ...restoredCounts })
              .filter((key) => sourceCounts[key] !== restoredCounts[key])
              .map((key) => [key, [sourceCounts[key], restoredCounts[key]]]),
          ),
        }),
      );
      if (!equal) throw new Error('Restore row-count verification failed');
    } finally {
      await source.$disconnect();
      await restored.$disconnect();
    }

    const prismaEnv = {
      ...process.env,
      DATABASE_URL: urlFor(migrationDb),
    };

    console.log('=== First migrate deploy on blank MySQL ===');
    run(process.execPath, [PRISMA, 'migrate', 'deploy'], { env: prismaEnv });

    console.log('=== Migration status after first deploy ===');
    run(process.execPath, [PRISMA, 'migrate', 'status'], { env: prismaEnv });

    console.log('=== Schema diff: migrated DB -> schema.prisma ===');
    run(
      process.execPath,
      [
        PRISMA,
        'migrate',
        'diff',
        '--from-schema-datasource',
        'prisma/schema.prisma',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { env: prismaEnv },
    );

    console.log('=== Second migrate deploy (idempotency) ===');
    run(process.execPath, [PRISMA, 'migrate', 'deploy'], { env: prismaEnv });

    const migrated = new PrismaClient({ datasourceUrl: urlFor(migrationDb) });
    try {
      const [summary] = await migrated.$queryRawUnsafe(`
        SELECT COUNT(*) AS total,
               SUM(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS successful,
               SUM(finished_at IS NULL AND rolled_back_at IS NULL) AS failed
        FROM _prisma_migrations
      `);
      const [tableSummary] = await migrated.$queryRawUnsafe(`
        SELECT COUNT(*) AS tables
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_type = 'BASE TABLE'
      `);
      console.log(
        safeJson({
          migrationHistory: summary,
          baseTablesIncludingHistory: tableSummary.tables,
        }),
      );
    } finally {
      await migrated.$disconnect();
    }
  } finally {
    if (fs.existsSync(dumpPath)) fs.rmSync(dumpPath, { force: true });
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${migrationDb}\``);
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${restoreDb}\``);
      console.log('Removed audit-created test databases and temporary dump.');
    } finally {
      await admin.$disconnect();
    }
  }
}

main().catch((error) => {
  console.error(`AUDIT TEST FAILED: ${error.message}`);
  process.exitCode = 1;
});
