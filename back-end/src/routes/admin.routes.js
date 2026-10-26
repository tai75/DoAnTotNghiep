const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const listSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().optional(),
    role: z.enum(['CANDIDATE', 'RECRUITER', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'BANNED']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const userStatusSchema = z.object({
  body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'BANNED']) }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const moderationSchema = z.object({
  body: z.object({
    status: z.enum(['PUBLISHED', 'REJECTED']),
    note: z.string().max(2000).optional()
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const jobListSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().optional(),
    status: z.enum(['DRAFT', 'PENDING', 'PUBLISHED', 'CLOSED', 'REJECTED']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const statsSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    groupBy: z.enum(['day', 'month', 'year']).default('day')
  }).refine(({ from, to }) => !from || !to || from <= to, 'from phải nhỏ hơn hoặc bằng to')
});

const auditSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    action: z.string().max(100).optional(),
    entity: z.string().max(100).optional(),
    userId: z.coerce.number().int().positive().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
});

const router = require('express').Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/stats', validate(statsSchema), asyncHandler(async (req, res) => {
  const { from, to, groupBy } = req.query;
  const start = from || new Date(new Date().setDate(new Date().getDate() - 30));
  const end = to || new Date();
  end.setHours(23, 59, 59, 999);
  const dateWhere = { gte: start, lte: end };
  const formatDate = (date) => groupBy === 'year'
    ? String(date.getFullYear())
    : groupBy === 'month'
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : date.toISOString().slice(0, 10);
  const [userRows, jobRows, applicationRows] = await prisma.$transaction([
    prisma.user.findMany({ where: { createdAt: dateWhere }, select: { createdAt: true, role: true, status: true } }),
    prisma.job.findMany({ where: { createdAt: dateWhere }, select: { createdAt: true, status: true } }),
    prisma.application.findMany({ where: { appliedAt: dateWhere }, select: { appliedAt: true, status: true } })
  ]);
  const seriesMap = new Map();
  const add = (date, category, status) => {
    const key = formatDate(date);
    if (!seriesMap.has(key)) seriesMap.set(key, { period: key, users: {}, jobs: {}, applications: {} });
    const bucket = seriesMap.get(key)[category];
    bucket[status] = (bucket[status] || 0) + 1;
  };
  userRows.forEach((row) => add(row.createdAt, 'users', `${row.role}_${row.status}`));
  jobRows.forEach((row) => add(row.createdAt, 'jobs', row.status));
  applicationRows.forEach((row) => add(row.appliedAt, 'applications', row.status));
  const [users, candidates, recruiters, companies, jobs, applications, pendingJobs] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'CANDIDATE' } }),
    prisma.user.count({ where: { role: 'RECRUITER' } }),
    prisma.company.count(),
    prisma.job.count(),
    prisma.application.count(),
    prisma.job.count({ where: { status: 'PENDING' } })
  ]);
  res.json({ success: true, data: { users, candidates, recruiters, companies, jobs, applications, pendingJobs, from: start, to: end, groupBy, series: [...seriesMap.values()].sort((a, b) => a.period.localeCompare(b.period)) } });
}));

router.get('/users', validate(listSchema), asyncHandler(async (req, res) => {
  const { search, role, status, page, limit } = req.query;
  const where = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(search ? { OR: [{ email: { contains: search } }, { fullName: { contains: search } }] } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: { id: true, email: true, fullName: true, phone: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.user.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/users/:id', validate(idSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, email: true, fullName: true, phone: true, role: true, status: true, createdAt: true,
      candidate: { include: { skills: { include: { skill: true } }, educations: true, experiences: true, projects: true, resumes: { select: { id: true, fileName: true, mimeType: true, size: true, isDefault: true, createdAt: true } } } },
      recruiter: { include: { company: true } }
    }
  });
  if (!user) throw new ApiError(404, 'Không tìm thấy tài khoản');
  res.json({ success: true, data: user });
}));

router.get('/audit-logs', validate(auditSchema), asyncHandler(async (req, res) => {
  const { action, entity, userId, from, to, page, limit } = req.query;
  const where = {
    ...(action ? { action } : {}),
    ...(entity ? { entity } : {}),
    ...(userId ? { userId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, include: { user: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.auditLog.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.patch('/users/:id/status', validate(userStatusSchema), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw new ApiError(400, 'Không thể thay đổi trạng thái tài khoản đang đăng nhập');
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new ApiError(404, 'Không tìm thấy tài khoản');
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.user.update({
      where: { id: user.id },
      data: { status: req.body.status, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, fullName: true, role: true, status: true }
    });
    await transaction.auditLog.create({
      data: { userId: req.user.id, action: 'USER_STATUS_UPDATED', entity: 'User', entityId: user.id, metadata: { fromStatus: user.status, toStatus: req.body.status } }
    });
    return result;
  });
  res.json({ success: true, data: updated });
}));

router.get('/companies', validate(listSchema), asyncHandler(async (req, res) => {
  const { search, page, limit } = req.query;
  const where = search ? { name: { contains: search } } : {};
  const [items, total] = await prisma.$transaction([
    prisma.company.findMany({
      where,
      include: { _count: { select: { recruiters: true, jobs: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.company.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/jobs', validate(jobListSchema), asyncHandler(async (req, res) => {
  const { search, status, page, limit } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(search ? { OR: [{ title: { contains: search } }, { company: { name: { contains: search } } }] } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.job.findMany({
      where,
      include: { company: true, _count: { select: { applications: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.job.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.patch('/jobs/:id/moderation', validate(moderationSchema), asyncHandler(async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) throw new ApiError(404, 'Không tìm thấy tin tuyển dụng');
  if (!['PENDING', 'PUBLISHED', 'REJECTED'].includes(job.status)) {
    throw new ApiError(400, 'Tin tuyển dụng không ở trạng thái có thể kiểm duyệt');
  }
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.job.update({ where: { id: job.id }, data: { status: req.body.status, moderationNote: req.body.note || null }, include: { company: true } });
    const recruiters = await transaction.recruiter.findMany({ where: { companyId: job.companyId }, select: { userId: true } });
    if (recruiters.length) {
      await transaction.notification.createMany({
        data: recruiters.map(({ userId }) => ({
          userId,
          type: 'JOB_MODERATION',
          title: req.body.status === 'PUBLISHED' ? 'Tin tuyển dụng đã được duyệt' : 'Tin tuyển dụng bị từ chối',
          content: `Tin "${job.title}" ${req.body.status === 'PUBLISHED' ? 'đã được đăng' : 'bị từ chối'} bởi quản trị viên.`,
          link: `/recruiter/jobs/${job.id}`
        }))
      });
    }
    await transaction.auditLog.create({
      data: { userId: req.user.id, action: 'JOB_MODERATION_UPDATED', entity: 'Job', entityId: job.id, metadata: { fromStatus: job.status, toStatus: req.body.status, note: req.body.note || null } }
    });
    return result;
  });
  res.json({ success: true, data: updated });
}));

module.exports = router;
