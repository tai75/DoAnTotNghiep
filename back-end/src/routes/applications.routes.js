const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const applySchema = z.object({
  body: z.object({
    coverLetter: z.string().max(5000).optional(),
    resumeId: z.coerce.number().int().positive().optional()
  }),
  params: z.object({ jobId: z.coerce.number().int().positive() }),
  query: z.object({})
});

const statusSchema = z.object({
  body: z.object({
    status: z.enum(['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED']),
    note: z.string().max(2000).optional()
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const recruiterListSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    jobId: z.coerce.number().int().positive().optional(),
    status: z.enum(['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const router = require('express').Router();

router.post('/jobs/:jobId', authenticate, authorize('CANDIDATE'), validate(applySchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
  if (!job || job.status !== 'PUBLISHED') throw new ApiError(404, 'Việc làm không tồn tại hoặc chưa được đăng');
  const existing = await prisma.application.findUnique({ where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } } });
  if (existing) throw new ApiError(409, 'Bạn đã ứng tuyển vào việc làm này');
  let resumePathSnapshot;
  if (req.body.resumeId) {
    const resume = await prisma.candidateResume.findFirst({ where: { id: req.body.resumeId, candidateId: candidate.id } });
    if (!resume) throw new ApiError(400, 'CV không thuộc về ứng viên');
    resumePathSnapshot = resume.path;
  }
  const application = await prisma.$transaction(async (transaction) => {
    const result = await transaction.application.create({
      data: {
        candidateId: candidate.id,
        jobId: job.id,
        coverLetter: req.body.coverLetter,
        resumeId: req.body.resumeId,
        resumePathSnapshot,
        history: { create: { toStatus: 'APPLIED' } }
      },
      include: { job: true, resume: true, history: true }
    });
    const recruiters = await transaction.recruiter.findMany({ where: { companyId: job.companyId }, select: { userId: true } });
    if (recruiters.length) {
      await transaction.notification.createMany({
        data: recruiters.map(({ userId }) => ({
          userId,
          type: 'NEW_APPLICATION',
          title: 'Có đơn ứng tuyển mới',
          content: `Có ứng viên mới ứng tuyển vào vị trí ${job.title}.`,
          link: `/recruiter/applications/${result.id}`
        }))
      });
    }
    return result;
  });
  res.status(201).json({ success: true, data: application });
}));

router.get('/me', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  const applications = await prisma.application.findMany({ where: { candidateId: candidate.id }, include: { job: { include: { company: true } }, resume: true, history: { orderBy: { createdAt: 'asc' } }, matchScore: true }, orderBy: { appliedAt: 'desc' } });
  res.json({ success: true, data: applications });
}));

router.get('/managed', authenticate, authorize('RECRUITER'), validate(recruiterListSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const { jobId, status, page, limit } = req.query;
  const where = {
    ...(jobId ? { jobId } : {}),
    ...(status ? { status } : {}),
    job: { companyId: recruiter.companyId }
  };
  const [items, total] = await prisma.$transaction([
    prisma.application.findMany({
      where,
      include: { candidate: { include: { user: { select: { id: true, fullName: true } }, skills: { include: { skill: true } } } }, resume: true, job: true, history: { orderBy: { createdAt: 'asc' } }, matchScore: true },
      orderBy: { appliedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.application.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/:id', authenticate, validate(idSchema), asyncHandler(async (req, res) => {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { candidate: { include: { user: { select: { id: true, fullName: true } }, skills: { include: { skill: true } } } }, resume: true, job: { include: { company: true } }, history: { orderBy: { createdAt: 'asc' } }, matchScore: true }
  });
  if (!application) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  const isCandidate = req.user.role === 'CANDIDATE' && application.candidate.userId === req.user.id;
  let isRecruiter = false;
  if (req.user.role === 'RECRUITER') {
    const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
    isRecruiter = recruiter && recruiter.companyId === application.job.companyId;
  }
  if (!isCandidate && !isRecruiter) throw new ApiError(403, 'Bạn không có quyền xem hồ sơ này');
  res.json({ success: true, data: application });
}));

router.patch('/:id/withdraw', authenticate, authorize('CANDIDATE'), validate(idSchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  const application = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!application || !candidate || application.candidateId !== candidate.id) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  if (['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(application.status)) throw new ApiError(400, 'Không thể rút hồ sơ ở trạng thái hiện tại');
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.application.update({ where: { id: application.id }, data: { status: 'WITHDRAWN' } });
    await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: 'WITHDRAWN' } });
    return result;
  });
  res.json({ success: true, data: updated });
}));

router.patch('/:id/status', authenticate, authorize('RECRUITER'), validate(statusSchema), asyncHandler(async (req, res) => {
  const application = await prisma.application.findUnique({ where: { id: req.params.id }, include: { job: true } });
  if (!application) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  if (application.job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.application.update({ where: { id: application.id }, data: { status: req.body.status } });
    await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: req.body.status, note: req.body.note } });
    const candidate = await transaction.candidate.findUnique({ where: { id: application.candidateId }, select: { userId: true } });
    if (candidate) {
      await transaction.notification.create({
        data: {
          userId: candidate.userId,
          type: 'APPLICATION_STATUS_CHANGED',
          title: 'Đơn ứng tuyển được cập nhật',
          content: `Đơn ứng tuyển vị trí ${application.job.title} đã chuyển sang trạng thái ${req.body.status}.`,
          link: `/applications`
        }
      });
    }
    return result;
  });
  res.json({ success: true, data: updated });
}));

module.exports = router;
