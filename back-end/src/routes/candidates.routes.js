const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const profileSchema = z.object({
  body: z.object({
    headline: z.string().max(180).nullable().optional(),
    bio: z.string().max(10000).nullable().optional(),
    location: z.string().max(150).nullable().optional(),
    yearsExperience: z.number().nonnegative().max(99.9).nullable().optional(),
    education: z.string().max(255).nullable().optional(),
    resumeUrl: z.string().url().max(500).nullable().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({}),
  query: z.object({})
});

const skillsSchema = z.object({
  body: z.object({
    skillIds: z.array(z.number().int().positive()).max(100)
  }),
  params: z.object({}),
  query: z.object({})
});

const router = require('express').Router();

async function findCandidate(userId) {
  const candidate = await prisma.candidate.findUnique({ where: { userId } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  return candidate;
}

const profileInclude = {
  user: { select: { id: true, email: true, fullName: true, phone: true } },
  skills: { include: { skill: true } }
};

router.get('/skills', asyncHandler(async (req, res) => {
  const skills = await prisma.skill.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: skills });
}));

router.get('/me', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const profile = await prisma.candidate.findUnique({ where: { id: candidate.id }, include: profileInclude });
  res.json({ success: true, data: profile });
}));

router.patch('/me', authenticate, authorize('CANDIDATE'), validate(profileSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const profile = await prisma.candidate.update({
    where: { id: candidate.id },
    data: req.body,
    include: profileInclude
  });
  res.json({ success: true, data: profile });
}));

router.put('/me/skills', authenticate, authorize('CANDIDATE'), validate(skillsSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const uniqueSkillIds = [...new Set(req.body.skillIds)];
  const skills = await prisma.skill.findMany({ where: { id: { in: uniqueSkillIds } }, select: { id: true } });
  if (skills.length !== uniqueSkillIds.length) {
    throw new ApiError(400, 'Một hoặc nhiều kỹ năng không tồn tại');
  }

  await prisma.$transaction([
    prisma.candidateSkill.deleteMany({ where: { candidateId: candidate.id } }),
    ...uniqueSkillIds.map((skillId) => prisma.candidateSkill.create({
      data: { candidateId: candidate.id, skillId }
    }))
  ]);

  const profile = await prisma.candidate.findUnique({ where: { id: candidate.id }, include: profileInclude });
  res.json({ success: true, data: profile });
}));

module.exports = router;
