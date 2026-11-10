const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const EXPECTED_DATABASE = 'job_connect_qa01_e2e';
const EXPECTED_USER = 'job_connect_qa01';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function qaUrl() {
  const raw = process.env.QA01_DATABASE_URL;
  if (!raw) throw new Error('QA01_DATABASE_URL is required; the development .env is never used by QA-01.');
  const parsed = new URL(raw);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (parsed.protocol !== 'mysql:' || !LOOPBACK_HOSTS.has(parsed.hostname) || database !== EXPECTED_DATABASE || decodeURIComponent(parsed.username) !== EXPECTED_USER) {
    throw new Error(`QA-01 safety stop: expected mysql loopback/${EXPECTED_DATABASE} with the dedicated QA user.`);
  }
  return parsed;
}

function migrationInventory() {
  const directory = path.resolve(__dirname, '../prisma/migrations');
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'migration.sql')))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      name: entry.name,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, entry.name, 'migration.sql'))).digest('hex'),
    }));
}

async function assertQaTarget(prisma) {
  const url = qaUrl();
  const [identity] = await prisma.$queryRawUnsafe('SELECT DATABASE() databaseName, @@hostname serverHostname, @@port serverPort, CURRENT_USER() currentUser');
  if (identity.databaseName !== EXPECTED_DATABASE) throw new Error(`QA-01 safety stop: connected to ${identity.databaseName}.`);
  if (!String(identity.currentUser).startsWith(`${EXPECTED_USER}@`)) throw new Error('QA-01 safety stop: connection is not using the dedicated QA user.');
  return { database: identity.databaseName, host: url.hostname, port: Number(url.port || 3306), serverHostname: identity.serverHostname, currentUser: identity.currentUser };
}

async function assertQaDatabase(prisma) {
  const identity = await assertQaTarget(prisma);
  const migrations = migrationInventory();
  if (migrations.length !== 19) throw new Error(`QA-01 safety stop: expected 19 migration files, found ${migrations.length}.`);
  const history = await prisma.$queryRawUnsafe('SELECT migration_name migrationName, checksum, finished_at finishedAt, rolled_back_at rolledBackAt FROM _prisma_migrations ORDER BY started_at');
  const byName = new Map(history.map((row) => [row.migrationName, row]));
  const invalid = migrations.filter((migration) => {
    const row = byName.get(migration.name);
    return !row || row.checksum !== migration.checksum || !row.finishedAt || row.rolledBackAt;
  });
  if (history.length !== 19 || invalid.length) throw new Error(`QA-01 safety stop: migration history is not canonical (${history.length}/19, invalid=${invalid.map((item) => item.name).join(',') || 'none'}).`);
  return identity;
}

async function resetBusinessData(prisma) {
  const tables = await prisma.$queryRawUnsafe("SELECT table_name tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name");
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
  return tables.length;
}

async function seed(prisma) {
  const password = process.env.QA01_PASSWORD;
  if (!password || password.length < 12) throw new Error('QA01_PASSWORD with at least 12 characters is required.');
  const passwordHash = await bcrypt.hash(password, 10);
  const [candidateUser, recruiterUser, adminUser] = await Promise.all([
    prisma.user.create({ data: { email: 'candidate@jobconnect.local', passwordHash, fullName: 'QA Candidate', role: 'CANDIDATE' } }),
    prisma.user.create({ data: { email: 'recruiter@jobconnect.local', passwordHash, fullName: 'QA Recruiter', role: 'RECRUITER' } }),
    prisma.user.create({ data: { email: 'admin@jobconnect.local', passwordHash, fullName: 'QA Admin', role: 'ADMIN' } }),
  ]);
  const company = await prisma.company.create({ data: { name: 'QA-01 Synthetic Company', address: 'QA Loopback' } });
  await prisma.recruiter.create({ data: { userId: recruiterUser.id, companyId: company.id, jobTitle: 'QA Recruiter' } });
  const candidate = await prisma.candidate.create({
    data: {
      userId: candidateUser.id,
      headline: 'QA Full-stack Candidate',
      location: 'Ho Chi Minh City',
      yearsExperience: 3,
      desiredPosition: 'Software Engineer',
      desiredLocation: 'Ho Chi Minh City',
      desiredEmploymentType: 'FULL_TIME',
      isSearchable: true,
    },
  });
  const skills = await Promise.all(['JavaScript', 'React', 'Node.js', 'SQL'].map((name) => prisma.skill.create({ data: { name } })));
  await prisma.candidateSkill.createMany({ data: skills.slice(0, 3).map((skill) => ({ candidateId: candidate.id, skillId: skill.id, level: 'INTERMEDIATE' })) });
  const resume = await prisma.candidateResume.create({ data: { candidateId: candidate.id, fileName: 'qa01-cv.pdf', path: '/assets/qa01-cv.pdf', mimeType: 'application/pdf', size: 1024, isDefault: true } });
  await prisma.candidateEducation.create({ data: { candidateId: candidate.id, school: 'QA University', major: 'Computer Science', degree: 'Bachelor' } });
  const baseJob = await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'QA-01 Existing Backend Engineer',
      description: 'Synthetic QA-only job used for isolated authenticated end-to-end validation.',
      location: 'Ho Chi Minh City',
      employmentType: 'FULL_TIME',
      minSalary: 1200,
      maxSalary: 2200,
      status: 'PUBLISHED',
      deadline: new Date('2030-12-31T00:00:00.000Z'),
      skills: { create: skills.slice(0, 2).map((skill) => ({ skillId: skill.id, isRequired: true })) },
    },
  });
  return { users: { candidate: candidateUser.id, recruiter: recruiterUser.id, admin: adminUser.id }, candidateId: candidate.id, companyId: company.id, resumeId: resume.id, baseJobId: baseJob.id };
}

async function tableCounts(prisma) {
  const tables = await prisma.$queryRawUnsafe("SELECT table_name tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name");
  const counts = {};
  for (const { tableName } of tables) {
    const escaped = String(tableName).replaceAll('`', '``');
    const [row] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) count FROM \`${escaped}\``);
    counts[tableName] = Number(row.count);
  }
  return counts;
}

async function main() {
  const command = process.argv[2] || 'assert';
  const url = qaUrl();
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    if (command === 'identity') {
      console.log(JSON.stringify({ status: 'PASS', command, identity: await assertQaTarget(prisma) }, null, 2));
      return;
    }
    const identity = await assertQaDatabase(prisma);
    if (command === 'reset-seed') {
      const clearedTables = await resetBusinessData(prisma);
      const fixture = await seed(prisma);
      console.log(JSON.stringify({ status: 'PASS', command, identity, clearedTables, fixture, counts: await tableCounts(prisma) }, null, 2));
      return;
    }
    if (command === 'snapshot') {
      console.log(JSON.stringify({ status: 'PASS', command, identity, counts: await tableCounts(prisma) }, null, 2));
      return;
    }
    if (command !== 'assert') throw new Error(`Unknown QA-01 database command: ${command}`);
    console.log(JSON.stringify({ status: 'PASS', command, identity }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { assertQaDatabase, assertQaTarget, qaUrl, resetBusinessData, seed, tableCounts };
