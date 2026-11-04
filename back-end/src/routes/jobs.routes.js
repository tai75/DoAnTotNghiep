const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { assertMatchingVersionEnabled, calculateMatchScore, calculateWeightedV2, buildRuleExplanation } = require('../services/matching.service');
const { explainMatch } = require('../services/llm.service');
const { generateJobDescription } = require('../services/llm.service');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const employmentTypes = ['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID'];
const employmentTypeSchema = z.enum(employmentTypes);
const questionSchema = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum(['YES_NO', 'NUMBER', 'TEXT', 'SINGLE_CHOICE']),
  question: z.string().min(1).max(500),
  options: z.array(z.string().max(200)).max(20).nullable().optional(),
  isRequired: z.boolean().default(false),
  isKnockout: z.boolean().default(false),
  idealAnswer: z.string().max(5000).nullable().optional()
});

function validateJobValues(value, context, pathPrefix = ['body']) {
  if (value.minSalary !== undefined && value.maxSalary !== undefined && value.minSalary > value.maxSalary) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [...pathPrefix, 'maxSalary'], message: 'maxSalary phải lớn hơn hoặc bằng minSalary' });
  }
}

function futureDateSchema() {
  return z.coerce.date().refine((date) => date > new Date(), 'deadline phải ở tương lai');
}

const jobBodySchema = z.object({
  title: z.string().min(3).max(180),
  description: z.string().min(20),
  location: z.string().max(150).optional(),
  employmentType: employmentTypeSchema.optional(),
  minSalary: z.number().nonnegative().optional(),
  maxSalary: z.number().nonnegative().optional(),
  requiredYearsExperience: z.number().nonnegative().max(999.9).refine((value) => Number.isInteger(value * 10), 'requiredYearsExperience chỉ được có tối đa một chữ số thập phân').nullable().optional(),
  deadline: futureDateSchema().optional(),
  skillIds: z.array(z.number().int().positive()).default([])
  ,requiredSkills: z.array(z.number().int().positive()).optional(),
  screeningQuestions: z.array(questionSchema).max(30).default([]),
  status: z.enum(['DRAFT', 'PENDING']).optional()
});

const jobSchema = z.object({
  body: jobBodySchema,
  params: z.object({}),
  query: z.object({})
}).superRefine((value, context) => validateJobValues(value.body, context));

const jobUpdateSchema = z.object({
  body: jobBodySchema.partial()
    .refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật')
    .superRefine((value, context) => validateJobValues(value, context, [])),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const jobIdSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const aiDescriptionSchema = z.object({
  body: jobBodySchema.partial().refine((body) => Object.keys(body).length > 0, 'Cần có dữ liệu để tạo mô tả'),
  params: z.object({}),
  query: z.object({})
});
const aiRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { success: false, message: 'Bạn đã sử dụng quá nhiều yêu cầu AI trong giờ này' }
});

const listSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().optional(),
    location: z.string().optional(),
    company: z.string().optional(),
    employmentType: employmentTypeSchema.optional(),
    skill: z.string().optional(),
    postedWithin: z.enum(['1', '7', '30']).optional(),
    maxApplicants: z.coerce.number().int().nonnegative().optional(),
    minSalary: z.coerce.number().nonnegative().optional(),
    maxSalary: z.coerce.number().nonnegative().optional(),
    sort: z.enum(['newest', 'salary_high', 'salary_low']).default('newest'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10)
  })
}).superRefine((value, context) => {
  if (value.query.minSalary !== undefined && value.query.maxSalary !== undefined && value.query.minSalary > value.query.maxSalary) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['query', 'maxSalary'], message: 'maxSalary phải lớn hơn hoặc bằng minSalary' });
  }
});

const router = require('express').Router();

function requireMatchingVersion(version) {
  return (req, res, next) => {
    try {
      assertMatchingVersionEnabled(version);
      next();
    } catch (error) {
      next(new ApiError(error.statusCode || 410, error.message, {
        code: error.code || 'matching_version_disabled',
        version
      }));
    }
  };
}

router.get('/', validate(listSchema), asyncHandler(async (req, res) => {
  const { search, location, company, employmentType, skill, postedWithin, maxApplicants, minSalary, maxSalary, sort, page, limit } = req.query;
  const skillNames = skill ? skill.split(',').map((item) => item.trim()).filter(Boolean) : [];
  const postedAfter = postedWithin ? new Date(Date.now() - Number(postedWithin) * 24 * 60 * 60 * 1000) : undefined;
  const salaryFilters = [
    ...(minSalary !== undefined ? [{ OR: [{ maxSalary: { gte: minSalary } }, { maxSalary: null }] }] : []),
    ...(maxSalary !== undefined ? [{ OR: [{ minSalary: { lte: maxSalary } }, { minSalary: null }] }] : [])
  ];
  const applicantFilters = maxApplicants === undefined
    ? undefined
    : await (async () => {
      const publicJobs = await prisma.job.findMany({
        where: { status: 'PUBLISHED', OR: [{ deadline: { gte: new Date() } }, { deadline: null }] },
        select: { id: true }
      });
      const grouped = await prisma.application.groupBy({
        by: ['jobId'],
        where: { jobId: { in: publicJobs.map(({ id }) => id) } },
        _count: { _all: true }
      });
      const counts = new Map(grouped.map(({ jobId, _count }) => [jobId, _count._all]));
      return publicJobs.filter(({ id }) => (counts.get(id) || 0) <= maxApplicants).map(({ id }) => id);
    })();
  const where = {
    status: 'PUBLISHED',
    AND: [
      { OR: [{ deadline: { gte: new Date() } }, { deadline: null }] },
      ...(search ? [{ OR: [{ title: { contains: search } }, { description: { contains: search } }] }] : []),
      ...(salaryFilters.length ? salaryFilters : [])
    ],
    ...(postedAfter ? { createdAt: { gte: postedAfter } } : {}),
    ...(applicantFilters ? { id: { in: applicantFilters } } : {}),
    ...(location ? { location: { contains: location } } : {}),
    ...(company ? { company: { name: { contains: company } } } : {}),
    ...(employmentType ? { employmentType: { equals: employmentType } } : {}),
    ...(skillNames.length ? { skills: { some: { skill: { name: { in: skillNames } } } } } : {}),
  };
  const orderBy = sort === 'salary_high'
    ? { maxSalary: 'desc' }
    : sort === 'salary_low'
      ? { minSalary: 'asc' }
      : { createdAt: 'desc' };
  const [items, total] = await prisma.$transaction([
    prisma.job.findMany({
      where,
      select: {
        id: true, companyId: true, title: true, description: true, location: true, employmentType: true,
        minSalary: true, maxSalary: true, requiredYearsExperience: true, deadline: true, createdAt: true, updatedAt: true,
        company: { select: { id: true, name: true, logoUrl: true } },
        skills: { include: { skill: true } },
        _count: { select: { applications: true } }
      },
      orderBy, skip: (page - 1) * limit, take: limit
    }),
    prisma.job.count({ where })
  ]);
  res.json({ success: true, data: { items: items.map(({ _count, ...job }) => ({ ...job, applicantCount: _count.applications })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.get('/me', authenticate, authorize('RECRUITER'), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const jobs = await prisma.job.findMany({
    where: { companyId: recruiter.companyId },
    include: { skills: { include: { skill: true } }, screeningQuestions: { orderBy: { id: 'asc' } }, _count: { select: { applications: true } } },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ success: true, data: jobs });
}));

router.get('/:id/match/v2', authenticate, authorize('CANDIDATE'), requireMatchingVersion('v2'), validate(jobIdSchema), asyncHandler(async (req, res) => {
  const [candidate, job] = await Promise.all([
    prisma.candidate.findUnique({ where: { userId: req.user.id }, include: { skills: { include: { skill: true } }, educations: true, experiences: true, projects: true } }),
    prisma.job.findFirst({ where: { id: req.params.id, status: 'PUBLISHED', OR: [{ deadline: { gte: new Date() } }, { deadline: null }] }, include: { skills: { include: { skill: true } } } })
  ]);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm đang tuyển');
  const result = await calculateWeightedV2(candidate, job, prisma);
  const score = await prisma.matchScoreV2.upsert({
    where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
    create: { candidateId: candidate.id, jobId: job.id, score: result.score, skillScore: result.skillScore, experienceScore: result.experienceScore, positionScore: result.positionScore, locationScore: result.locationScore, salaryScore: result.salaryScore, employmentScore: result.employmentScore, semanticScore: result.semanticScore, matchedSkills: result.matchedSkills, missingSkills: result.missingSkills, computedAt: new Date(), algorithmVersion: result.algorithmVersion },
    update: { score: result.score, skillScore: result.skillScore, experienceScore: result.experienceScore, positionScore: result.positionScore, locationScore: result.locationScore, salaryScore: result.salaryScore, employmentScore: result.employmentScore, semanticScore: result.semanticScore, matchedSkills: result.matchedSkills, missingSkills: result.missingSkills, computedAt: new Date(), algorithmVersion: result.algorithmVersion }
  });
  res.json({ success: true, data: { ...score, score: Number(score.score), skillScore: Number(score.skillScore), experienceScore: Number(score.experienceScore), positionScore: Number(score.positionScore), locationScore: Number(score.locationScore), salaryScore: Number(score.salaryScore), employmentScore: Number(score.employmentScore), semanticScore: Number(score.semanticScore), algorithmVersion: score.algorithmVersion, weights: result.weights } });
}));

router.get('/:id/match', authenticate, authorize('CANDIDATE'), validate(jobIdSchema), asyncHandler(async (req, res) => {
  const [candidate, job] = await Promise.all([
    prisma.candidate.findUnique({
      where: { userId: req.user.id },
      include: { skills: { include: { skill: true } } }
    }),
    prisma.job.findFirst({
      where: {
        id: req.params.id,
        status: 'PUBLISHED',
        OR: [{ deadline: { gte: new Date() } }, { deadline: null }]
      },
      include: { skills: { include: { skill: true } } }
    })
  ]);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm đang tuyển');

  const result = calculateMatchScore(candidate, job);
  const existing = await prisma.matchScore.findUnique({
    where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
    select: { explanation: true }
  });
  const explanation = existing?.explanation || await explainMatch(result, req.user.id) || buildRuleExplanation(result);
  const data = {
    candidateId: candidate.id,
    jobId: job.id,
    score: result.score,
    skillScore: result.skillScore,
    experienceScore: result.experienceScore,
    positionScore: result.positionScore,
    locationScore: result.locationScore,
    salaryScore: result.salaryScore,
    employmentScore: result.employmentScore,
    matchedSkills: result.matchedSkills,
    missingSkills: result.missingSkills,
    explanation,
    computedAt: new Date(),
    algorithmVersion: 'weighted-v1'
  };
  const matchScore = await prisma.matchScore.upsert({
    where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
    create: data,
    update: data
  });
  res.json({
    success: true,
    data: {
      score: Number(matchScore.score),
      skillScore: Number(matchScore.skillScore),
      experienceScore: Number(matchScore.experienceScore),
      positionScore: Number(matchScore.positionScore),
      locationScore: Number(matchScore.locationScore),
      salaryScore: Number(matchScore.salaryScore),
      employmentScore: Number(matchScore.employmentScore),
      matchedSkills: matchScore.matchedSkills || [],
      missingSkills: matchScore.missingSkills || [],
      explanation: matchScore.explanation
    }
  });
}));

router.get('/:id/screening-questions', validate(jobIdSchema), asyncHandler(async (req, res) => {
  const job = await prisma.job.findFirst({
    where: { id: req.params.id, status: 'PUBLISHED', OR: [{ deadline: { gte: new Date() } }, { deadline: null }] },
    select: { screeningQuestions: { orderBy: { id: 'asc' } } }
  });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm đang tuyển');
  res.json({ success: true, data: job.screeningQuestions });
}));

router.get('/:id', validate(jobIdSchema), asyncHandler(async (req, res) => {
  const job = await prisma.job.findFirst({
    where: {
      id: req.params.id,
      status: 'PUBLISHED',
      OR: [{ deadline: { gte: new Date() } }, { deadline: null }]
    },
    select: {
      id: true, companyId: true, title: true, description: true, location: true, employmentType: true,
      minSalary: true, maxSalary: true, requiredYearsExperience: true, deadline: true, createdAt: true, updatedAt: true,
      company: { select: { id: true, name: true, logoUrl: true } },
      skills: { include: { skill: true } },
      _count: { select: { applications: true } }
    }
  });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm đang tuyển');
  const viewerKey = crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}`).digest('hex');
  const recentView = await prisma.jobView.findFirst({ where: { jobId: job.id, viewerKey, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  if (!recentView) await prisma.jobView.create({ data: { jobId: job.id, viewerKey } });
  const { _count, ...publicJob } = job;
  res.json({ success: true, data: { ...publicJob, applicantCount: _count.applications } });
}));

router.post('/', authenticate, authorize('RECRUITER'), validate(jobSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const { skillIds, screeningQuestions, status, requiredSkills, ...jobData } = req.body;
  const job = await prisma.job.create({
    data: {
      ...jobData,
      companyId: recruiter.companyId,
      status: status || 'PENDING',
      skills: { create: skillIds.map((skillId) => ({ isRequired: requiredSkills ? requiredSkills.includes(skillId) : true, skill: { connect: { id: skillId } } })) }
    },
    include: { company: true, skills: { include: { skill: true } } }
  });
  if (screeningQuestions.length) await prisma.jobScreeningQuestion.createMany({ data: screeningQuestions.map(({ id, ...question }) => ({ ...question, jobId: job.id, options: question.options || undefined })) });
  if (job.status === 'PUBLISHED') {
    const followers = await prisma.companyFollow.findMany({ where: { companyId: job.companyId }, select: { candidate: { select: { userId: true } } } });
    if (followers.length) await prisma.notification.createMany({ data: followers.map(({ candidate }) => ({ userId: candidate.userId, type: 'NEW_COMPANY_JOB', title: 'Công ty bạn theo dõi có việc mới', content: `${job.title} đang tuyển dụng tại công ty bạn theo dõi.`, link: `/jobs/${job.id}` })) });
  }
  res.status(201).json({ success: true, data: job });
}));

router.patch('/:id', authenticate, authorize('RECRUITER'), validate(jobUpdateSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
  if (job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');

  const { skillIds, screeningQuestions, status, requiredSkills, ...jobData } = req.body;
  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      ...jobData,
      ...(skillIds ? { skills: { deleteMany: {}, create: skillIds.map((skillId) => ({ isRequired: requiredSkills ? requiredSkills.includes(skillId) : true, skill: { connect: { id: skillId } } })) } } : {})
    },
    include: { company: true, skills: { include: { skill: true } } }
  });
  if (screeningQuestions) {
    await prisma.jobScreeningQuestion.deleteMany({ where: { jobId: job.id } });
    if (screeningQuestions.length) await prisma.jobScreeningQuestion.createMany({ data: screeningQuestions.map(({ id, ...question }) => ({ ...question, jobId: job.id, options: question.options || undefined })) });
  }
  res.json({ success: true, data: updated });
}));

router.post('/:id/submit', authenticate, authorize('RECRUITER'), validate(jobIdSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!recruiter || !job) throw new ApiError(404, 'Không tìm thấy việc làm');
  if (job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  if (job.status !== 'DRAFT') throw new ApiError(400, 'Chỉ có thể gửi bản nháp để duyệt');
  const updated = await prisma.job.update({ where: { id: job.id }, data: { status: 'PENDING' } });
  res.json({ success: true, data: updated });
}));

router.post('/ai-description', authenticate, authorize('RECRUITER'), aiRateLimit, validate(aiDescriptionSchema), asyncHandler(async (req, res) => {
  const result = await generateJobDescription(req.user.id, req.body);
  if (!result) throw new ApiError(503, 'AI chưa được cấu hình hoặc tạm thời không khả dụng');
  res.json({ success: true, data: { description: result } });
}));

router.delete('/:id', authenticate, authorize('RECRUITER'), validate(jobIdSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
  if (job.companyId !== recruiter.companyId) throw new ApiError(403, 'Bạn không quản lý việc làm này');
  await prisma.job.update({ where: { id: job.id }, data: { status: 'CLOSED' } });
  res.json({ success: true, message: 'Đã đóng tin tuyển dụng' });
}));

module.exports = router;
module.exports.schemas = { jobSchema, jobUpdateSchema, jobIdSchema, listSchema };
module.exports.requireMatchingVersion = requireMatchingVersion;
