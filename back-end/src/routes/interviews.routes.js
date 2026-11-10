const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize, requireActiveRecruiterCompany } = require('../middleware/auth');
const {
  TERMINAL_APPLICATION_STATUSES, assertModeDetails, parseSchedule, notify,
  moveApplicationToInterviewing, claimInterview
} = require('../services/interview.service');

const router = require('express').Router();
const statuses = ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'DECLINED', 'CANCELLED', 'COMPLETED'];
const idParams = z.object({ id: z.coerce.number().int().positive() });
const scheduleFields = {
  scheduledStart: z.string().datetime({ offset: true }),
  scheduledEnd: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(100),
  mode: z.enum(['ONLINE', 'ONSITE']),
  location: z.string().trim().max(500).optional().nullable(),
  meetingUrl: z.string().trim().max(1000).optional().nullable(),
  candidateInstructions: z.string().trim().max(5000).optional().nullable(),
  recruiterNote: z.string().trim().max(5000).optional().nullable()
};
const createSchema = z.object({ body: z.object({ applicationId: z.coerce.number().int().positive(), requestKey: z.string().uuid(), ...scheduleFields }), params: z.object({}), query: z.object({}) });
const updateSchema = z.object({ body: z.object({ expectedVersion: z.coerce.number().int().positive(), ...scheduleFields }), params: idParams, query: z.object({}) });
const actionSchema = z.object({ body: z.object({ expectedVersion: z.coerce.number().int().positive(), note: z.string().trim().max(5000).optional().nullable() }), params: idParams, query: z.object({}) });
const proposalSchema = z.object({ body: z.object({ expectedVersion: z.coerce.number().int().positive(), proposedStart: z.string().datetime({ offset: true }), proposedEnd: z.string().datetime({ offset: true }), timezone: z.string().trim().min(1).max(100), note: z.string().trim().max(5000).optional().nullable() }), params: idParams, query: z.object({}) });
const listSchema = z.object({ body: z.object({}), params: z.object({}), query: z.object({ status: z.enum(statuses).optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(20), sort: z.enum(['asc', 'desc']).default('asc') }) });
const emptyQuery = z.object({ body: z.object({}), params: idParams, query: z.object({}) });

const include = {
  application: { include: { job: { include: { company: true } }, candidate: { include: { user: { select: { id: true, fullName: true } } } } } },
  recruiter: { select: { id: true, fullName: true } }
};

function candidateView(interview) {
  const { recruiterNote, requestKey, ...safe } = interview;
  return safe;
}

async function recruiterIdentity(userId) {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng.');
  return recruiter;
}

async function recruiterInterview(userId, id) {
  const recruiter = await recruiterIdentity(userId);
  const interview = await prisma.interview.findUnique({ where: { id }, include });
  if (!interview || interview.application.job.companyId !== recruiter.companyId) throw new ApiError(404, 'Không tìm thấy lịch phỏng vấn.');
  return interview;
}

async function candidateInterview(userId, id) {
  const candidate = await prisma.candidate.findUnique({ where: { userId } });
  const interview = await prisma.interview.findUnique({ where: { id }, include });
  if (!candidate || !interview || interview.application.candidateId !== candidate.id) throw new ApiError(404, 'Không tìm thấy lịch phỏng vấn.');
  return interview;
}

router.post('/recruiter', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, validate(createSchema), asyncHandler(async (req, res) => {
  assertModeDetails(req.body);
  const { start, end } = parseSchedule(req.body);
  const recruiter = await recruiterIdentity(req.user.id);
  const existing = await prisma.interview.findUnique({ where: { requestKey: req.body.requestKey }, include });
  if (existing) {
    if (existing.recruiterUserId !== req.user.id || existing.applicationId !== req.body.applicationId) throw new ApiError(409, 'Khóa yêu cầu đã được sử dụng.');
    return res.json({ success: true, data: existing, meta: { idempotentReplay: true } });
  }
  const application = await prisma.application.findUnique({ where: { id: req.body.applicationId }, include: { job: true, candidate: { select: { userId: true } } } });
  if (!application || application.job.companyId !== recruiter.companyId) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng tuyển.');
  if (TERMINAL_APPLICATION_STATUSES.has(application.status) || application.status === 'OFFERED') throw new ApiError(409, 'Không thể đặt lịch cho hồ sơ ở trạng thái hiện tại.');
  let interview;
  let statusCode = 201;
  try {
    interview = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM applications WHERE id = ${application.id} FOR UPDATE`;
      const currentApplication = await transaction.application.findUnique({ where: { id: application.id } });
      if (!currentApplication || TERMINAL_APPLICATION_STATUSES.has(currentApplication.status) || currentApplication.status === 'OFFERED') throw new ApiError(409, 'Không thể đặt lịch cho hồ sơ ở trạng thái hiện tại.');
      await moveApplicationToInterviewing(transaction, currentApplication);
      const latest = await transaction.interview.findFirst({ where: { applicationId: application.id }, orderBy: { round: 'desc' }, select: { round: true } });
      const created = await transaction.interview.create({ data: {
        applicationId: application.id, recruiterUserId: req.user.id, round: (latest?.round || 0) + 1,
        scheduledStart: start, scheduledEnd: end, timezone: req.body.timezone, mode: req.body.mode,
        location: req.body.mode === 'ONSITE' ? req.body.location : null,
        meetingUrl: req.body.mode === 'ONLINE' ? req.body.meetingUrl : null,
        candidateInstructions: req.body.candidateInstructions, recruiterNote: req.body.recruiterNote,
        requestKey: req.body.requestKey
      } });
      await notify(transaction, { userId: application.candidate.userId, type: 'INTERVIEW_SCHEDULED', title: 'Bạn có lịch phỏng vấn mới', content: `Vòng ${created.round} cho vị trí ${application.job.title} đang chờ bạn phản hồi.`, role: 'CANDIDATE', interviewId: created.id });
      return transaction.interview.findUnique({ where: { id: created.id }, include });
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    interview = await prisma.interview.findUnique({ where: { requestKey: req.body.requestKey }, include });
    if (!interview || interview.recruiterUserId !== req.user.id || interview.applicationId !== req.body.applicationId) throw new ApiError(409, 'Khóa yêu cầu đã được sử dụng.');
    statusCode = 200;
  }
  res.status(statusCode).json({ success: true, data: interview, ...(statusCode === 200 ? { meta: { idempotentReplay: true } } : {}) });
}));

router.get('/recruiter', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, validate(listSchema), asyncHandler(async (req, res) => {
  const recruiter = await recruiterIdentity(req.user.id);
  const { status, from, to, page, limit, sort } = req.query;
  const where = { application: { job: { companyId: recruiter.companyId } }, ...(status ? { status } : {}), ...((from || to) ? { scheduledStart: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
  const [items, total] = await prisma.$transaction([prisma.interview.findMany({ where, include, orderBy: { scheduledStart: sort }, skip: (page - 1) * limit, take: limit }), prisma.interview.count({ where })]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/recruiter/:id', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, validate(emptyQuery), asyncHandler(async (req, res) => res.json({ success: true, data: await recruiterInterview(req.user.id, req.params.id) })));

router.patch('/recruiter/:id', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, validate(updateSchema), asyncHandler(async (req, res) => {
  assertModeDetails(req.body); const { start, end } = parseSchedule(req.body);
  const interview = await recruiterInterview(req.user.id, req.params.id);
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await claimInterview(transaction, interview, { expectedVersion: req.body.expectedVersion, update: { scheduledStart: start, scheduledEnd: end, timezone: req.body.timezone, mode: req.body.mode, location: req.body.mode === 'ONSITE' ? req.body.location : null, meetingUrl: req.body.mode === 'ONLINE' ? req.body.meetingUrl : null, candidateInstructions: req.body.candidateInstructions, recruiterNote: req.body.recruiterNote, candidateResponseNote: null, proposedStart: null, proposedEnd: null, status: 'PENDING_RESPONSE' } }, ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED']);
    await notify(transaction, { userId: interview.application.candidate.userId, type: 'INTERVIEW_RESCHEDULED', title: 'Lịch phỏng vấn đã được cập nhật', content: `Lịch vòng ${interview.round} cho vị trí ${interview.application.job.title} đã thay đổi và đang chờ phản hồi.`, role: 'CANDIDATE', interviewId: interview.id });
    return transaction.interview.findUnique({ where: { id: result.id }, include });
  });
  res.json({ success: true, data: updated });
}));

router.post('/recruiter/:id/cancel', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, validate(actionSchema), asyncHandler(async (req, res) => {
  const interview = await recruiterInterview(req.user.id, req.params.id);
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await claimInterview(transaction, interview, { expectedVersion: req.body.expectedVersion, update: { status: 'CANCELLED', recruiterNote: req.body.note || interview.recruiterNote } }, ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED']);
    await notify(transaction, { userId: interview.application.candidate.userId, type: 'INTERVIEW_CANCELLED', title: 'Lịch phỏng vấn đã hủy', content: req.body.note || `Lịch vòng ${interview.round} cho vị trí ${interview.application.job.title} đã được hủy.`, role: 'CANDIDATE', interviewId: interview.id });
    return transaction.interview.findUnique({ where: { id: result.id }, include });
  });
  res.json({ success: true, data: updated });
}));

router.post('/recruiter/:id/complete', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, validate(actionSchema), asyncHandler(async (req, res) => {
  const interview = await recruiterInterview(req.user.id, req.params.id);
  if (interview.scheduledEnd > new Date()) throw new ApiError(409, 'Chỉ có thể hoàn thành sau khi lịch phỏng vấn kết thúc.');
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await claimInterview(transaction, interview, { expectedVersion: req.body.expectedVersion, update: { status: 'COMPLETED', recruiterNote: req.body.note || interview.recruiterNote } }, ['CONFIRMED']);
    return transaction.interview.findUnique({ where: { id: result.id }, include });
  });
  res.json({ success: true, data: updated });
}));

router.get('/candidate', authenticate, authorize('CANDIDATE'), validate(listSchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên.');
  const { status, from, to, page, limit, sort } = req.query;
  const where = { application: { candidateId: candidate.id }, ...(status ? { status } : {}), ...((from || to) ? { scheduledStart: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
  const [raw, total] = await prisma.$transaction([prisma.interview.findMany({ where, include, orderBy: { scheduledStart: sort }, skip: (page - 1) * limit, take: limit }), prisma.interview.count({ where })]);
  res.json({ success: true, data: { items: raw.map(candidateView), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/candidate/:id', authenticate, authorize('CANDIDATE'), validate(emptyQuery), asyncHandler(async (req, res) => res.json({ success: true, data: candidateView(await candidateInterview(req.user.id, req.params.id)) })));

async function candidateAction(req, res, targetStatus, allowedStatuses, notification) {
  const interview = await candidateInterview(req.user.id, req.params.id);
  if (TERMINAL_APPLICATION_STATUSES.has(interview.application.status)) throw new ApiError(409, 'Hồ sơ ứng tuyển đã kết thúc.');
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM applications WHERE id = ${interview.applicationId} FOR UPDATE`;
    const currentApplication = await transaction.application.findUnique({ where: { id: interview.applicationId }, select: { status: true } });
    if (!currentApplication || TERMINAL_APPLICATION_STATUSES.has(currentApplication.status)) throw new ApiError(409, 'Hồ sơ ứng tuyển đã kết thúc.');
    const result = await claimInterview(transaction, interview, { expectedVersion: req.body.expectedVersion, update: { status: targetStatus, candidateResponseNote: req.body.note || null } }, allowedStatuses);
    await notify(transaction, { userId: interview.recruiterUserId, type: notification.type, title: notification.title, content: `${interview.application.candidate.user.fullName}: ${notification.content}`, role: 'RECRUITER', interviewId: interview.id });
    return transaction.interview.findUnique({ where: { id: result.id }, include });
  });
  res.json({ success: true, data: candidateView(updated) });
}

router.post('/candidate/:id/confirm', authenticate, authorize('CANDIDATE'), validate(actionSchema), asyncHandler((req, res) => candidateAction(req, res, 'CONFIRMED', ['PENDING_RESPONSE'], { type: 'INTERVIEW_CONFIRMED', title: 'Ứng viên xác nhận phỏng vấn', content: 'đã xác nhận tham gia phỏng vấn.' })));
router.post('/candidate/:id/decline', authenticate, authorize('CANDIDATE'), validate(actionSchema), asyncHandler((req, res) => candidateAction(req, res, 'DECLINED', ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED'], { type: 'INTERVIEW_DECLINED', title: 'Ứng viên từ chối phỏng vấn', content: 'đã từ chối lịch phỏng vấn.' })));

router.post('/candidate/:id/reschedule', authenticate, authorize('CANDIDATE'), validate(proposalSchema), asyncHandler(async (req, res) => {
  const interview = await candidateInterview(req.user.id, req.params.id);
  if (TERMINAL_APPLICATION_STATUSES.has(interview.application.status)) throw new ApiError(409, 'Hồ sơ ứng tuyển đã kết thúc.');
  const { start, end } = parseSchedule({ scheduledStart: req.body.proposedStart, scheduledEnd: req.body.proposedEnd, timezone: req.body.timezone });
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM applications WHERE id = ${interview.applicationId} FOR UPDATE`;
    const currentApplication = await transaction.application.findUnique({ where: { id: interview.applicationId }, select: { status: true } });
    if (!currentApplication || TERMINAL_APPLICATION_STATUSES.has(currentApplication.status)) throw new ApiError(409, 'Hồ sơ ứng tuyển đã kết thúc.');
    const result = await claimInterview(transaction, interview, { expectedVersion: req.body.expectedVersion, update: { status: 'RESCHEDULE_REQUESTED', proposedStart: start, proposedEnd: end, candidateResponseNote: req.body.note || null } }, ['PENDING_RESPONSE', 'CONFIRMED']);
    await notify(transaction, { userId: interview.recruiterUserId, type: 'INTERVIEW_RESCHEDULE_REQUESTED', title: 'Ứng viên đề xuất đổi lịch', content: `${interview.application.candidate.user.fullName} đã đề xuất thời gian khác cho vòng ${interview.round}.`, role: 'RECRUITER', interviewId: interview.id });
    return transaction.interview.findUnique({ where: { id: result.id }, include });
  });
  res.json({ success: true, data: candidateView(updated) });
}));

module.exports = router;
