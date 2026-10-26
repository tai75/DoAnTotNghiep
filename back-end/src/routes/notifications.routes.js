const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});

const listSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    isRead: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

const router = require('express').Router();

router.get('/', authenticate, validate(listSchema), asyncHandler(async (req, res) => {
  const { isRead, page, limit } = req.query;
  const where = { userId: req.user.id, ...(isRead === undefined ? {} : { isRead }) };
  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.notification.count({ where })
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
}));

router.patch('/:id/read', authenticate, validate(idSchema), asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!notification) throw new ApiError(404, 'Không tìm thấy thông báo');
  const updated = await prisma.notification.update({ where: { id: notification.id }, data: { isRead: true } });
  res.json({ success: true, data: updated });
}));

router.patch('/read-all', authenticate, asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
  res.json({ success: true, message: 'Đã đánh dấu tất cả thông báo là đã đọc' });
}));

router.delete('/:id', authenticate, validate(idSchema), asyncHandler(async (req, res) => {
  const result = await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  if (!result.count) throw new ApiError(404, 'Không tìm thấy thông báo');
  res.status(204).send();
}));

module.exports = router;
