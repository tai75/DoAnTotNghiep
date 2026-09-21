const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const applySchema = z.object({
  body: z.object({ coverLetter: z.string().max(5000).optional() }),
  params: z.object({ jobId: z.coerce.number().int().positive() }),
  query: z.object({})
});

const statusSchema = z.object({
  body: z.object({ status: z.enum(['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED']) }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const router = require('express').Router();

router.post('/jobs/:jobId', authenticate, authorize('CANDIDATE'), validate(applySchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
  if (!job || job.status !== 'PUBLISHED') throw new ApiError(404, 'Việc làm không tồn tại hoặc chưa được đăng');
  const application = await prisma.application.create({
    data: {
      candidateId: candidate.id,
      jobId: job.id,
      coverLetter: req.body.coverLetter,
      history: { create: { toStatus: 'APPLIED' } }
    },
    include: { job: true, history: true }
  });
  res.status(201).json({ success: true, data: application });
}));

router.get('/me', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  const applications = await prisma.application.findMany({ where: { candidateId: candidate.id }, include: { job: { include: { company: true } }, history: { orderBy: { createdAt: 'asc' } }, matchScore: true }, orderBy: { appliedAt: 'desc' } });
  res.json({ success: true, data: applications });
}));

router.patch('/:id/status', authenticate, authorize('RECRUITER'), validate(statusSchema), asyncHandler(async (req, res) => {
  const application = await prisma.application.findUnique({ where: { id: req.params.id }, include: { job: true } });
  if (!application) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (application.job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.application.update({ where: { id: application.id }, data: { status: req.body.status } });
    await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: req.body.status } });
    return result;
  });
  res.json({ success: true, data: updated });
}));

module.exports = router;
