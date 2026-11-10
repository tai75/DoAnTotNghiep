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
    note: z.string().trim().max(2000).optional(),
    expectedUpdatedAt: z.coerce.date()
  }).refine(({ status, note }) => status !== 'REJECTED' || Boolean(note), { path: ['note'], message: 'Vui lòng nhập lý do từ chối' }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const reviewListSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') })
});

const reviewModerationSchema = z.object({
  body: z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(2000).optional()
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
    limit: z.coerce.number().int().min(1).max(50).default(20),
    sort: z.enum(['updated_desc', 'updated_asc', 'created_desc']).default('updated_desc')
  })
});

const companyListSchema = z.object({
  body: z.object({}), params: z.object({}),
  query: z.object({
    search: z.string().trim().max(180).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    sort: z.enum(['newest', 'oldest', 'name_asc', 'name_desc']).default('newest'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const companyStatusSchema = z.object({
  body: z.object({
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    reason: z.string().trim().max(2000).optional(),
    expectedUpdatedAt: z.coerce.date()
  }).refine(({ status, reason }) => status !== 'SUSPENDED' || Boolean(reason), { path: ['reason'], message: 'Vui lòng nhập lý do đình chỉ' }),
  params: z.object({ id: z.coerce.number().int().positive() }), query: z.object({})
});

const reportListSchema = z.object({
  body: z.object({}), params: z.object({}),
  query: z.object({
    search: z.string().trim().max(180).optional(),
    status: z.enum(['PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED']).optional(),
    targetType: z.enum(['JOB', 'COMPANY']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const reportStatusSchema = z.object({
  body: z.object({
    status: z.enum(['REVIEWING', 'RESOLVED', 'REJECTED']),
    note: z.string().trim().max(2000).optional(),
    expectedUpdatedAt: z.coerce.date()
  }).refine(({ status, note }) => status === 'REVIEWING' || Boolean(note), { path: ['note'], message: 'Vui lòng nhập ghi chú xử lý' }),
  params: z.object({ id: z.coerce.number().int().positive() }), query: z.object({})
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

const verificationListSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const verificationDecisionSchema = z.object({
  body: z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(2000).optional()
  }).refine(({ decision, reason }) => decision !== 'REJECTED' || Boolean(reason), { path: ['reason'], message: 'Vui lòng nhập lý do từ chối' }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const router = require('express').Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/verification-requests', validate(verificationListSchema), asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const [items, total] = await prisma.$transaction([
    prisma.companyVerificationRequest.findMany({
      where: { status },
      select: {
        id: true, status: true, companyName: true, website: true, address: true, industry: true, description: true,
        rejectionReason: true, reviewNote: true, submittedAt: true, reviewedAt: true, companyVersion: true,
        company: { select: { id: true, name: true, status: true, verificationStatus: true, verificationVersion: true } },
        submittedBy: { select: { id: true, fullName: true, email: true } },
        reviewedBy: { select: { id: true, fullName: true } }
      },
      orderBy: { submittedAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.companyVerificationRequest.count({ where: { status } })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.patch('/verification-requests/:id', validate(verificationDecisionSchema), asyncHandler(async (req, res) => {
  const { decision, reason, note } = req.body;
  const current = await prisma.companyVerificationRequest.findUnique({ where: { id: req.params.id } });
  if (!current) throw new ApiError(404, 'Không tìm thấy yêu cầu xác minh');
  if (current.status !== 'PENDING') {
    if (current.status === decision) return res.json({ success: true, data: current, meta: { idempotent: true } });
    throw new ApiError(409, 'Yêu cầu xác minh đã được xử lý');
  }

  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.companyVerificationRequest.updateMany({
      where: { id: current.id, status: 'PENDING', companyVersion: current.companyVersion },
      data: { status: decision, reviewedByUserId: req.user.id, reviewedAt: new Date(), rejectionReason: decision === 'REJECTED' ? reason : null, reviewNote: note || null }
    });
    if (claimed.count !== 1) throw new ApiError(409, 'Yêu cầu vừa được quản trị viên khác xử lý');
    const companyChanged = await transaction.company.updateMany({
      where: { id: current.companyId, status: 'ACTIVE', verificationStatus: 'PENDING', verificationVersion: current.companyVersion },
      data: decision === 'APPROVED'
        ? { verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationSource: 'ADMIN_REVIEW', verificationVersion: { increment: 1 } }
        : { verificationStatus: 'REJECTED', verifiedAt: null, verificationSource: null, verificationVersion: { increment: 1 } }
    });
    if (companyChanged.count !== 1) throw new ApiError(409, 'Doanh nghiệp đã thay đổi trạng thái; quyết định chưa được áp dụng');
    const request = await transaction.companyVerificationRequest.findUnique({ where: { id: current.id } });
    await transaction.auditLog.create({
      data: { userId: req.user.id, action: decision === 'APPROVED' ? 'COMPANY_VERIFICATION_APPROVED' : 'COMPANY_VERIFICATION_REJECTED', entity: 'CompanyVerificationRequest', entityId: current.id, metadata: { companyId: current.companyId, reason: decision === 'REJECTED' ? reason : null, note: note || null, companyVersion: current.companyVersion } }
    });
    const recruiters = await transaction.recruiter.findMany({ where: { companyId: current.companyId }, select: { userId: true } });
    if (recruiters.length) await transaction.notification.createMany({ data: recruiters.map(({ userId }) => ({ userId, type: 'COMPANY_VERIFICATION', title: decision === 'APPROVED' ? 'Doanh nghiệp đã được xác minh' : 'Yêu cầu xác minh bị từ chối', content: decision === 'APPROVED' ? 'Doanh nghiệp của bạn đã được xác minh.' : `Yêu cầu xác minh bị từ chối. Lý do: ${reason}`, link: '/recruiter?section=company' })) });
    return request;
  });
  res.json({ success: true, data: result, meta: { idempotent: false } });
}));

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
    await transaction.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return result;
  });
  res.json({ success: true, data: updated });
}));

router.get('/companies', validate(companyListSchema), asyncHandler(async (req, res) => {
  const { search, status, sort, page, limit } = req.query;
  const where = { ...(search ? { name: { contains: search } } : {}), ...(status ? { status } : {}) };
  const orderBy = sort === 'oldest' ? { createdAt: 'asc' } : sort === 'name_asc' ? { name: 'asc' } : sort === 'name_desc' ? { name: 'desc' } : { createdAt: 'desc' };
  const [items, total] = await prisma.$transaction([
    prisma.company.findMany({
      where,
      select: { id: true, name: true, logoUrl: true, address: true, industry: true, status: true, statusReason: true, statusChangedAt: true, createdAt: true, updatedAt: true, _count: { select: { recruiters: true, jobs: true } } },
      orderBy,
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.company.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/companies/:id', validate(idSchema), asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, description: true, website: true, logoUrl: true, address: true, employeeCount: true, industry: true,
      status: true, statusReason: true, statusChangedAt: true, createdAt: true, updatedAt: true,
      recruiters: { select: { id: true, jobTitle: true, user: { select: { id: true, fullName: true, email: true, status: true, createdAt: true } } } },
      jobs: { select: { id: true, title: true, status: true, createdAt: true, updatedAt: true, _count: { select: { applications: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 },
      _count: { select: { recruiters: true, jobs: true, reports: true } }
    }
  });
  if (!company) throw new ApiError(404, 'Không tìm thấy doanh nghiệp');
  const history = await prisma.auditLog.findMany({ where: { entity: 'Company', entityId: company.id }, select: { id: true, action: true, metadata: true, createdAt: true, user: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ success: true, data: { ...company, history } });
}));

router.patch('/companies/:id/status', validate(companyStatusSchema), asyncHandler(async (req, res) => {
  const { status, reason, expectedUpdatedAt } = req.body;
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) throw new ApiError(404, 'Không tìm thấy doanh nghiệp');
  const normalizedReason = status === 'SUSPENDED' ? reason : null;
  if (company.status === status && (company.statusReason || null) === normalizedReason) {
    return res.json({ success: true, data: company, meta: { idempotent: true } });
  }
  const updated = await prisma.$transaction(async (transaction) => {
    const changed = await transaction.company.updateMany({ where: { id: company.id, updatedAt: expectedUpdatedAt }, data: { status, statusReason: normalizedReason, statusChangedAt: new Date() } });
    if (changed.count !== 1) throw new ApiError(409, 'Doanh nghiệp đã được quản trị viên khác cập nhật, vui lòng tải lại');
    const result = await transaction.company.findUnique({ where: { id: company.id } });
    await transaction.auditLog.create({ data: { userId: req.user.id, action: 'COMPANY_STATUS_UPDATED', entity: 'Company', entityId: company.id, metadata: { fromStatus: company.status, toStatus: status, reason: normalizedReason } } });
    const recruiters = await transaction.recruiter.findMany({ where: { companyId: company.id }, select: { userId: true } });
    if (recruiters.length) await transaction.notification.createMany({ data: recruiters.map(({ userId }) => ({ userId, type: 'COMPANY_STATUS', title: status === 'SUSPENDED' ? 'Doanh nghiệp đã bị đình chỉ' : 'Doanh nghiệp đã được khôi phục', content: status === 'SUSPENDED' ? `Doanh nghiệp ${company.name} đã bị đình chỉ. Lý do: ${normalizedReason}` : `Doanh nghiệp ${company.name} đã được phép hoạt động trở lại.`, link: '/recruiter?section=company' })) });
    return result;
  });
  res.json({ success: true, data: updated });
}));

router.get('/jobs', validate(jobListSchema), asyncHandler(async (req, res) => {
  const { search, status, sort, page, limit } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(search ? { OR: [{ title: { contains: search } }, { company: { name: { contains: search } } }] } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.job.findMany({
      where,
      select: { id: true, title: true, description: true, location: true, employmentType: true, minSalary: true, maxSalary: true, status: true, moderationNote: true, deadline: true, createdAt: true, updatedAt: true, company: { select: { id: true, name: true, status: true } }, skills: { select: { isRequired: true, skill: { select: { id: true, name: true } } } }, _count: { select: { applications: true } } },
      orderBy: sort === 'updated_asc' ? { updatedAt: 'asc' } : sort === 'created_desc' ? { createdAt: 'desc' } : { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.job.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.patch('/jobs/:id/moderation', validate(moderationSchema), asyncHandler(async (req, res) => {
  const { status, note, expectedUpdatedAt } = req.body;
  const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { company: { select: { id: true, name: true, status: true, verificationStatus: true } } } });
  if (!job) throw new ApiError(404, 'Không tìm thấy tin tuyển dụng');
  const normalizedNote = note || null;
  if (job.status === status && (job.moderationNote || null) === normalizedNote) return res.json({ success: true, data: job, meta: { idempotent: true } });
  if (job.status !== 'PENDING') throw new ApiError(409, 'Tin tuyển dụng đã được xử lý, vui lòng tải lại');
  if (status === 'PUBLISHED' && job.company.status !== 'ACTIVE') throw new ApiError(409, 'Không thể duyệt tin của doanh nghiệp đang bị đình chỉ');
  if (status === 'PUBLISHED' && job.company.verificationStatus !== 'VERIFIED') throw new ApiError(409, 'Không thể duyệt tin của doanh nghiệp chưa xác minh');
  const updated = await prisma.$transaction(async (transaction) => {
    const changed = await transaction.job.updateMany({ where: { id: job.id, status: 'PENDING', updatedAt: expectedUpdatedAt }, data: { status, moderationNote: normalizedNote } });
    if (changed.count !== 1) throw new ApiError(409, 'Tin tuyển dụng đã được quản trị viên khác xử lý, vui lòng tải lại');
    const result = await transaction.job.findUnique({ where: { id: job.id }, include: { company: true } });
    const recruiters = await transaction.recruiter.findMany({ where: { companyId: job.companyId }, select: { userId: true } });
    if (recruiters.length) {
      await transaction.notification.createMany({
        data: recruiters.map(({ userId }) => ({
          userId,
          type: 'JOB_MODERATION',
          title: status === 'PUBLISHED' ? 'Tin tuyển dụng đã được duyệt' : 'Tin tuyển dụng bị từ chối',
          content: `Tin "${job.title}" ${status === 'PUBLISHED' ? 'đã được đăng' : 'bị từ chối'} bởi quản trị viên.`,
          link: `/recruiter?section=jobs&jobId=${job.id}`
        }))
      });
    }
    if (status === 'PUBLISHED') {
      const followers = await transaction.companyFollow.findMany({ where: { companyId: job.companyId }, select: { candidate: { select: { userId: true } } } });
      if (followers.length) await transaction.notification.createMany({ data: followers.map(({ candidate }) => ({ userId: candidate.userId, type: 'NEW_COMPANY_JOB', title: 'Công ty bạn theo dõi có việc mới', content: `${job.title} đang tuyển dụng tại công ty bạn theo dõi.`, link: `/jobs/${job.id}` })) });
    }
    await transaction.auditLog.create({
      data: { userId: req.user.id, action: 'JOB_MODERATION_UPDATED', entity: 'Job', entityId: job.id, metadata: { fromStatus: job.status, toStatus: status, note: normalizedNote } }
    });
    return result;
  });
  res.json({ success: true, data: updated });
}));

router.get('/reports', validate(reportListSchema), asyncHandler(async (req, res) => {
  const { search, status, targetType, page, limit } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(targetType ? { targetType } : {}),
    ...(search ? { OR: [{ description: { contains: search } }, { job: { title: { contains: search } } }, { company: { name: { contains: search } } }] } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.report.findMany({ where, select: { id: true, targetType: true, reason: true, description: true, status: true, resolutionNote: true, createdAt: true, updatedAt: true, resolvedAt: true, reporter: { select: { id: true, fullName: true, email: true, role: true } }, resolvedBy: { select: { id: true, fullName: true } }, job: { select: { id: true, title: true, status: true, company: { select: { id: true, name: true } } } }, company: { select: { id: true, name: true, status: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.report.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/reports/:id', validate(idSchema), asyncHandler(async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id }, select: { id: true, targetType: true, reason: true, description: true, status: true, resolutionNote: true, createdAt: true, updatedAt: true, resolvedAt: true, reporter: { select: { id: true, fullName: true, email: true, role: true, status: true } }, resolvedBy: { select: { id: true, fullName: true } }, job: { select: { id: true, title: true, description: true, status: true, updatedAt: true, company: { select: { id: true, name: true, status: true } } } }, company: { select: { id: true, name: true, description: true, status: true, updatedAt: true } } } });
  if (!report) throw new ApiError(404, 'Không tìm thấy báo cáo');
  const history = await prisma.auditLog.findMany({ where: { entity: 'Report', entityId: report.id }, select: { id: true, action: true, metadata: true, createdAt: true, user: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: { ...report, history } });
}));

router.patch('/reports/:id/status', validate(reportStatusSchema), asyncHandler(async (req, res) => {
  const { status, note, expectedUpdatedAt } = req.body;
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) throw new ApiError(404, 'Không tìm thấy báo cáo');
  const normalizedNote = note || null;
  if (report.status === status && (report.resolutionNote || null) === normalizedNote) return res.json({ success: true, data: report, meta: { idempotent: true } });
  const allowed = report.status === 'PENDING' ? ['REVIEWING', 'RESOLVED', 'REJECTED'] : report.status === 'REVIEWING' ? ['RESOLVED', 'REJECTED'] : [];
  if (!allowed.includes(status)) throw new ApiError(409, 'Báo cáo không thể chuyển sang trạng thái này');
  const updated = await prisma.$transaction(async (transaction) => {
    const changed = await transaction.report.updateMany({ where: { id: report.id, status: report.status, updatedAt: expectedUpdatedAt }, data: { status, resolutionNote: normalizedNote, resolvedByUserId: req.user.id, resolvedAt: ['RESOLVED', 'REJECTED'].includes(status) ? new Date() : null } });
    if (changed.count !== 1) throw new ApiError(409, 'Báo cáo đã được quản trị viên khác xử lý, vui lòng tải lại');
    const result = await transaction.report.findUnique({ where: { id: report.id } });
    await transaction.auditLog.create({ data: { userId: req.user.id, action: 'REPORT_STATUS_UPDATED', entity: 'Report', entityId: report.id, metadata: { fromStatus: report.status, toStatus: status, note: normalizedNote } } });
    await transaction.notification.create({ data: { userId: report.reporterUserId, type: 'REPORT_STATUS', title: 'Báo cáo vi phạm đã được cập nhật', content: status === 'REVIEWING' ? 'Báo cáo của bạn đang được quản trị viên xem xét.' : status === 'RESOLVED' ? 'Báo cáo của bạn đã được giải quyết.' : 'Báo cáo của bạn đã bị từ chối.', link: null } });
    return result;
  });
  res.json({ success: true, data: updated });
}));

router.get('/reviews', validate(reviewListSchema), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const reviews = await prisma.companyReview.findMany({ where: { status }, include: { company: { select: { id: true, name: true } }, user: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: reviews.map(({ user, userId, ...review }) => ({ ...review, author: review.isAnonymous ? null : user })) });
}));

router.patch('/reviews/:id/moderation', validate(reviewModerationSchema), asyncHandler(async (req, res) => {
  const { status } = req.body;
  const review = await prisma.companyReview.findUnique({ where: { id: req.params.id } });
  if (!review) throw new ApiError(404, 'Không tìm thấy review');
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.companyReview.update({ where: { id: review.id }, data: { status, moderationNote: req.body.note || null } });
    await transaction.auditLog.create({ data: { userId: req.user.id, action: 'COMPANY_REVIEW_MODERATION_UPDATED', entity: 'CompanyReview', entityId: review.id, metadata: { fromStatus: review.status, toStatus: status, note: req.body.note || null } } });
    return result;
  });
  const { userId, ...safeReview } = updated;
  res.json({ success: true, data: safeReview });
}));

module.exports = router;
