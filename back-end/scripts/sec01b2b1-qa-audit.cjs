const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPECTED_DATABASE = 'job_connect_qa01_e2e';
const EXPECTED_USER = 'job_connect_qa01';

function qaUrl() {
  const raw = process.env.QA01_DATABASE_URL;
  if (!raw) throw new Error('QA01_DATABASE_URL is required.');
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
      || parsed.pathname.slice(1) !== EXPECTED_DATABASE
      || decodeURIComponent(parsed.username) !== EXPECTED_USER) {
    throw new Error('SEC-01B2B1 safety stop: expected the dedicated loopback QA-01 database.');
  }
  return raw;
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: qaUrl() } } });
  try {
    const [identity] = await prisma.$queryRawUnsafe(
      'SELECT DATABASE() databaseName, CURRENT_USER() currentUser'
    );
    if (identity.databaseName !== EXPECTED_DATABASE
        || !String(identity.currentUser).startsWith(`${EXPECTED_USER}@`)) {
      throw new Error('SEC-01B2B1 safety stop: connected database identity is not QA-01.');
    }

    const companies = await prisma.company.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        website: true,
        address: true,
        industry: true,
        description: true,
        verificationStatus: true,
        verificationSource: true,
        verifiedAt: true,
        _count: { select: { recruiters: true, jobs: true } }
      },
      orderBy: { id: 'asc' }
    });
    const candidateSearchability = await prisma.candidate.groupBy({
      by: ['isSearchable'],
      _count: { _all: true }
    });
    const [candidateDefault] = await prisma.$queryRawUnsafe(`
      SELECT column_default columnDefault
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'candidates' AND column_name = 'is_searchable'
    `);
    const migrationName = '20261110150000_add_company_verification_and_candidate_privacy';
    const migrationFile = path.resolve(__dirname, `../prisma/migrations/${migrationName}/migration.sql`);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationFile)).digest('hex');
    const history = await prisma.$queryRawUnsafe(`
      SELECT migration_name migrationName, checksum, finished_at finishedAt, rolled_back_at rolledBackAt
      FROM _prisma_migrations ORDER BY started_at
    `);
    const migration20 = history.find((item) => item.migrationName === migrationName);
    if (history.length !== 20 || !migration20 || migration20.checksum !== checksum || !migration20.finishedAt || migration20.rolledBackAt) {
      throw new Error('SEC-01B2B1 postcondition failed: migration 20 history/checksum is not canonical.');
    }
    if (!candidateDefault || !['0', 'false'].includes(String(candidateDefault.columnDefault).toLowerCase())) {
      throw new Error('SEC-01B2B1 postcondition failed: new candidate default is not private.');
    }

    console.log(JSON.stringify({
      status: 'PASS',
      identity: { database: identity.databaseName, currentUser: identity.currentUser },
      companyCount: companies.length,
      companies: companies.map((company) => ({
        id: company.id,
        name: company.name,
        status: company.status,
        hasWebsite: Boolean(company.website),
        hasAddress: Boolean(company.address),
        hasIndustry: Boolean(company.industry),
        hasDescription: Boolean(company.description),
        verificationStatus: company.verificationStatus,
        verificationSource: company.verificationSource,
        hasVerifiedAt: Boolean(company.verifiedAt),
        recruiters: company._count.recruiters,
        jobs: company._count.jobs
      })),
      candidateSearchability,
      candidateDefault: candidateDefault.columnDefault,
      migrationCount: history.length,
      migration20: { name: migration20.migrationName, checksumMatches: migration20.checksum === checksum }
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
