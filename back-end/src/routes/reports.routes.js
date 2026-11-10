const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const createSchema = z.object({
  body: z.object({
    targetType: z.enum(['JOB', 'COMPANY']),
    targetId: z.coerce.number().int().positive(),
    reason: z.enum(['SPAM', 'MISLEADING', 'DISCRIMINATION', 'FRAUD', 'OTHER']),
    description: z.string().trim().max(2000).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const router = require('express').Router();
router.use(authenticate, authorize('CANDIDATE', 'RECRUITER'));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const { targetType, targetId, reason, description } = req.body;
  const targetWhere = { id: targetId, ...(targetType === 'JOB' ? { status: 'PUBLISHED', company: { status: 'ACTIVE' } } : { status: 'ACTIVE' }) };
  const target = targetType === 'JOB'
    ? await prisma.job.findFirst({ where: targetWhere, select: { id: true } })
    : await prisma.company.findFirst({ where: targetWhere, select: { id: true } });
  if (!target) throw new ApiError(404, 'Không tìm thấy nội dung có thể báo cáo');

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [recentCount, duplicate] = await Promise.all([
    prisma.report.count({ where: { reporterUserId: req.user.id, createdAt: { gte: since } } }),
    prisma.report.findFirst({
      where: {
        reporterUserId: req.user.id,
        targetType,
        ...(targetType === 'JOB' ? { jobId: targetId } : { companyId: targetId }),
        status: { in: ['PENDING', 'REVIEWING'] }
      },
      select: { id: true }
    })
  ]);
  if (recentCount >= 5) throw new ApiError(429, 'Bạn đã gửi quá nhiều báo cáo, vui lòng thử lại sau');
  if (duplicate) throw new ApiError(409, 'Bạn đã có báo cáo đang được xử lý cho nội dung này');

  const report = await prisma.report.create({
    data: {
      reporterUserId: req.user.id,
      targetType,
      reason,
      description: description || null,
      ...(targetType === 'JOB' ? { jobId: targetId } : { companyId: targetId })
    },
    select: { id: true, targetType: true, reason: true, status: true, createdAt: true }
  });
  res.status(201).json({ success: true, data: report, message: 'Báo cáo đã được gửi đến quản trị viên' });
}));

module.exports = router;
module.exports.createSchema = createSchema;
