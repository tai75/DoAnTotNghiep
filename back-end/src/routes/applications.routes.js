const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const config = require('../config/env');
const { calculateMatchScore, buildRuleExplanation } = require('../services/matching.service');
const { sendEmail } = require('../services/mail.service');
const {
  assertExpectedStatus,
  applyApplicationTransition
} = require('../services/applicationState.service');
const { cancelActiveInterviewsForTerminalApplication } = require('../services/interview.service');

const applicationStatusSchema = z.enum(['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']);

const applySchema = z.object({
  body: z.object({
    coverLetter: z.string().max(5000).optional(),
    resumeId: z.coerce.number().int().positive().optional(),
    answers: z.array(z.object({
      questionId: z.coerce.number().int().positive(),
      answer: z.union([z.string(), z.number(), z.boolean()]).transform(String)
    })).default([])
  }),
  params: z.object({ jobId: z.coerce.number().int().positive() }),
  query: z.object({})
});

const statusSchema = z.object({
  body: z.object({
    status: z.enum(['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED']),
    note: z.string().max(2000).optional(),
    expectedStatus: applicationStatusSchema
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const withdrawSchema = z.object({
  body: z.object({
    expectedStatus: applicationStatusSchema
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const recruiterListSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    jobId: z.coerce.number().int().positive().optional(),
    status: z.enum(['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']).optional(),
    minScore: z.coerce.number().min(0).max(100).optional(),
    sort: z.enum(['newest', 'score']).default('newest'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const bulkRejectSchema = z.object({
  body: z.object({
    applicationIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
    expectedStatuses: z.record(applicationStatusSchema),
    message: z.string().max(2000).optional()
  }).superRefine((body, context) => {
    for (const applicationId of body.applicationIds) {
      if (!Object.prototype.hasOwnProperty.call(body.expectedStatuses, String(applicationId))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedStatuses', String(applicationId)], message: 'expectedStatus is required' });
      }
    }
  }),
  params: z.object({}), query: z.object({})
});
const noteSchema = z.object({
  body: z.object({ content: z.string().trim().min(1).max(5000) }),
  params: z.object({ id: z.coerce.number().int().positive() }), query: z.object({})
});
const noteIdSchema = z.object({
  body: z.object({}), params: z.object({ id: z.coerce.number().int().positive(), noteId: z.coerce.number().int().positive() }), query: z.object({})
});

const router = require('express').Router();

function applicationForViewer(application, isCandidate) {
  if (!isCandidate) return application;
  const { notes, ...candidateView } = application;
  return candidateView;
}

async function sendStatusEmailBestEffort({ applicationId, email, jobTitle, status }) {
  if (!email) return;
  try {
    await sendEmail({
      to: email,
      subject: `Cập nhật đơn ứng tuyển: ${jobTitle}`,
      text: `Đơn ứng tuyển của bạn đã chuyển sang trạng thái ${status}. Xem chi tiết tại ${config.frontendUrl}/my-jobs?tab=applied`
    });
  } catch (error) {
    console.warn('[application-status-email] delivery failed after commit', {
      applicationId,
      status,
      errorName: error?.name || 'Error'
    });
  }
}

router.post('/jobs/:jobId', authenticate, authorize('CANDIDATE'), validate(applySchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id }, include: { skills: { include: { skill: true } } } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  const job = await prisma.job.findFirst({
    where: { id: req.params.jobId, status: 'PUBLISHED', company: { status: 'ACTIVE' }, OR: [{ deadline: { gte: new Date() } }, { deadline: null }] },
    include: { skills: { include: { skill: true } }, screeningQuestions: { orderBy: { id: 'asc' } } }
  });
  if (!job) throw new ApiError(404, 'Việc làm không tồn tại hoặc đã hết hạn');
  const existing = await prisma.application.findUnique({ where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } } });
  if (existing) throw new ApiError(409, 'Bạn đã ứng tuyển vào việc làm này');
  const answersByQuestion = new Map(req.body.answers.map((item) => [item.questionId, item.answer.trim()]));
  const questionIds = new Set(job.screeningQuestions.map((question) => question.id));
  if ([...answersByQuestion.keys()].some((questionId) => !questionIds.has(questionId))) throw new ApiError(400, 'Câu trả lời không thuộc về việc làm này');
  for (const question of job.screeningQuestions) {
    const answer = answersByQuestion.get(question.id);
    if (question.isRequired && !answer) throw new ApiError(400, `Vui lòng trả lời: ${question.question}`);
    if (!answer) continue;
    if (question.type === 'YES_NO' && !['true', 'false', 'yes', 'no', 'Có', 'Không'].includes(answer)) throw new ApiError(400, `Câu trả lời không hợp lệ: ${question.question}`);
    if (question.type === 'NUMBER' && !Number.isFinite(Number(answer))) throw new ApiError(400, `Câu trả lời phải là số: ${question.question}`);
    if (question.type === 'TEXT' && answer.length > 5000) throw new ApiError(400, `Câu trả lời quá dài: ${question.question}`);
    if (question.type === 'SINGLE_CHOICE' && (!Array.isArray(question.options) || !question.options.map(String).includes(answer))) throw new ApiError(400, `Lựa chọn không hợp lệ: ${question.question}`);
  }
  let resumePathSnapshot;
  if (req.body.resumeId) {
    const resume = await prisma.candidateResume.findFirst({ where: { id: req.body.resumeId, candidateId: candidate.id } });
    if (!resume) throw new ApiError(400, 'CV không thuộc về ứng viên');
    resumePathSnapshot = resume.path;
  }
  const application = await prisma.$transaction(async (transaction) => {
    const match = calculateMatchScore(candidate, job);
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
    if (answersByQuestion.size) {
      await transaction.applicationAnswer.createMany({
        data: [...answersByQuestion.entries()].map(([questionId, answer]) => ({ applicationId: result.id, questionId, answer }))
      });
    }
    await transaction.matchScore.upsert({
      where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
      create: {
        candidateId: candidate.id,
        jobId: job.id,
        applicationId: result.id,
        score: match.score,
        skillScore: match.skillScore,
        experienceScore: match.experienceScore,
        positionScore: match.positionScore,
        locationScore: match.locationScore,
        salaryScore: match.salaryScore,
        employmentScore: match.employmentScore,
        matchedSkills: match.matchedSkills,
        missingSkills: match.missingSkills,
        explanation: buildRuleExplanation(match),
        computedAt: new Date(),
        algorithmVersion: 'weighted-v1'
      },
      update: {
        applicationId: result.id,
        score: match.score,
        skillScore: match.skillScore,
        experienceScore: match.experienceScore,
        positionScore: match.positionScore,
        locationScore: match.locationScore,
        salaryScore: match.salaryScore,
        employmentScore: match.employmentScore,
        matchedSkills: match.matchedSkills,
        missingSkills: match.missingSkills,
        explanation: buildRuleExplanation(match),
        computedAt: new Date(),
        algorithmVersion: 'weighted-v1'
      }
    });
    const recruiters = await transaction.recruiter.findMany({ where: { companyId: job.companyId }, select: { userId: true } });
    if (recruiters.length) {
      await transaction.notification.createMany({
        data: recruiters.map(({ userId }) => ({
          userId,
          type: 'NEW_APPLICATION',
          title: 'Có đơn ứng tuyển mới',
          content: `Có ứng viên mới ứng tuyển vào vị trí ${job.title}.`,
          link: `/recruiter?section=applications&applicationId=${result.id}`
        }))
      });
    }
    return transaction.application.findUnique({ where: { id: result.id }, include: { job: true, resume: true, history: true, answers: true, matchScore: true } });
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
  const { jobId, status, minScore, sort, page, limit } = req.query;
  const where = {
    ...(jobId ? { jobId } : {}),
    ...(status ? { status } : {}),
    job: { companyId: recruiter.companyId }
  };
  if (minScore !== undefined) where.matchScore = { score: { gte: minScore } };
  const orderBy = sort === 'score' ? { matchScore: { score: 'desc' } } : { appliedAt: 'desc' };
  const [items, total] = await prisma.$transaction([
    prisma.application.findMany({
      where,
      include: { candidate: { include: { user: { select: { id: true, fullName: true, phone: true } }, skills: { include: { skill: true } }, educations: true, experiences: true, projects: true } }, resume: true, job: true, history: { orderBy: { createdAt: 'asc' } }, matchScore: true, answers: { include: { question: true } }, notes: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } } },
      orderBy,
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.application.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.post('/managed/bulk-reject', authenticate, authorize('RECRUITER'), validate(bulkRejectSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const applicationIds = [...new Set(req.body.applicationIds)];
  const applications = await prisma.application.findMany({
    where: { id: { in: applicationIds }, job: { companyId: recruiter.companyId } },
    include: { job: true, candidate: { select: { userId: true } } }
  });
  if (applications.length !== applicationIds.length) throw new ApiError(403, 'Một số hồ sơ không thuộc công ty của bạn');
  for (const application of applications) {
    if (application.status !== 'REJECTED') assertExpectedStatus(application, req.body.expectedStatuses[String(application.id)]);
  }
  const updated = await prisma.$transaction(async (transaction) => {
    const changedIds = [];
    for (const application of applications) {
      const transition = await applyApplicationTransition(transaction, {
        application,
        targetStatus: 'REJECTED',
        actor: 'RECRUITER'
      });
      if (!transition.changed) continue;
      await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: 'REJECTED', note: req.body.message } });
      await cancelActiveInterviewsForTerminalApplication(transaction, { ...application, status: 'REJECTED' }, req.body.message);
      await transaction.notification.create({ data: { userId: application.candidate.userId, type: 'APPLICATION_STATUS_CHANGED', title: 'Đơn ứng tuyển được cập nhật', content: req.body.message || `Đơn ứng tuyển vị trí ${application.job.title} đã bị từ chối.`, link: '/my-jobs?tab=applied' } });
      changedIds.push(application.id);
    }
    return changedIds;
  });
  res.json({ success: true, data: { applicationIds: updated } });
}));

router.post('/:id/notes', authenticate, authorize('RECRUITER'), validate(noteSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const application = await prisma.application.findUnique({ where: { id: req.params.id }, include: { job: true } });
  if (!recruiter || !application || application.job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  const note = await prisma.applicationNote.create({ data: { applicationId: application.id, authorUserId: req.user.id, content: req.body.content }, include: { author: { select: { id: true, fullName: true } } } });
  res.status(201).json({ success: true, data: note });
}));

router.delete('/:id/notes/:noteId', authenticate, authorize('RECRUITER'), validate(noteIdSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const note = await prisma.applicationNote.findUnique({ where: { id: req.params.noteId }, include: { application: { include: { job: true } } } });
  if (!recruiter || !note || note.application.job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  await prisma.applicationNote.delete({ where: { id: note.id } });
  res.json({ success: true });
}));

router.get('/:id', authenticate, validate(idSchema), asyncHandler(async (req, res) => {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { candidate: { include: { user: { select: { id: true, fullName: true, phone: true } }, skills: { include: { skill: true } }, educations: true, experiences: true, projects: true } }, resume: true, job: { include: { company: true } }, history: { orderBy: { createdAt: 'asc' } }, matchScore: true, answers: { include: { question: true } }, notes: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } } }
  });
  if (!application) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  const isCandidate = req.user.role === 'CANDIDATE' && application.candidate.userId === req.user.id;
  let isRecruiter = false;
  if (req.user.role === 'RECRUITER') {
    const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
    isRecruiter = recruiter && recruiter.companyId === application.job.companyId;
  }
  if (!isCandidate && !isRecruiter) throw new ApiError(403, 'Bạn không có quyền xem hồ sơ này');
  res.json({ success: true, data: applicationForViewer(application, isCandidate) });
}));

router.patch('/:id/withdraw', authenticate, authorize('CANDIDATE'), validate(withdrawSchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  const application = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!application || !candidate || application.candidateId !== candidate.id) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  if (application.status !== 'WITHDRAWN') assertExpectedStatus(application, req.body.expectedStatus);
  const updated = await prisma.$transaction(async (transaction) => {
    const transition = await applyApplicationTransition(transaction, {
      application,
      targetStatus: 'WITHDRAWN',
      actor: 'CANDIDATE'
    });
    if (!transition.changed) return transition.application;
    await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: 'WITHDRAWN' } });
    await cancelActiveInterviewsForTerminalApplication(transaction, { ...application, status: 'WITHDRAWN' }, 'Ứng viên đã rút hồ sơ ứng tuyển.');
    const recruiterUsers = await transaction.recruiter.findMany({ where: { company: { jobs: { some: { id: application.jobId } } } }, select: { userId: true } });
    if (recruiterUsers.length) await transaction.notification.createMany({ data: recruiterUsers.map(({ userId }) => ({ userId, type: 'APPLICATION_STATUS_CHANGED', title: 'Ứng viên đã rút hồ sơ', content: 'Một ứng viên đã rút hồ sơ ứng tuyển.', link: `/recruiter?section=applications&applicationId=${application.id}` })) });
    return transition.application;
  });
  res.json({ success: true, data: updated });
}));

router.patch('/:id/status', authenticate, authorize('RECRUITER'), validate(statusSchema), asyncHandler(async (req, res) => {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { job: true, candidate: { include: { user: { select: { id: true, email: true } } } } }
  });
  if (!application) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển');
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  if (application.job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  if (application.status !== req.body.status) assertExpectedStatus(application, req.body.expectedStatus);
  const updated = await prisma.$transaction(async (transaction) => {
    const transition = await applyApplicationTransition(transaction, {
      application,
      targetStatus: req.body.status,
      actor: 'RECRUITER'
    });
    if (!transition.changed) {
      return { result: transition.application, email: null, changed: false };
    }
    await transaction.applicationStatusHistory.create({ data: { applicationId: application.id, fromStatus: application.status, toStatus: req.body.status, note: req.body.note } });
    await cancelActiveInterviewsForTerminalApplication(transaction, { ...application, status: req.body.status }, req.body.note);
    await transaction.notification.create({
      data: {
        userId: application.candidate.userId,
        type: 'APPLICATION_STATUS_CHANGED',
        title: 'Đơn ứng tuyển được cập nhật',
        content: `Đơn ứng tuyển vị trí ${application.job.title} đã chuyển sang trạng thái ${req.body.status}.`,
        link: `/my-jobs?tab=applied`
      }
    });
    return { result: transition.application, email: application.candidate.user.email, changed: true };
  });
  if (updated.changed) {
    await sendStatusEmailBestEffort({
      applicationId: application.id,
      email: updated.email,
      jobTitle: application.job.title,
      status: req.body.status
    });
  }
  res.json({ success: true, data: updated.result });
}));

module.exports = router;
module.exports.applySchema = applySchema;
module.exports.applicationForViewer = applicationForViewer;
