const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const jobSchema = z.object({
  body: z.object({
    title: z.string().min(3).max(180),
    description: z.string().min(20),
    location: z.string().max(150).optional(),
    employmentType: z.string().max(50).optional(),
    minSalary: z.number().nonnegative().optional(),
    maxSalary: z.number().nonnegative().optional(),
    deadline: z.coerce.date().optional(),
    skillIds: z.array(z.number().int().positive()).default([])
  }),
  params: z.object({}),
  query: z.object({})
});

const listSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().optional(),
    location: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10)
  })
});

const router = require('express').Router();

router.get('/', validate(listSchema), asyncHandler(async (req, res) => {
  const { search, location, page, limit } = req.query;
  const where = {
    status: 'PUBLISHED',
    ...(search ? { OR: [{ title: { contains: search } }, { description: { contains: search } }] } : {}),
    ...(location ? { location: { contains: location } } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.job.findMany({ where, include: { company: true, skills: { include: { skill: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.job.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: Number(req.params.id) }, include: { company: true, skills: { include: { skill: true } } } });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
  res.json({ success: true, data: job });
}));

router.post('/', authenticate, authorize('RECRUITER'), validate(jobSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const { skillIds, ...jobData } = req.body;
  const job = await prisma.job.create({
    data: {
      ...jobData,
      companyId: recruiter.companyId,
      status: 'PENDING',
      skills: { create: skillIds.map((skillId) => ({ skill: { connect: { id: skillId } } })) }
    },
    include: { company: true, skills: { include: { skill: true } } }
  });
  res.status(201).json({ success: true, data: job });
}));

module.exports = router;
