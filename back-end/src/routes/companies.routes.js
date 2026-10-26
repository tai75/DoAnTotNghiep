const { z } = require('zod');
const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(180),
    description: z.string().optional(),
    website: z.string().url().optional(),
    address: z.string().max(255).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const router = require('express').Router();
const uploadsDirectory = path.join(__dirname, '../../uploads');
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(uploadsDirectory, { recursive: true });
      callback(null, uploadsDirectory);
    },
    filename: (req, file, callback) => callback(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Logo chỉ được phép ở định dạng JPG, PNG hoặc WebP'));
    }
    callback(null, true);
  }
});

router.get('/me', authenticate, authorize('RECRUITER'), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id }, include: { company: true } });
  if (!recruiter) return res.status(403).json({ success: false, message: 'Tài khoản chưa được liên kết với nhà tuyển dụng' });
  res.json({ success: true, data: recruiter.company });
}));

router.get('/:id', validate(idSchema), asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { jobs: { where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' } } }
  });
  if (!company) return res.status(404).json({ success: false, message: 'Không tìm thấy công ty' });
  res.json({ success: true, data: company });
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
  if (!req.file) return res.status(400).json({ success: false, message: 'Vui lòng chọn logo' });
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) return res.status(403).json({ success: false, message: 'Tài khoản chưa được liên kết với nhà tuyển dụng' });
  const company = await prisma.company.update({
    where: { id: recruiter.companyId },
    data: { logoUrl: `/assets/${req.file.filename}` }
  });
  res.json({ success: true, data: company });
}));

module.exports = router;
