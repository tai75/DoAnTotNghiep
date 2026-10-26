const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const profileSchema = z.object({
  body: z.object({
    headline: z.string().max(180).nullable().optional(),
    bio: z.string().max(10000).nullable().optional(),
    location: z.string().max(150).nullable().optional(),
    yearsExperience: z.number().nonnegative().max(99.9).nullable().optional(),
    education: z.string().max(255).nullable().optional(),
    resumeUrl: z.string().url().max(500).nullable().optional(),
    desiredPosition: z.string().max(180).nullable().optional(),
    desiredSalary: z.number().nonnegative().nullable().optional(),
    desiredLocation: z.string().max(150).nullable().optional(),
    desiredEmploymentType: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID']).nullable().optional(),
    isSearchable: z.boolean().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({}),
  query: z.object({})
});

const skillsSchema = z.object({
  body: z.object({
    skillIds: z.array(z.number().int().positive()).max(100)
  }),
  params: z.object({}),
  query: z.object({})
});

const router = require('express').Router();

const uploadsDirectory = path.join(__dirname, '../../uploads');
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
function handleResumeUpload(req, res, next) {
  resumeUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof ApiError) return next(error);
    if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(400, 'CV không được vượt quá 5MB'));
    return next(new ApiError(400, 'File CV không hợp lệ'));
  });
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
    link: z.string().url().max(500).nullable().optional(),
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
          candidateId: resume.candidateId,
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

router.post('/me/resumes', authenticate, authorize('CANDIDATE'), handleResumeUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Vui lòng chọn file CV');
  const extension = path.extname(req.file.originalname).toLowerCase();
  const expectedMimeType = extension === '.pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (req.file.mimetype !== expectedMimeType) {
    fs.unlinkSync(req.file.path);
    throw new ApiError(400, 'Mime type của CV không hợp lệ');
  }

  const candidate = await findCandidate(req.user.id);
  const { isDefault } = resumeMetadataSchema.parse(req.body);
  const resume = await prisma.$transaction(async (transaction) => {
    const existingCount = await transaction.candidateResume.count({ where: { candidateId: candidate.id } });
    if (isDefault === 'true' || existingCount === 0) {
      await transaction.candidateResume.updateMany({ where: { candidateId: candidate.id }, data: { isDefault: false } });
    }
    return transaction.candidateResume.create({
      data: {
        candidateId: candidate.id,
        fileName: req.file.originalname,
        path: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        isDefault: isDefault === 'true' || existingCount === 0
      }
    });
  });
  res.status(201).json({ success: true, data: resume });
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
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm');
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
