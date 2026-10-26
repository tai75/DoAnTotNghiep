const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping demo seed in production.');
    return;
  }

  if (!process.env.ADMIN_SEED_PASSWORD) {
    throw new Error('ADMIN_SEED_PASSWORD is required when running the demo seed.');
  }

  const passwordHash = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@jobconnect.local' },
    update: {},
    create: { email: 'admin@jobconnect.local', passwordHash, fullName: 'System Admin', role: 'ADMIN' }
  });
  const skills = await Promise.all(['JavaScript', 'React', 'Node.js', 'SQL', 'Docker'].map((name) => prisma.skill.upsert({ where: { name }, update: {}, create: { name } })));
  const demoPasswordHash = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD, 12);
  const candidateUser = await prisma.user.upsert({
    where: { email: 'candidate@jobconnect.local' },
    update: {},
    create: { email: 'candidate@jobconnect.local', passwordHash: demoPasswordHash, fullName: 'Demo Candidate', role: 'CANDIDATE' }
  });
  const candidate = await prisma.candidate.upsert({
    where: { userId: candidateUser.id },
    update: { headline: 'Full-stack Developer', desiredPosition: 'Software Engineer', desiredLocation: 'Ho Chi Minh City', isSearchable: true },
    create: { userId: candidateUser.id, headline: 'Full-stack Developer', desiredPosition: 'Software Engineer', desiredLocation: 'Ho Chi Minh City' }
  });
  const existingResume = await prisma.candidateResume.findFirst({ where: { candidateId: candidate.id } });
  if (!existingResume) {
    await prisma.candidateResume.create({
      data: { candidateId: candidate.id, fileName: 'demo-cv.pdf', path: '/assets/demo-cv.pdf', mimeType: 'application/pdf', size: 102400, isDefault: true }
    });
  }
  const educationCount = await prisma.candidateEducation.count({ where: { candidateId: candidate.id } });
  if (!educationCount) {
    await prisma.candidateEducation.create({
      data: { candidateId: candidate.id, school: 'Vietnam National University', major: 'Computer Science', degree: 'Bachelor' }
    });
  }
  const company = await prisma.company.findFirst({ where: { name: 'Demo Technology' } }) || await prisma.company.create({ data: { name: 'Demo Technology', address: 'Ho Chi Minh City' } });
  const recruiterUser = await prisma.user.upsert({
    where: { email: 'recruiter@jobconnect.local' },
    update: {},
    create: { email: 'recruiter@jobconnect.local', passwordHash: demoPasswordHash, fullName: 'Demo Recruiter', role: 'RECRUITER' }
  });
  await prisma.recruiter.upsert({
    where: { userId: recruiterUser.id },
    update: { companyId: company.id },
    create: { userId: recruiterUser.id, companyId: company.id, jobTitle: 'Talent Acquisition' }
  });
  const job = await prisma.job.findFirst({ where: { companyId: company.id, title: 'Demo Software Engineer' } });
  if (!job) {
    await prisma.job.create({
      data: {
        companyId: company.id,
        title: 'Demo Software Engineer',
        description: 'Build and maintain reliable web applications with our engineering team.',
        location: 'Ho Chi Minh City',
        employmentType: 'FULL_TIME',
        minSalary: 1500,
        maxSalary: 2500,
        status: 'PUBLISHED',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        skills: { create: [{ skillId: skills[0].id }, { skillId: skills[2].id }] }
      }
    });
  }
  const notificationCount = await prisma.notification.count({ where: { userId: candidateUser.id, type: 'SYSTEM', title: 'Chào mừng bạn' } });
  if (!notificationCount) {
    await prisma.notification.create({
      data: { userId: candidateUser.id, type: 'SYSTEM', title: 'Chào mừng bạn', content: 'Hãy hoàn thiện hồ sơ để tăng cơ hội tìm việc.' }
    });
  }
  console.log(`Seeded admin ${admin.email}, demo users and ${skills.length} skills.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
