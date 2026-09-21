const { z } = require('zod');
const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

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

router.get('/:id', asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: Number(req.params.id) },
    include: { jobs: { where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' } } }
  });
  if (!company) return res.status(404).json({ success: false, message: 'Không tìm thấy công ty' });
  res.json({ success: true, data: company });
}));

router.patch('/me', authenticate, authorize('RECRUITER'), validate(updateSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const company = await prisma.company.update({ where: { id: recruiter.companyId }, data: req.body });
  res.json({ success: true, data: company });
}));

module.exports = router;
