require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}

async function main() {
  const [version] = await prisma.$queryRawUnsafe('SELECT VERSION() AS version');
  const [database] = await prisma.$queryRawUnsafe('SELECT DATABASE() AS db');
  const [historyTable] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = '_prisma_migrations'
  `);
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name AS tableName, table_rows AS approximateRows
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    ORDER BY table_name
  `);

  let migrations = [];
  if (Number(historyTable.count) > 0) {
    migrations = await prisma.$queryRawUnsafe(`
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at,
             applied_steps_count, logs IS NOT NULL AS has_logs
      FROM _prisma_migrations
      ORDER BY started_at
    `);
  }

  const [matchScoreAudit] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) AS total,
      SUM(ms.candidate_id <> a.candidate_id) AS candidateMismatch,
      SUM(ms.skill_score IS NULL OR ms.experience_score IS NULL
          OR ms.position_score IS NULL OR ms.location_score IS NULL
          OR ms.salary_score IS NULL OR ms.employment_score IS NULL
          OR ms.computed_at IS NULL OR ms.algorithm_version IS NULL) AS incompleteRows,
      MIN(ms.score) AS minScore,
      MAX(ms.score) AS maxScore
    FROM match_scores ms
    LEFT JOIN applications a ON a.id = ms.application_id
  `);
  const employmentTypes = await prisma.$queryRawUnsafe(`
    SELECT employment_type AS employmentType, COUNT(*) AS count
    FROM jobs
    GROUP BY employment_type
    ORDER BY employment_type
  `);

  console.log(
    JSON.stringify(
      jsonSafe({
        serverVersion: version.version,
        database: database.db,
        migrationTableExists: Number(historyTable.count) > 0,
        migrations,
        dataMigrationChecks: {
          matchScores: matchScoreAudit,
          employmentTypes,
        },
        tables,
      }),
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
