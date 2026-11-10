const { z } = require('zod');
const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const ApiError = require('../utils/apiError');
const multer = require('multer');
const path = require('path');
const storage = require('../storage/localStorage');
const { validLogo } = require('../storage/fileValidation');

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const reviewSchema = z.object({
  body: z.object({
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().trim().min(1).max(180),
    pros: z.string().trim().min(1).max(10000),
    cons: z.string().trim().min(1).max(10000),
    isAnonymous: z.boolean().default(false)
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const httpUrl = z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'URL phải dùng http hoặc https');

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(180),
    description: z.string().max(20000).optional(),
    website: httpUrl.optional(),
    address: z.string().max(255).optional(),
    employeeCount: z.coerce.number().int().nonnegative().nullable().optional(),
    industry: z.string().max(150).nullable().optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const router = require('express').Router();
const listSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().trim().max(180).optional(),
    industry: z.string().trim().max(150).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(24).default(12)
  })
});
const allowedLogoTypes = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']]
]);
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extensions = allowedLogoTypes.get(file.mimetype);
    if (!extensions?.includes(path.extname(file.originalname).toLowerCase())) {
      return callback(new ApiError(400, 'Logo chỉ được phép ở định dạng JPG hoặc PNG'));
    }
    callback(null, true);
  }
});

function hasValidLogoSignature(fileOrBuffer, mimeType) {
  const buffer = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : require('fs').readFileSync(fileOrBuffer);
  return validLogo(buffer, mimeType);
}

router.get('/me', authenticate, authorize('RECRUITER'), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id }, include: { company: true } });
  if (!recruiter) return res.status(403).json({ success: false, message: 'Tài khoản chưa được liên kết với nhà tuyển dụng' });
  res.json({ success: true, data: recruiter.company });
}));

router.get('/', validate(listSchema), asyncHandler(async (req, res) => {
  const { search, industry, page, limit } = req.query;
  const activeJobs = { status: 'PUBLISHED', OR: [{ deadline: { gte: new Date() } }, { deadline: null }] };
  const where = {
    jobs: { some: activeJobs },
    ...(search ? { OR: [{ name: { contains: search } }, { industry: { contains: search } }, { address: { contains: search } }] } : {}),
    ...(industry ? { industry: { equals: industry } } : {})
  };
  const [items, total, industries] = await prisma.$transaction([
    prisma.company.findMany({
      where,
      select: {
        id: true, name: true, description: true, logoUrl: true, address: true,
        employeeCount: true, industry: true,
        _count: { select: { jobs: { where: activeJobs } } }
      },
      orderBy: [{ jobs: { _count: 'desc' } }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.company.count({ where }),
    prisma.company.findMany({
      where: { jobs: { some: activeJobs }, industry: { not: null } },
      distinct: ['industry'],
      select: { industry: true },
      orderBy: { industry: 'asc' }
    })
  ]);
  res.json({
    success: true,
    data: {
      items: items.map(({ _count, ...company }) => ({ ...company, activeJobCount: _count.jobs })),
      industries: industries.map(({ industry: value }) => value).filter(Boolean),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    }
  });
}));

router.post('/:id/follow', authenticate, authorize('CANDIDATE'), validate(idSchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!candidate || !company) return res.status(404).json({ success: false, message: 'Không tìm thấy công ty' });
  const follow = await prisma.companyFollow.upsert({ where: { candidateId_companyId: { candidateId: candidate.id, companyId: company.id } }, create: { candidateId: candidate.id, companyId: company.id }, update: {} });
  res.json({ success: true, data: { following: true, follow } });
}));

router.delete('/:id/follow', authenticate, authorize('CANDIDATE'), validate(idSchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  await prisma.companyFollow.deleteMany({ where: { candidateId: candidate?.id || 0, companyId: req.params.id } });
  res.json({ success: true, data: { following: false } });
}));

router.get('/:id/following', authenticate, authorize('CANDIDATE'), validate(idSchema), asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: req.user.id } });
  const follow = await prisma.companyFollow.findUnique({ where: { candidateId_companyId: { candidateId: candidate?.id || 0, companyId: req.params.id } } });
  res.json({ success: true, data: { following: Boolean(follow) } });
}));

router.post('/:id/reviews', authenticate, authorize('CANDIDATE'), validate(reviewSchema), asyncHandler(async (req, res) => {
  const body = req.body;
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) throw new ApiError(404, 'Không tìm thấy công ty');
  try {
    const review = await prisma.companyReview.create({ data: { ...body, companyId: company.id, userId: req.user.id } });
    const { userId, ...safeReview } = review;
    res.status(201).json({ success: true, data: { ...safeReview, author: body.isAnonymous ? null : { id: req.user.id } } });
  } catch (error) {
    if (error.code === 'P2002') throw new ApiError(409, 'Bạn đã viết review cho công ty này');
    throw error;
  }
}));

router.get('/:id', validate(idSchema), asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: {
      jobs: {
        where: { status: 'PUBLISHED', OR: [{ deadline: { gte: new Date() } }, { deadline: null }] },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, companyId: true, title: true, description: true, location: true, employmentType: true,
          minSalary: true, maxSalary: true, requiredYearsExperience: true, deadline: true, createdAt: true, updatedAt: true,
          skills: { include: { skill: true } },
          _count: { select: { applications: true } }
        }
      },
      reviews: { where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, select: { id: true, rating: true, title: true, pros: true, cons: true, isAnonymous: true, status: true, createdAt: true, user: { select: { id: true, fullName: true } } } },
      _count: { select: { followers: true } }
    }
  });
  if (!company) return res.status(404).json({ success: false, message: 'Không tìm thấy công ty' });
  const reviews = company.reviews.map(({ user, ...review }) => ({ ...review, author: review.isAnonymous ? null : { id: user.id, fullName: user.fullName } }));
  const averageRating = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null;
  res.json({ success: true, data: { ...company, reviews, averageRating, followerCount: company._count.followers, jobs: company.jobs.map(({ _count, ...job }) => ({ ...job, applicantCount: _count.applications })) } });
}));

router.patch('/me', authenticate, authorize('RECRUITER'), validate(updateSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) return res.status(403).json({ success: false, message: 'Tài khoản chưa được liên kết với nhà tuyển dụng' });
  const company = await prisma.company.update({ where: { id: recruiter.companyId }, data: req.body });
  res.json({ success: true, data: company });
}));

router.post('/me/logo', authenticate, authorize('RECRUITER'), (req, res, next) => {
  logoUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({ success: false, message: error.message || 'Logo không hợp lệ' });
  });
}, asyncHandler(async (req, res) => {
  let newKey;
  try {
    if (!req.file) throw new ApiError(400, 'Vui lòng chọn logo');
    if (!hasValidLogoSignature(req.file.buffer, req.file.mimetype)) throw new ApiError(400, 'Nội dung logo không đúng định dạng');
    const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
    if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
    const currentCompany = await prisma.company.findUnique({ where: { id: recruiter.companyId }, select: { logoUrl: true } });
    newKey = storage.createKey(req.file.mimetype === 'image/png' ? '.png' : '.jpg');
    await storage.put(storage.namespaces.logos, newKey, req.file.buffer);
    const company = await prisma.company.update({
      where: { id: recruiter.companyId },
      data: { logoUrl: `/assets/logos/${newKey}` }
    });
    if (currentCompany?.logoUrl && currentCompany.logoUrl !== company.logoUrl) {
      const remainingReferences = await prisma.company.count({ where: { logoUrl: currentCompany.logoUrl } });
      if (!remainingReferences) {
        await storage.removeManaged(storage.namespaces.logos, currentCompany.logoUrl).catch((error) => {
          console.error({ name: error.name, code: error.code, component: 'logo-cleanup', companyId: company.id });
        });
      }
    }
    res.json({ success: true, data: company });
  } catch (error) {
    if (newKey) await storage.removeManaged(storage.namespaces.logos, newKey).catch(() => {});
    throw error;
  }
}));

module.exports = router;
module.exports.hasValidLogoSignature = hasValidLogoSignature;
