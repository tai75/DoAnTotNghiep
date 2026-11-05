const { PrismaClient } = require('@prisma/client');
const { assertQaDatabase, qaUrl } = require('./qa01-db.cjs');

async function main() {
  const url = qaUrl();
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'qa-e2e';
  process.env.ALERT_WORKER_ENABLED = 'false';
  process.env.MATCHING_V2_ENABLED = 'false';
  process.env.MATCHING_V3_ENABLED = 'false';
  delete process.env.GEMINI_API_KEY;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;

  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    const identity = await assertQaDatabase(prisma);
    console.log(`[QA-01] isolated database verified: ${identity.host}:${identity.port}/${identity.database}`);
  } finally {
    await prisma.$disconnect();
  }
  require('../src/server');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
