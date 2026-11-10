const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, requireActiveRecruiterCompany } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { calculateMatchScore } = require('../services/matching.service');
const { z } = require('zod');

const router = require('express').Router();
router.use(authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany);

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

const talentQuery = z.object({
 skillIds: z.string().optional(), location: z.string().max(150).optional(),
 minExperience: z.coerce.number().min(0).optional(), maxExperience: z.coerce.number().min(0).optional(),
 desiredPosition: z.string().max(180).optional(), employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID']).optional(),
 minSalary: z.coerce.number().min(0).optional(), maxSalary: z.coerce.number().min(0).optional(), jobId: z.coerce.number().int().positive().optional()
});
const talentSchema = z.object({ body: z.object({}), params: z.object({}), query: talentQuery });
const savedSearchSchema = z.object({
 body: z.object({ name: z.string().trim().min(1).max(150), filters: talentQuery }),
 params: z.object({}), query: z.object({})
});
const idSchema = z.object({ body: z.object({}), params: z.object({ id: z.coerce.number().int().positive() }), query: z.object({}) });
const inviteSchema = z.object({
 body: z.object({ candidateId: z.coerce.number().int().positive(), jobId: z.coerce.number().int().positive(), message: z.string().trim().max(2000).optional() }),
 params: z.object({}), query: z.object({})
});
const funnelSchema = z.object({ body: z.object({}), params: z.object({ jobId: z.coerce.number().int().positive() }), query: z.object({}) });

router.get('/talent', validate(talentSchema), asyncHandler(async (req, res) => {
 const filters = req.query;
 const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
 if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
 const skillIds = (filters.skillIds || '').split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0);
 const where = { isSearchable: true, ...(skillIds.length ? { AND: skillIds.map((skillId) => ({ skills: { some: { skillId } } })) } : {}), ...(filters.location ? { OR: [{ location: { contains: filters.location } }, { desiredLocation: { contains: filters.location } }] } : {}), ...(filters.desiredPosition ? { desiredPosition: { contains: filters.desiredPosition } } : {}), ...(filters.employmentType ? { desiredEmploymentType: filters.employmentType } : {}), ...(filters.minExperience !== undefined || filters.maxExperience !== undefined ? { yearsExperience: { ...(filters.minExperience !== undefined ? { gte: filters.minExperience } : {}), ...(filters.maxExperience !== undefined ? { lte: filters.maxExperience } : {}) } } : {}), ...(filters.minSalary !== undefined || filters.maxSalary !== undefined ? { desiredSalary: { ...(filters.minSalary !== undefined ? { gte: filters.minSalary } : {}), ...(filters.maxSalary !== undefined ? { lte: filters.maxSalary } : {}) } } : {}) };
 let job = null;
 if (filters.jobId) {
   job = await prisma.job.findFirst({ where: { id: filters.jobId, companyId: recruiter.companyId }, include: { skills: { include: { skill: true } } } });
   if (!job) throw new ApiError(404, 'Không tìm thấy việc làm thuộc công ty của bạn');
 }
 const candidates = await prisma.candidate.findMany({ where, include: { skills: { include: { skill: true } }, user: { select: { fullName: true, email: true, phone: true } }, applications: { where: job ? { jobId: job.id } : { job: { companyId: recruiter.companyId } }, select: { id: true } }, talentInvitations: { where: { recruiterUserId: req.user.id, ...(job ? { jobId: job.id } : {}) }, select: { id: true, jobId: true, status: true, createdAt: true, respondedAt: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { updatedAt: 'desc' } });
 const items = candidates.map((candidate) => {
   const applied = candidate.applications.length > 0;
   const invitedAccepted = candidate.talentInvitations.some(({ status }) => status === 'ACCEPTED');
   return { id: candidate.id, fullName: candidate.user.fullName, headline: candidate.headline, desiredPosition: candidate.desiredPosition, location: candidate.location, yearsExperience: candidate.yearsExperience, desiredSalary: candidate.desiredSalary, desiredEmploymentType: candidate.desiredEmploymentType, skills: candidate.skills, match: job ? calculateMatchScore(candidate, job) : null, applied, invitation: job ? (candidate.talentInvitations[0] || null) : null, invitedAccepted, contact: applied || invitedAccepted ? { email: candidate.user.email, phone: candidate.user.phone } : null };
 }).sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
 res.json({ success: true, data: { job, items } });
}));

router.get('/talent/searches', asyncHandler(async (req, res) => {
 res.json({ success: true, data: await prisma.recruiterSavedSearch.findMany({ where: { recruiterUserId: req.user.id }, orderBy: { updatedAt: 'desc' } }) });
}));
router.post('/talent/searches', validate(savedSearchSchema), asyncHandler(async (req, res) => {
 res.status(201).json({ success: true, data: await prisma.recruiterSavedSearch.create({ data: { recruiterUserId: req.user.id, name: req.body.name, filters: req.body.filters } }) });
}));
router.delete('/talent/searches/:id', validate(idSchema), asyncHandler(async (req, res) => {
 const result = await prisma.recruiterSavedSearch.deleteMany({ where: { id: req.params.id, recruiterUserId: req.user.id } });
 if (!result.count) throw new ApiError(404, 'Không tìm thấy tìm kiếm đã lưu');
 res.json({ success: true });
}));
router.post('/talent/invite', validate(inviteSchema), asyncHandler(async (req, res) => {
 const { candidateId, jobId } = req.body;
 const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
 const job = await prisma.job.findFirst({ where: { id: jobId, companyId: recruiter?.companyId } });
 const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
 if (!recruiter || !job || !candidate || !candidate.isSearchable) throw new ApiError(404, 'Không tìm thấy ứng viên hoặc việc làm');
 if (job.status !== 'PUBLISHED' || (job.deadline && job.deadline <= new Date())) throw new ApiError(409, 'Chỉ có thể gửi lời mời cho việc làm đang đăng tuyển và còn hạn');
 const message = String(req.body.message || '').trim() || null;
 const existing = await prisma.talentInvitation.findUnique({ where: { candidateId_recruiterUserId_jobId: { candidateId, recruiterUserId: req.user.id, jobId } } });
 if (existing?.status === 'PENDING') return res.json({ success: true, data: { ...existing, idempotent: true } });
 if (existing) throw new ApiError(409, 'Ứng viên đã phản hồi lời mời cho việc làm này');
 try {
   const invitation = await prisma.$transaction(async (transaction) => {
     const created = await transaction.talentInvitation.create({ data: { candidateId, recruiterUserId: req.user.id, jobId, message } });
     await transaction.notification.create({ data: { userId: candidate.userId, type: 'TALENT_INVITATION', title: 'Bạn được mời ứng tuyển', content: message || `Nhà tuyển dụng mời bạn ứng tuyển vị trí ${job.title}.`, link: `/invitations/${created.id}` } });
     return created;
   });
   res.status(201).json({ success: true, data: { ...invitation, idempotent: false } });
 } catch (error) {
   if (error?.code !== 'P2002') throw error;
   const duplicate = await prisma.talentInvitation.findUnique({ where: { candidateId_recruiterUserId_jobId: { candidateId, recruiterUserId: req.user.id, jobId } } });
   if (duplicate?.status === 'PENDING') return res.json({ success: true, data: { ...duplicate, idempotent: true } });
   throw new ApiError(409, 'Ứng viên đã phản hồi lời mời cho việc làm này');
 }
}));

router.get('/funnel/:jobId', validate(funnelSchema), asyncHandler(async (req, res) => {
 const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
 const job = await prisma.job.findFirst({ where: { id: req.params.jobId, companyId: recruiter?.companyId } });
 if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
 const applications = await prisma.application.findMany({ where: { jobId: job.id }, select: { history: { select: { toStatus: true } } } });
 const hasStage = (stage) => applications.filter((item) => item.history.some((entry) => entry.toStatus === stage)).length;
 res.json({ success: true, data: { job: { id: job.id, title: job.title }, funnel: [{ stage: 'Lượt xem', value: await prisma.jobView.count({ where: { jobId: job.id } }) }, { stage: 'Nộp hồ sơ', value: applications.length }, { stage: 'Vào vòng trong', value: hasStage('SHORTLISTED') }, { stage: 'Phỏng vấn', value: hasStage('INTERVIEWING') }, { stage: 'Đề nghị nhận việc', value: hasStage('OFFERED') }] } });
}));

module.exports = router;
