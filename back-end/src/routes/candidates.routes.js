const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const prisma = require('../config/prisma');
const config = require('../config/env');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { extractResumeProfile, resumeImportSchema, analyzeResumeForJob } = require('../services/llm.service');
const { calculateMatchScore } = require('../services/matching.service');

const httpUrl = z.string().url().max(500).refine((value) => /^https?:\/\//i.test(value), 'Chỉ chấp nhận liên kết http hoặc https');

const profileSchema = z.object({
  body: z.object({
    headline: z.string().max(180).nullable().optional(),
    bio: z.string().max(10000).nullable().optional(),
    location: z.string().max(150).nullable().optional(),
    yearsExperience: z.number().nonnegative().max(99.9).nullable().optional(),
    education: z.string().max(255).nullable().optional(),
    resumeUrl: httpUrl.nullable().optional(),
    desiredPosition: z.string().max(180).nullable().optional(),
    desiredSalary: z.number().nonnegative().nullable().optional(),
    desiredLocation: z.string().max(150).nullable().optional(),
    desiredEmploymentType: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID']).nullable().optional(),
    isSearchable: z.boolean().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({}),
  query: z.object({})
});
const alertFields = {
  name: z.string().min(1).max(150),
  keyword: z.string().max(180).nullable().optional(),
  location: z.string().max(150).nullable().optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID']).nullable().optional(),
  minSalary: z.number().nonnegative().nullable().optional(),
  skillIds: z.array(z.number().int().positive()).max(100).default([]),
  frequency: z.enum(['INSTANT', 'DAILY', 'WEEKLY']).default('DAILY'),
  isActive: z.boolean().default(true)
};
const alertSchema = z.object({
  body: z.object(alertFields),
  params: z.object({}),
  query: z.object({})
});
const alertUpdateSchema = z.object({
  body: z.object(alertFields).partial().refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const alertDeleteSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const invitationResponseSchema = z.object({
  body: z.object({ status: z.enum(['ACCEPTED', 'DECLINED']) }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const invitationListSchema = z.object({
  body: z.object({}), params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED']).optional()
  })
});
const invitationDetailSchema = z.object({
  body: z.object({}), params: z.object({ id: z.coerce.number().int().positive() }), query: z.object({})
});
const invitationSelect = {
  id: true, status: true, message: true, createdAt: true, respondedAt: true,
  job: { select: {
    id: true, title: true, location: true, employmentType: true, status: true, deadline: true,
    company: { select: { id: true, name: true, logoUrl: true } }
  } }
};
function invitationAvailability(invitation, now = new Date()) {
  if (invitation.status !== 'PENDING') return { isActionable: false, unavailableReason: null };
  if (invitation.job.status !== 'PUBLISHED') return { isActionable: false, unavailableReason: 'Việc làm không còn được đăng tuyển' };
  if (invitation.job.deadline && invitation.job.deadline <= now) return { isActionable: false, unavailableReason: 'Lời mời đã hết hạn theo hạn ứng tuyển' };
  return { isActionable: true, unavailableReason: null };
}
function serializeInvitation(invitation, now = new Date()) {
  return { ...invitation, ...invitationAvailability(invitation, now) };
}

const skillsSchema = z.object({
  body: z.object({
    skillIds: z.array(z.number().int().positive()).max(100)
  }),
  params: z.object({}),
  query: z.object({})
});
const importProfileSchema = resumeImportSchema.extend({
  education: resumeImportSchema.shape.education,
  experience: resumeImportSchema.shape.experience,
  projects: resumeImportSchema.shape.projects
});
const importConfirmSchema = z.object({
  body: importProfileSchema,
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const router = require('express').Router();

router.get('/alerts/unsubscribe', asyncHandler(async (req, res) => {
  const alertId = Number(req.query.id);
  const token = String(req.query.token || '');
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(alertId)).digest('hex');
  const validToken = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!Number.isInteger(alertId) || !validToken) throw new ApiError(400, 'Liên kết hủy đăng ký không hợp lệ');
  await prisma.jobAlert.update({ where: { id: alertId }, data: { isActive: false } });
  res.json({ success: true, message: 'Đã hủy thông báo việc làm' });
}));

router.get('/me/alerts', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const alerts = await prisma.jobAlert.findMany({ where: { candidateId: candidate.id }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: alerts });
}));

router.post('/me/alerts', authenticate, authorize('CANDIDATE'), validate(alertSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const count = await prisma.jobAlert.count({ where: { candidateId: candidate.id } });
  if (count >= 20) throw new ApiError(400, 'Mỗi ứng viên chỉ được tạo tối đa 20 thông báo');
  const alert = await prisma.jobAlert.create({ data: { ...req.body, candidateId: candidate.id, skillIds: req.body.skillIds } });
  res.status(201).json({ success: true, data: alert });
}));

router.patch('/me/alerts/:id', authenticate, authorize('CANDIDATE'), validate(alertUpdateSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const alert = await prisma.jobAlert.findFirst({ where: { id: req.params.id, candidateId: candidate.id } });
  if (!alert) throw new ApiError(404, 'Không tìm thấy thông báo việc làm');
  const updated = await prisma.jobAlert.update({ where: { id: alert.id }, data: req.body });
  res.json({ success: true, data: updated });
}));

router.get('/me/invitations', authenticate, authorize('CANDIDATE'), validate(invitationListSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const { page, limit, status } = req.query;
  const where = { candidateId: candidate.id, ...(status ? { status } : {}) };
  const [items, total, pendingCount] = await prisma.$transaction([
    prisma.talentInvitation.findMany({ where, select: invitationSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.talentInvitation.count({ where }),
    prisma.talentInvitation.count({ where: { candidateId: candidate.id, status: 'PENDING' } })
  ]);
  const now = new Date();
  res.json({ success: true, data: { items: items.map((item) => serializeInvitation(item, now)), page, limit, total, totalPages: Math.ceil(total / limit), pendingCount } });
}));

router.get('/me/invitations/:id', authenticate, authorize('CANDIDATE'), validate(invitationDetailSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const invitation = await prisma.talentInvitation.findFirst({ where: { id: req.params.id, candidateId: candidate.id }, select: invitationSelect });
  if (!invitation) throw new ApiError(404, 'Không tìm thấy lời mời');
  res.json({ success: true, data: serializeInvitation(invitation) });
}));

router.patch('/me/invitations/:id', authenticate, authorize('CANDIDATE'), validate(invitationResponseSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const status = req.body.status;
  const invitation = await prisma.talentInvitation.findFirst({ where: { id: req.params.id, candidateId: candidate.id }, select: { ...invitationSelect, recruiterUserId: true } });
  if (!invitation) throw new ApiError(404, 'Không tìm thấy lời mời');
  if (invitation.status === status) return res.json({ success: true, data: { ...serializeInvitation(invitation), idempotent: true } });
  if (invitation.status !== 'PENDING') throw new ApiError(409, 'Lời mời đã được phản hồi và không thể thay đổi trạng thái');
  const availability = invitationAvailability(invitation);
  if (status === 'ACCEPTED' && !availability.isActionable) throw new ApiError(409, availability.unavailableReason);
  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.talentInvitation.updateMany({ where: { id: invitation.id, candidateId: candidate.id, status: 'PENDING' }, data: { status, respondedAt: new Date() } });
    if (!claimed.count) return { current: await transaction.talentInvitation.findFirst({ where: { id: invitation.id, candidateId: candidate.id }, select: invitationSelect }), won: false };
    const updated = await transaction.talentInvitation.findUnique({ where: { id: invitation.id }, select: invitationSelect });
    await transaction.notification.create({ data: {
      userId: invitation.recruiterUserId, type: 'TALENT_INVITATION_RESPONSE',
      title: status === 'ACCEPTED' ? 'Ứng viên đã chấp nhận lời mời' : 'Ứng viên đã từ chối lời mời',
      content: `${req.user.fullName} đã ${status === 'ACCEPTED' ? 'chấp nhận' : 'từ chối'} lời mời cho vị trí ${invitation.job.title}.`,
      link: `/recruiter/talent?jobId=${invitation.job.id}&candidateId=${candidate.id}`
    } });
    return { current: updated, won: true };
  });
  if (!result.won) {
    if (result.current?.status === status) return res.json({ success: true, data: { ...serializeInvitation(result.current), idempotent: true } });
    throw new ApiError(409, 'Lời mời vừa được phản hồi bởi một yêu cầu khác');
  }
  res.json({ success: true, data: { ...serializeInvitation(result.current), idempotent: false } });
}));

router.delete('/me/alerts/:id', authenticate, authorize('CANDIDATE'), validate(alertDeleteSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const result = await prisma.jobAlert.deleteMany({ where: { id: req.params.id, candidateId: candidate.id } });
  if (!result.count) throw new ApiError(404, 'Không tìm thấy thông báo việc làm');
  res.json({ success: true, data: { id: Number(req.params.id) } });
}));

const uploadsDirectory = config.uploadsDirectory;
const allowedResumeTypes = new Map([
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx']
]);
const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(uploadsDirectory, { recursive: true });
      callback(null, uploadsDirectory);
    },
    filename: (req, file, callback) => {
      callback(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedResumeTypes.get(file.mimetype) !== extension) {
      return callback(new ApiError(400, 'CV chỉ được phép ở định dạng PDF hoặc DOCX'));
    }
    callback(null, true);
  }
});
const MAX_RESUME_TEXT_LENGTH = 30000;
async function extractResumeText(resume) {
  const filePath = path.join(uploadsDirectory, resume.path);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'File CV không còn tồn tại');
  const buffer = fs.readFileSync(filePath);
  const result = resume.mimeType === 'application/pdf'
    ? await pdfParse(buffer)
    : await mammoth.extractRawText({ buffer });
  const text = String(result.text || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new ApiError(422, 'Không tìm thấy văn bản trong CV');
  return text.slice(0, MAX_RESUME_TEXT_LENGTH);
}
function handleResumeUpload(req, res, next) {
  resumeUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof ApiError) return next(error);
    if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(400, 'CV không được vượt quá 5MB'));
    return next(new ApiError(400, 'File CV không hợp lệ'));
  });
}
function hasValidSignature(filePath, extension) {
  const buffer = fs.readFileSync(filePath);
  if (extension === '.pdf') {
    if (buffer.length < 8 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return false;
    return buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'));
  }
  if (extension !== '.docx' || buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return false;

  const centralHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  let entryCount = 0;
  let totalUncompressedSize = 0;
  const names = new Set();
  while ((offset = buffer.indexOf(centralHeader, offset)) !== -1) {
    if (offset + 46 > buffer.length) return false;
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (uncompressedSize === 0xffffffff || end > buffer.length) return false;
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || name.split('/').includes('..')) return false;
    names.add(name);
    entryCount += 1;
    totalUncompressedSize += uncompressedSize;
    if (entryCount > 2000 || totalUncompressedSize > 25 * 1024 * 1024) return false;
    offset = end;
  }
  return entryCount > 0 && names.has('[Content_Types].xml') && names.has('word/document.xml');
}

const dateField = z.coerce.date().nullable().optional();
const educationSchema = z.object({
  body: z.object({
    school: z.string().min(1).max(255),
    major: z.string().max(180).nullable().optional(),
    degree: z.string().max(120).nullable().optional(),
    fromDate: dateField,
    toDate: dateField
  }),
  params: z.object({}),
  query: z.object({})
});
const experienceSchema = z.object({
  body: z.object({
    company: z.string().min(1).max(180),
    title: z.string().min(1).max(180),
    description: z.string().max(10000).nullable().optional(),
    fromDate: dateField,
    toDate: dateField,
    isCurrent: z.boolean().default(false)
  }),
  params: z.object({}),
  query: z.object({})
});
const projectSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(180),
    description: z.string().max(10000).nullable().optional(),
    link: httpUrl.nullable().optional(),
    technologies: z.array(z.string().max(100)).max(50).default([])
  }),
  params: z.object({}),
  query: z.object({})
});
const resumeMetadataSchema = z.object({
  isDefault: z.enum(['true', 'false']).default('false')
});
const resourceIdSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const savedJobSchema = z.object({
  body: z.object({}),
  params: z.object({ jobId: z.coerce.number().int().positive() }),
  query: z.object({})
});
function canSaveJob(job) {
  return Boolean(job && job.status === 'PUBLISHED');
}
const candidateSearchSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().optional(),
    location: z.string().optional(),
    desiredPosition: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

async function findCandidate(userId) {
  const candidate = await prisma.candidate.findUnique({ where: { userId } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  return candidate;
}

const profileInclude = {
  user: { select: { id: true, email: true, fullName: true, phone: true } },
  skills: { include: { skill: true } },
  educations: { orderBy: { fromDate: 'desc' } },
  experiences: { orderBy: { fromDate: 'desc' } },
  projects: { orderBy: { id: 'desc' } },
  resumes: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }
};

function buildCompleteness(candidate) {
  const checklist = [
    { id: 'headline', label: 'Thêm tiêu đề nghề nghiệp', completed: Boolean(candidate.headline), tab: 'general', field: 'headline' },
    { id: 'bio', label: 'Viết phần giới thiệu', completed: Boolean(candidate.bio), tab: 'general', field: 'bio' },
    { id: 'skills', label: 'Thêm ít nhất 5 kỹ năng', completed: candidate.skills.length >= 5, tab: 'skills', field: 'skills' },
    { id: 'education', label: 'Thêm ít nhất một mục học vấn', completed: candidate.educations.length >= 1, tab: 'education', field: 'education' },
    { id: 'experienceOrProject', label: 'Thêm kinh nghiệm hoặc dự án', completed: candidate.experiences.length >= 1 || candidate.projects.length >= 1, tab: 'experience', field: 'experience' },
    { id: 'defaultResume', label: 'Tải lên và chọn CV mặc định', completed: candidate.resumes.some((resume) => resume.isDefault), tab: 'resumes', field: 'resumes' },
    { id: 'desiredPosition', label: 'Chọn vị trí mong muốn', completed: Boolean(candidate.desiredPosition), tab: 'desired', field: 'desiredPosition' },
    { id: 'desiredSalary', label: 'Nhập mức lương mong muốn', completed: candidate.desiredSalary !== null && candidate.desiredSalary !== undefined, tab: 'desired', field: 'desiredSalary' },
    { id: 'desiredLocation', label: 'Nhập địa điểm mong muốn', completed: Boolean(candidate.desiredLocation), tab: 'desired', field: 'desiredLocation' }
  ];
  const completed = checklist.filter((item) => item.completed).length;
  return {
    percentage: Math.round((completed / checklist.length) * 100),
    completed,
    total: checklist.length,
    checklist,
    missing: checklist.filter((item) => !item.completed)
  };
}

router.get('/skills', asyncHandler(async (req, res) => {
  const skills = await prisma.skill.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: skills });
}));

router.get('/resumes/:id/download', authenticate, validate(resourceIdSchema), asyncHandler(async (req, res) => {
  const resume = await prisma.candidateResume.findUnique({
    where: { id: req.params.id },
    include: { candidate: true }
  });
  if (!resume) throw new ApiError(404, 'Không tìm thấy CV');

  let canDownload = req.user.role === 'ADMIN' || (req.user.role === 'CANDIDATE' && resume.candidate.userId === req.user.id);
    if (req.user.role === 'RECRUITER') {
    const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
    if (recruiter) {
      const application = await prisma.application.findFirst({
        where: {
          resumeId: resume.id,
          job: { companyId: recruiter.companyId }
        }
      });
      canDownload = Boolean(application);
    }
  }
  if (!canDownload) throw new ApiError(403, 'Bạn không có quyền tải CV này');

  const filePath = path.join(uploadsDirectory, resume.path);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'File CV không còn tồn tại');
  res.setHeader('Content-Type', resume.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(resume.fileName)}"`);
  res.sendFile(filePath);
}));

router.get('/', authenticate, authorize('RECRUITER'), validate(candidateSearchSchema), asyncHandler(async (req, res) => {
  const { search, location, desiredPosition, page, limit } = req.query;
  const where = {
    isSearchable: true,
    ...(location ? { AND: [{ OR: [{ location: { contains: location } }, { desiredLocation: { contains: location } }] }] } : {}),
    ...(desiredPosition ? { desiredPosition: { contains: desiredPosition } } : {}),
    ...(search ? {
      AND: [
        ...(location ? [{ OR: [{ location: { contains: location } }, { desiredLocation: { contains: location } }] }] : []),
        { OR: [
          { headline: { contains: search } },
          { bio: { contains: search } },
          { desiredPosition: { contains: search } },
          { user: { fullName: { contains: search } } }
        ] }
      ]
    } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.candidate.findMany({
      where,
      select: { id: true, headline: true, bio: true, location: true, desiredPosition: true, desiredSalary: true, desiredLocation: true, desiredEmploymentType: true, yearsExperience: true, skills: { include: { skill: true } }, user: { select: { fullName: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.candidate.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/me/completeness', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({
    where: { userId: req.user.id },
    select: {
      headline: true,
      bio: true,
      desiredPosition: true,
      desiredSalary: true,
      desiredLocation: true,
      skills: { select: { skillId: true } },
      educations: { select: { id: true } },
      experiences: { select: { id: true } },
      projects: { select: { id: true } },
      resumes: { select: { isDefault: true } }
    }
  });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  res.json({ success: true, data: buildCompleteness(candidate) });
}));

router.post('/me/job-analysis/:jobId', authenticate, authorize('CANDIDATE'), validate(z.object({
  body: z.object({}),
  params: z.object({ jobId: z.coerce.number().int().positive() }),
  query: z.object({})
})), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({
    where: { userId: req.user.id },
    include: { skills: { include: { skill: true } }, resumes: { where: { isDefault: true }, take: 1 } }
  });
  const job = await prisma.job.findFirst({
    where: { id: req.params.jobId, status: 'PUBLISHED', deadline: { OR: [{ gte: new Date() }, { equals: null }] } },
    include: { skills: { include: { skill: true } } }
  });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm đang tuyển');
  const resume = candidate.resumes[0];
  if (!resume) throw new ApiError(400, 'Bạn cần chọn CV mặc định trước khi phân tích');
  const match = calculateMatchScore(candidate, job);
  const cached = await prisma.resumeJobAnalysis.findUnique({ where: { resumeId_jobId: { resumeId: resume.id, jobId: job.id } } });
  if (cached) {
    return res.json({ success: true, data: {
      fitScore: Number(cached.fitScore),
      missingKeywords: cached.missingKeywords,
      strengths: cached.strengths,
      suggestions: cached.suggestions,
      matchedSkills: match.matchedSkills,
      missingSkills: match.missingSkills,
      disclaimer: 'Đây là gợi ý, không phải quyết định tuyển dụng.'
    } });
  }
  const text = await extractResumeText(resume);
  const result = await analyzeResumeForJob(req.user.id, text, job, match);
  const analysis = await prisma.resumeJobAnalysis.create({
    data: { resumeId: resume.id, jobId: job.id, fitScore: result.fitScore, missingKeywords: result.missingKeywords, strengths: result.strengths, suggestions: result.suggestions }
  });
  res.json({ success: true, data: {
    fitScore: Number(analysis.fitScore),
    missingKeywords: analysis.missingKeywords,
    strengths: analysis.strengths,
    suggestions: analysis.suggestions,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    disclaimer: 'Đây là gợi ý, không phải quyết định tuyển dụng.'
  } });
}));

router.get('/me', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const profile = await prisma.candidate.findUnique({ where: { id: candidate.id }, include: profileInclude });
  res.json({ success: true, data: profile });
}));

router.patch('/me', authenticate, authorize('CANDIDATE'), validate(profileSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const profile = await prisma.candidate.update({
    where: { id: candidate.id },
    data: req.body,
    include: profileInclude
  });
  res.json({ success: true, data: profile });
}));

router.put('/me/skills', authenticate, authorize('CANDIDATE'), validate(skillsSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const uniqueSkillIds = [...new Set(req.body.skillIds)];
  const skills = await prisma.skill.findMany({ where: { id: { in: uniqueSkillIds } }, select: { id: true } });
  if (skills.length !== uniqueSkillIds.length) {
    throw new ApiError(400, 'Một hoặc nhiều kỹ năng không tồn tại');
  }

  await prisma.$transaction([
    prisma.candidateSkill.deleteMany({ where: { candidateId: candidate.id } }),
    ...uniqueSkillIds.map((skillId) => prisma.candidateSkill.create({
      data: { candidateId: candidate.id, skillId }
    }))
  ]);

  const profile = await prisma.candidate.findUnique({ where: { id: candidate.id }, include: profileInclude });
  res.json({ success: true, data: profile });
}));

async function candidateResource(req, model, id) {
  const candidate = await findCandidate(req.user.id);
  const item = await prisma[model].findFirst({ where: { id, candidateId: candidate.id } });
  if (!item) throw new ApiError(404, 'Không tìm thấy dữ liệu hồ sơ');
  return { candidate, item };
}

function registerCandidateResource(path, model, schema) {
  const updateSchema = z.object({
    body: schema.shape.body.partial().refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.object({})
  });
  router.get(`/me/${path}`, authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
    const candidate = await findCandidate(req.user.id);
    const items = await prisma[model].findMany({ where: { candidateId: candidate.id }, orderBy: { id: 'desc' } });
    res.json({ success: true, data: items });
  }));
  router.post(`/me/${path}`, authenticate, authorize('CANDIDATE'), validate(schema), asyncHandler(async (req, res) => {
    const candidate = await findCandidate(req.user.id);
    const item = model === 'candidateResume'
      ? await prisma.$transaction(async (transaction) => {
        if (req.body.isDefault) {
          await transaction.candidateResume.updateMany({ where: { candidateId: candidate.id }, data: { isDefault: false } });
        }
        return transaction.candidateResume.create({ data: { ...req.body, candidateId: candidate.id } });
      })
      : await prisma[model].create({ data: { ...req.body, candidateId: candidate.id } });
    res.status(201).json({ success: true, data: item });
  }));
  router.patch(`/me/${path}/:id`, authenticate, authorize('CANDIDATE'), validate(updateSchema), asyncHandler(async (req, res) => {
    const { item } = await candidateResource(req, model, req.params.id);
    const updated = await prisma[model].update({ where: { id: item.id }, data: req.body });
    res.json({ success: true, data: updated });
  }));
  router.delete(`/me/${path}/:id`, authenticate, authorize('CANDIDATE'), validate(resourceIdSchema), asyncHandler(async (req, res) => {
    const { item } = await candidateResource(req, model, req.params.id);
    await prisma[model].delete({ where: { id: item.id } });
    res.status(204).send();
  }));
}

registerCandidateResource('educations', 'candidateEducation', educationSchema);
registerCandidateResource('experiences', 'candidateExperience', experienceSchema);
registerCandidateResource('projects', 'candidateProject', projectSchema);
router.get('/me/resumes', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const items = await prisma.candidateResume.findMany({
    where: { candidateId: candidate.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
  });
  res.json({ success: true, data: items });
}));

router.post('/me/resumes/:id/import', authenticate, authorize('CANDIDATE'), validate(z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
})), asyncHandler(async (req, res) => {
  const { item } = await candidateResource(req, 'candidateResume', req.params.id);
  const text = await extractResumeText(item);
  const extracted = await extractResumeProfile(req.user.id, text);
  const names = [...new Set(extracted.skills.map((name) => name.trim()).filter(Boolean))];
  const existing = names.length
    ? await prisma.skill.findMany({ where: { name: { in: names } }, select: { id: true, name: true } })
    : [];
  const existingNames = new Set(existing.map((skill) => skill.name.toLowerCase()));
  res.json({
    success: true,
    data: {
      ...extracted,
      matchedSkills: existing,
      suggestedSkills: names.filter((name) => !existingNames.has(name.toLowerCase()))
    }
  });
}));

router.post('/me/resumes/:id/import/confirm', authenticate, authorize('CANDIDATE'), validate(importConfirmSchema), asyncHandler(async (req, res) => {
  const { candidate, item } = await candidateResource(req, 'candidateResume', req.params.id);
  const payload = req.body;
  const skillNames = [...new Set(payload.skills.map((name) => name.trim()).filter(Boolean))];
  const allSkills = skillNames.length
    ? await prisma.skill.findMany({ select: { id: true, name: true } })
    : [];
  const skillByName = new Map(allSkills.map((skill) => [skill.name.toLowerCase(), skill]));
  const profile = await prisma.$transaction(async (transaction) => {
    const skillIds = [];
    for (const name of skillNames) {
      const key = name.toLowerCase();
      let skill = skillByName.get(key);
      if (!skill) {
        skill = await transaction.skill.create({ data: { name } });
        skillByName.set(key, skill);
      }
      skillIds.push(skill.id);
    }
    await transaction.candidateSkill.deleteMany({ where: { candidateId: candidate.id } });
    if (skillIds.length) {
      await transaction.candidateSkill.createMany({
        data: [...new Set(skillIds)].map((skillId) => ({ candidateId: candidate.id, skillId }))
      });
    }
    await transaction.candidate.update({ where: { id: candidate.id }, data: { headline: payload.headline || null } });
    if (payload.education.length) {
      await transaction.candidateEducation.createMany({
        data: payload.education.map((education) => ({
          candidateId: candidate.id,
          school: education.school,
          major: education.major || null,
          degree: education.degree || null,
          fromDate: education.fromDate ? new Date(education.fromDate) : null,
          toDate: education.toDate ? new Date(education.toDate) : null
        }))
      });
    }
    if (payload.experience.length) {
      await transaction.candidateExperience.createMany({
        data: payload.experience.map((experience) => ({
          candidateId: candidate.id,
          company: experience.company,
          title: experience.title,
          description: experience.description || null,
          fromDate: experience.fromDate ? new Date(experience.fromDate) : null,
          toDate: experience.toDate ? new Date(experience.toDate) : null,
          isCurrent: experience.isCurrent
        }))
      });
    }
    if (payload.projects.length) {
      await transaction.candidateProject.createMany({
        data: payload.projects.map((project) => ({
          candidateId: candidate.id,
          name: project.name,
          description: project.description || null,
          link: project.link || null,
          technologies: project.technologies
        }))
      });
    }
    return transaction.candidate.findUnique({ where: { id: candidate.id }, include: profileInclude });
  });
  res.json({ success: true, data: profile });
}));

router.post('/me/resumes', authenticate, authorize('CANDIDATE'), handleResumeUpload, asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw new ApiError(400, 'Vui lòng chọn file CV');
    const extension = path.extname(req.file.originalname).toLowerCase();
    const expectedMimeType = extension === '.pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (req.file.mimetype !== expectedMimeType) {
      throw new ApiError(400, 'Mime type của CV không hợp lệ');
    }
    if (!hasValidSignature(req.file.path, extension)) {
      throw new ApiError(400, 'Nội dung file không đúng định dạng CV');
    }

    const candidate = await findCandidate(req.user.id);
    const safeFileName = path.basename(req.file.originalname).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!safeFileName || safeFileName.length > 255) throw new ApiError(400, 'Tên file CV không hợp lệ');
    const { isDefault } = resumeMetadataSchema.parse(req.body);
    const resume = await prisma.$transaction(async (transaction) => {
      const existingCount = await transaction.candidateResume.count({ where: { candidateId: candidate.id } });
      if (existingCount >= 10) throw new ApiError(400, 'Mỗi ứng viên chỉ được lưu tối đa 10 CV');
      const makeDefault = isDefault === 'true' || existingCount === 0;
      if (makeDefault) {
        await transaction.candidateResume.updateMany({ where: { candidateId: candidate.id }, data: { isDefault: false } });
      }
      return transaction.candidateResume.create({
        data: {
          candidateId: candidate.id,
          fileName: safeFileName,
          path: req.file.filename,
          mimeType: req.file.mimetype,
          size: req.file.size,
          isDefault: makeDefault
        }
      });
    });
    res.status(201).json({ success: true, data: resume });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    throw error;
  }
}));

router.patch('/me/resumes/:id', authenticate, authorize('CANDIDATE'), validate(z.object({
  body: z.object({ fileName: z.string().trim().min(1).max(255) }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
})), asyncHandler(async (req, res) => {
  const { item } = await candidateResource(req, 'candidateResume', req.params.id);
  const updated = await prisma.candidateResume.update({ where: { id: item.id }, data: { fileName: req.body.fileName } });
  res.json({ success: true, data: updated });
}));

router.delete('/me/resumes/:id', authenticate, authorize('CANDIDATE'), validate(resourceIdSchema), asyncHandler(async (req, res) => {
  const { item } = await candidateResource(req, 'candidateResume', req.params.id);
  await prisma.candidateResume.delete({ where: { id: item.id } });
  const filePath = path.join(uploadsDirectory, item.path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.status(204).send();
}));

router.patch('/me/resumes/:id/default', authenticate, authorize('CANDIDATE'), validate(resourceIdSchema), asyncHandler(async (req, res) => {
  const { candidate, item } = await candidateResource(req, 'candidateResume', req.params.id);
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.candidateResume.updateMany({ where: { candidateId: candidate.id }, data: { isDefault: false } });
    return transaction.candidateResume.update({ where: { id: item.id }, data: { isDefault: true } });
  });
  res.json({ success: true, data: updated });
}));

router.get('/me/saved-jobs', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const items = await prisma.savedJob.findMany({ where: { candidateId: candidate.id }, include: { job: { include: { company: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: items });
}));

router.post('/me/saved-jobs/:jobId', authenticate, authorize('CANDIDATE'), validate(savedJobSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
  if (!canSaveJob(job)) throw new ApiError(404, 'Không tìm thấy việc làm');
  const item = await prisma.savedJob.upsert({
    where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
    update: {},
    create: { candidateId: candidate.id, jobId: job.id }
  });
  res.status(201).json({ success: true, data: item });
}));

router.delete('/me/saved-jobs/:jobId', authenticate, authorize('CANDIDATE'), validate(savedJobSchema), asyncHandler(async (req, res) => {
  const candidate = await findCandidate(req.user.id);
  await prisma.savedJob.deleteMany({ where: { candidateId: candidate.id, jobId: req.params.jobId } });
  res.status(204).send();
}));

module.exports = router;
module.exports.hasValidSignature = hasValidSignature;
module.exports.canSaveJob = canSaveJob;
module.exports.httpUrl = httpUrl;
module.exports.buildCompleteness = buildCompleteness;
module.exports.invitationAvailability = invitationAvailability;
