const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');

const router = require('express').Router();
router.use(authenticate, authorize('RECRUITER'));

router.get('/stats', asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');

  const jobs = await prisma.job.findMany({
    where: { companyId: recruiter.companyId },
    select: { id: true, title: true, status: true, _count: { select: { applications: true } } },
    orderBy: { updatedAt: 'desc' }
  });
  const applications = await prisma.application.findMany({
    where: { job: { companyId: recruiter.companyId } },
    select: { status: true, appliedAt: true }
  });
  const byStatus = applications.reduce((result, application) => {
    result[application.status] = (result[application.status] || 0) + 1;
    return result;
  }, {});
  const byDay = applications.reduce((result, application) => {
    const date = application.appliedAt.toISOString().slice(0, 10);
    result[date] = (result[date] || 0) + 1;
    return result;
  }, {});
  const timeline = Object.entries(byDay).sort(([first], [second]) => first.localeCompare(second)).slice(-30).map(([date, count]) => ({ date, count }));

  res.json({
    success: true,
    data: {
      jobsByStatus: jobs.reduce((result, job) => {
        result[job.status] = (result[job.status] || 0) + 1;
        return result;
      }, {}),
      applicationsTotal: applications.length,
      applicationsByStatus: byStatus,
      applicationsByJob: jobs.map(({ id, title, _count }) => ({ id, title, count: _count.applications })),
      timeline
    }
  });
}));

module.exports = router;
