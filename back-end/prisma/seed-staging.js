require('dotenv').config();

const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

const REQUIRED = [
  'DATABASE_URL',
  'STAGING_DATABASE_NAME',
  'STAGING_DEMO_CANDIDATE_EMAIL', 'STAGING_DEMO_CANDIDATE_PASSWORD',
  'STAGING_DEMO_RECRUITER_EMAIL', 'STAGING_DEMO_RECRUITER_PASSWORD',
  'STAGING_DEMO_ADMIN_EMAIL', 'STAGING_DEMO_ADMIN_PASSWORD'
];

function validateGuardrails() {
  if (process.env.DEPLOY_ENV !== 'staging' || process.env.ALLOW_STAGING_SEED !== 'true') {
    throw new Error('Refusing to seed: require DEPLOY_ENV=staging and ALLOW_STAGING_SEED=true');
  }
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing staging seed variables: ${missing.join(', ')}`);

  const databaseUrl = new URL(process.env.DATABASE_URL);
  const actualDatabase = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (databaseUrl.protocol !== 'mysql:' || actualDatabase !== process.env.STAGING_DATABASE_NAME) {
    throw new Error(`Refusing to seed database "${actualDatabase || '(empty)'}"; expected STAGING_DATABASE_NAME`);
  }

  const emails = [
    process.env.STAGING_DEMO_CANDIDATE_EMAIL,
    process.env.STAGING_DEMO_RECRUITER_EMAIL,
    process.env.STAGING_DEMO_ADMIN_EMAIL
  ].map((value) => value.trim().toLowerCase());
  if (new Set(emails).size !== emails.length) throw new Error('Demo account emails must be distinct');
  for (const name of REQUIRED.filter((value) => value.endsWith('_PASSWORD'))) {
    const password = process.env[name];
    if (password.length < 12 || password.length > 128) throw new Error(`${name} must contain 12-128 characters`);
  }
  return emails;
}

async function upsertUser(transaction, { email, passwordHash, fullName, role }) {
  const user = await transaction.user.upsert({
    where: { email },
    update: { passwordHash, fullName, status: 'ACTIVE', tokenVersion: { increment: 1 } },
    create: { email, passwordHash, fullName, role, status: 'ACTIVE' }
  });
  if (user.role !== role) throw new Error(`Refusing to change existing account role for ${email}`);
  return user;
}

async function main() {
  const [candidateEmail, recruiterEmail, adminEmail] = validateGuardrails();
  const [candidatePasswordHash, recruiterPasswordHash, adminPasswordHash] = await Promise.all([
    bcrypt.hash(process.env.STAGING_DEMO_CANDIDATE_PASSWORD, 12),
    bcrypt.hash(process.env.STAGING_DEMO_RECRUITER_PASSWORD, 12),
    bcrypt.hash(process.env.STAGING_DEMO_ADMIN_PASSWORD, 12)
  ]);

  await prisma.$transaction(async (transaction) => {
    const candidateUser = await upsertUser(transaction, {
      email: candidateEmail, passwordHash: candidatePasswordHash,
      fullName: 'Staging Demo Candidate', role: 'CANDIDATE'
    });
    const recruiterUser = await upsertUser(transaction, {
      email: recruiterEmail, passwordHash: recruiterPasswordHash,
      fullName: 'Staging Demo Recruiter', role: 'RECRUITER'
    });
    await upsertUser(transaction, {
      email: adminEmail, passwordHash: adminPasswordHash,
      fullName: 'Staging Demo Administrator', role: 'ADMIN'
    });

    const skills = await Promise.all(['JavaScript', 'React', 'Node.js', 'SQL', 'Docker'].map((name) => (
      transaction.skill.upsert({ where: { name }, update: {}, create: { name } })
    )));
    const candidate = await transaction.candidate.upsert({
      where: { userId: candidateUser.id },
      update: {
        headline: 'Full-stack Developer', bio: 'Synthetic staging demo profile.', location: 'Ho Chi Minh City',
        yearsExperience: 3, desiredPosition: 'Software Engineer', desiredLocation: 'Ho Chi Minh City',
        desiredEmploymentType: 'FULL_TIME', isSearchable: true
      },
      create: {
        userId: candidateUser.id, headline: 'Full-stack Developer', bio: 'Synthetic staging demo profile.',
        location: 'Ho Chi Minh City', yearsExperience: 3, desiredPosition: 'Software Engineer',
        desiredLocation: 'Ho Chi Minh City', desiredEmploymentType: 'FULL_TIME', isSearchable: true
      }
    });
    await transaction.candidateSkill.createMany({
      data: skills.slice(0, 4).map((skill) => ({ candidateId: candidate.id, skillId: skill.id })),
      skipDuplicates: true
    });

    let company = await transaction.company.findFirst({ where: { name: 'Job Connect Staging Demo' } });
    company ||= await transaction.company.create({
      data: { name: 'Job Connect Staging Demo', description: 'Synthetic company for staging only.', address: 'Ho Chi Minh City', industry: 'Software' }
    });
    await transaction.recruiter.upsert({
      where: { userId: recruiterUser.id },
      update: { companyId: company.id, jobTitle: 'Demo Recruiter' },
      create: { userId: recruiterUser.id, companyId: company.id, jobTitle: 'Demo Recruiter' }
    });

    let job = await transaction.job.findFirst({ where: { companyId: company.id, title: 'Staging Demo Software Engineer' } });
    job ||= await transaction.job.create({
      data: {
        companyId: company.id, title: 'Staging Demo Software Engineer',
        description: 'Synthetic job used only for the graduation demo.', location: 'Ho Chi Minh City',
        employmentType: 'FULL_TIME', minSalary: 1500, maxSalary: 2500,
        requiredYearsExperience: 2, status: 'PUBLISHED',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    await Promise.all(skills.slice(0, 3).map((skill, index) => transaction.jobSkill.upsert({
      where: { jobId_skillId: { jobId: job.id, skillId: skill.id } },
      update: { isRequired: index < 2 },
      create: { jobId: job.id, skillId: skill.id, isRequired: index < 2 }
    })));
  });

  console.log('Staging demo accounts and synthetic records are ready. No passwords were printed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
