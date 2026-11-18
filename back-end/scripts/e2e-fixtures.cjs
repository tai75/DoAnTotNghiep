const bcrypt = require('bcryptjs');

const ACCOUNTS = Object.freeze({
  candidate: 'candidate@jobconnect.local',
  recruiter: 'recruiter@jobconnect.local',
  admin: 'admin@jobconnect.local',
});

const PDF_FIXTURE = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function seedDisposableFixtures({ prisma, storage, password, accounts = ACCOUNTS }) {
  if (!prisma || !storage) throw new Error('Disposable fixture seed requires explicit prisma and storage dependencies');
  if (accounts !== ACCOUNTS) {
    const emails = ['candidate', 'recruiter', 'admin'].map((role) => accounts?.[role]);
    if (emails.some((email) => !/^core-ui-[a-f0-9]{16}-(candidate|recruiter|admin)@example\.invalid$/.test(email || ''))
      || new Set(emails).size !== 3) throw new Error('Core UI fixture emails must be unique example.invalid identities');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('E2E_PASSWORD phải có từ 12 đến 128 ký tự');
  }
  const existingUsers = await prisma.user.count();
  if (existingUsers !== 0) throw new Error('Disposable fixture seed chỉ chạy trên business data trống');

  const resumeKey = storage.createKey('pdf');
  const logoKey = storage.createKey('png');
  await storage.put(storage.namespaces.resumes, resumeKey, PDF_FIXTURE);
  try {
    await storage.put(storage.namespaces.logos, logoKey, PNG_FIXTURE);
  } catch (error) {
    await storage.removeManaged(storage.namespaces.resumes, resumeKey).catch(() => {});
    throw error;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    return await prisma.$transaction(async (transaction) => {
      const [candidateUser, recruiterUser, adminUser] = await Promise.all([
        transaction.user.create({ data: { email: accounts.candidate, passwordHash, fullName: 'Ứng viên kiểm thử', role: 'CANDIDATE' } }),
        transaction.user.create({ data: { email: accounts.recruiter, passwordHash, fullName: 'Nhà tuyển dụng kiểm thử', role: 'RECRUITER' } }),
        transaction.user.create({ data: { email: accounts.admin, passwordHash, fullName: 'Quản trị viên kiểm thử', role: 'ADMIN' } }),
      ]);
      const company = await transaction.company.create({
        data: {
          name: 'Công ty Công nghệ Kiểm thử',
          description: 'Doanh nghiệp tổng hợp chỉ dùng cho kiểm thử tự động.',
          address: 'Thành phố Hồ Chí Minh',
          industry: 'Công nghệ thông tin',
          logoUrl: `/assets/logos/${logoKey}`,
          verificationStatus: 'VERIFIED',
          verificationSource: 'ADMIN_REVIEW',
          verifiedAt: new Date(),
          verificationVersion: 2,
        },
      });
      await transaction.recruiter.create({ data: { userId: recruiterUser.id, companyId: company.id, jobTitle: 'Chuyên viên tuyển dụng' } });
      await transaction.companyVerificationRequest.create({
        data: {
          companyId: company.id,
          submittedByUserId: recruiterUser.id,
          reviewedByUserId: adminUser.id,
          status: 'APPROVED',
          companyName: company.name,
          address: company.address,
          requestKey: `e2e-fixture-${company.id}`,
          companyVersion: 1,
          reviewedAt: new Date(),
          reviewNote: 'Hồ sơ tổng hợp đã được duyệt cho kiểm thử.',
        },
      });
      const candidate = await transaction.candidate.create({
        data: {
          userId: candidateUser.id,
          headline: 'Lập trình viên toàn diện',
          location: 'Thành phố Hồ Chí Minh',
          yearsExperience: 3,
          desiredPosition: 'Kỹ sư phần mềm',
          desiredLocation: 'Thành phố Hồ Chí Minh',
          desiredEmploymentType: 'FULL_TIME',
          isSearchable: true,
        },
      });
      const skills = await Promise.all(['JavaScript', 'React', 'Node.js', 'SQL'].map((name) => transaction.skill.create({ data: { name } })));
      await transaction.candidateSkill.createMany({ data: skills.slice(0, 3).map((skill) => ({ candidateId: candidate.id, skillId: skill.id, level: 'INTERMEDIATE' })) });
      const resume = await transaction.candidateResume.create({
        data: { candidateId: candidate.id, fileName: 'ho-so-kiem-thu.pdf', path: resumeKey, mimeType: 'application/pdf', size: PDF_FIXTURE.length, isDefault: true },
      });
      await transaction.candidateEducation.create({
        data: { candidateId: candidate.id, school: 'Đại học Kiểm thử', major: 'Khoa học máy tính', degree: 'Cử nhân' },
      });
      const job = await transaction.job.create({
        data: {
          companyId: company.id,
          title: 'Kỹ sư phần mềm kiểm thử',
          description: 'Vị trí tổng hợp phục vụ kiểm thử quy trình tuyển dụng cô lập.',
          location: 'Thành phố Hồ Chí Minh',
          employmentType: 'FULL_TIME',
          minSalary: 1200,
          maxSalary: 2200,
          status: 'PUBLISHED',
          deadline: new Date('2030-12-31T00:00:00.000Z'),
          skills: { create: skills.slice(0, 2).map((skill) => ({ skillId: skill.id, isRequired: true })) },
        },
      });
      return {
        users: { candidate: candidateUser.id, recruiter: recruiterUser.id, admin: adminUser.id },
        candidateId: candidate.id,
        companyId: company.id,
        resumeId: resume.id,
        baseJobId: job.id,
        assets: { resumeKey, logoKey },
      };
    });
  } catch (error) {
    await Promise.all([
      storage.removeManaged(storage.namespaces.resumes, resumeKey).catch(() => {}),
      storage.removeManaged(storage.namespaces.logos, logoKey).catch(() => {}),
    ]);
    throw error;
  }
}

module.exports = { ACCOUNTS, PDF_FIXTURE, PNG_FIXTURE, seedDisposableFixtures };
