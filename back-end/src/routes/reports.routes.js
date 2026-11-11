const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize, requireActiveRecruiterCompany } = require('../middleware/auth');

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
const REPORT_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 2_000,
  timeout: 5_000,
  isolationLevel: 'ReadCommitted'
});
const REPORT_LOCK_RETRY_ATTEMPTS = 8;
const REPORT_LOCK_RETRY_DELAY_MS = 10;

class ReportLockContentionError extends Error {
  constructor(cause) {
    super('Reporter row is currently locked', { cause });
    this.name = 'ReportLockContentionError';
  }
}

function isReportTransactionContention(error) {
  const codes = [
    error?.code,
    error?.meta?.code,
    error?.meta?.driverAdapterError?.cause?.code,
    error?.cause?.code
  ].filter(Boolean).map(String);
  return codes.some((code) => ['P2028', 'P2034', '1205', '1213', '3572', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ER_LOCK_NOWAIT'].includes(code));
}

async function createReportAtomic({ reporterUserId, targetType, targetId, reason, description, now = new Date() }, client = prisma, dependencies = {}) {
  const transactionOptions = dependencies.transactionOptions || REPORT_TRANSACTION_OPTIONS;
  const lockAttempts = dependencies.lockAttempts || REPORT_LOCK_RETRY_ATTEMPTS;
  const waitImpl = dependencies.waitImpl || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < lockAttempts; attempt += 1) {
    try {
      return await client.$transaction(async (transaction) => {
        let lockedReporter;
        try {
          lockedReporter = await transaction.$queryRaw`SELECT id FROM users WHERE id = ${reporterUserId} FOR UPDATE NOWAIT`;
        } catch (error) {
          if (isReportTransactionContention(error)) throw new ReportLockContentionError(error);
          throw error;
        }
        if (!lockedReporter.length) throw new ApiError(401, 'Tài khoản không còn khả dụng');

        const since = new Date(now.getTime() - 60 * 60 * 1000);
        const recentCount = await transaction.report.count({
          where: { reporterUserId, createdAt: { gte: since } }
        });
        if (recentCount >= 5) throw new ApiError(429, 'Bạn đã gửi quá nhiều báo cáo, vui lòng thử lại sau');

        const duplicate = await transaction.report.findFirst({
          where: {
            reporterUserId,
            targetType,
            ...(targetType === 'JOB' ? { jobId: targetId } : { companyId: targetId }),
            status: { in: ['PENDING', 'REVIEWING'] }
          },
          select: { id: true }
        });
        if (duplicate) throw new ApiError(409, 'Bạn đã có báo cáo đang được xử lý cho nội dung này');

        return transaction.report.create({
          data: {
            reporterUserId,
            targetType,
            reason,
            description: description || null,
            ...(targetType === 'JOB' ? { jobId: targetId } : { companyId: targetId })
          },
          select: { id: true, targetType: true, reason: true, status: true, createdAt: true }
        });
      }, transactionOptions);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof ReportLockContentionError && attempt + 1 < lockAttempts) {
        await waitImpl(REPORT_LOCK_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      if (error instanceof ReportLockContentionError || isReportTransactionContention(error)) {
        throw new ApiError(409, 'Một yêu cầu báo cáo khác đang được xử lý, vui lòng thử lại');
      }
      throw error;
    }
  }
  throw new ApiError(409, 'Một yêu cầu báo cáo khác đang được xử lý, vui lòng thử lại');
}

router.use(authenticate, authorize('CANDIDATE', 'RECRUITER'), requireActiveRecruiterCompany);

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const { targetType, targetId, reason, description } = req.body;
  const targetWhere = { id: targetId, ...(targetType === 'JOB' ? { status: 'PUBLISHED', company: { status: 'ACTIVE' } } : { status: 'ACTIVE' }) };
  const target = targetType === 'JOB'
    ? await prisma.job.findFirst({ where: targetWhere, select: { id: true } })
    : await prisma.company.findFirst({ where: targetWhere, select: { id: true } });
  if (!target) throw new ApiError(404, 'Không tìm thấy nội dung có thể báo cáo');

  const report = await createReportAtomic({ reporterUserId: req.user.id, targetType, targetId, reason, description });
  res.status(201).json({ success: true, data: report, message: 'Báo cáo đã được gửi đến quản trị viên' });
}));

module.exports = router;
module.exports.createSchema = createSchema;
module.exports.createReportAtomic = createReportAtomic;
module.exports.isReportTransactionContention = isReportTransactionContention;
module.exports.REPORT_TRANSACTION_OPTIONS = REPORT_TRANSACTION_OPTIONS;
