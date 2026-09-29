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

const jobUpdateSchema = z.object({
  body: jobSchema.shape.body.partial().refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const jobIdSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const listSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().optional(),
    location: z.string().optional(),
    company: z.string().optional(),
    employmentType: z.string().optional(),
    skill: z.string().optional(),
    minSalary: z.coerce.number().nonnegative().optional(),
    maxSalary: z.coerce.number().nonnegative().optional(),
    sort: z.enum(['newest', 'salary_high', 'salary_low']).default('newest'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10)
  })
}).superRefine((value, context) => {
  if (value.query.minSalary !== undefined && value.query.maxSalary !== undefined && value.query.minSalary > value.query.maxSalary) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['query', 'maxSalary'], message: 'maxSalary phải lớn hơn hoặc bằng minSalary' });
  }
});

const router = require('express').Router();

router.get('/', validate(listSchema), asyncHandler(async (req, res) => {
  const { search, location, company, employmentType, skill, minSalary, maxSalary, sort, page, limit } = req.query;
  const skillNames = skill ? skill.split(',').map((item) => item.trim()).filter(Boolean) : [];
  const salaryFilters = [
    ...(minSalary !== undefined ? [{ OR: [{ maxSalary: { gte: minSalary } }, { maxSalary: null }] }] : []),
    ...(maxSalary !== undefined ? [{ OR: [{ minSalary: { lte: maxSalary } }, { minSalary: null }] }] : [])
  ];
  const where = {
    status: 'PUBLISHED',
    ...(search ? { OR: [{ title: { contains: search } }, { description: { contains: search } }] } : {}),
    ...(location ? { location: { contains: location } } : {}),
    ...(company ? { company: { name: { contains: company } } } : {}),
    ...(employmentType ? { employmentType: { equals: employmentType } } : {}),
    ...(skillNames.length ? { skills: { some: { skill: { name: { in: skillNames } } } } } : {}),
    ...(salaryFilters.length ? { AND: salaryFilters } : {})
  };
  const orderBy = sort === 'salary_high'
    ? { maxSalary: 'desc' }
    : sort === 'salary_low'
      ? { minSalary: 'asc' }
      : { createdAt: 'desc' };
  const [items, total] = await prisma.$transaction([
    prisma.job.findMany({ where, include: { company: true, skills: { include: { skill: true } } }, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.job.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/me', authenticate, authorize('RECRUITER'), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const jobs = await prisma.job.findMany({
    where: { companyId: recruiter.companyId },
    include: { skills: { include: { skill: true } }, _count: { select: { applications: true } } },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ success: true, data: jobs });
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

router.patch('/:id', authenticate, authorize('RECRUITER'), validate(jobUpdateSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
  if (job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');

  const { skillIds, ...jobData } = req.body;
  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      ...jobData,
      ...(skillIds ? { skills: { deleteMany: {}, create: skillIds.map((skillId) => ({ skill: { connect: { id: skillId } } })) } } : {})
    },
    include: { company: true, skills: { include: { skill: true } } }
  });
  res.json({ success: true, data: updated });
}));

router.delete('/:id', authenticate, authorize('RECRUITER'), validate(jobIdSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
  if (job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  await prisma.job.update({ where: { id: job.id }, data: { status: 'CLOSED' } });
  res.json({ success: true, message: 'Đã đóng tin tuyển dụng' });
}));

module.exports = router;
