const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@jobconnect.local' },
    update: {},
    create: { email: 'admin@jobconnect.local', passwordHash, fullName: 'System Admin', role: 'ADMIN' }
  });
  const skills = await Promise.all(['JavaScript', 'React', 'Node.js', 'SQL', 'Docker'].map((name) => prisma.skill.upsert({ where: { name }, update: {}, create: { name } })));
  console.log(`Seeded admin ${admin.email} and ${skills.length} skills.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
