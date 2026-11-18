const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate, authorize, requireActiveRecruiterCompany, requireVerifiedRecruiterCompany } = require('../middleware/auth');

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const messageSchema = z.object({
  body: z.object({ content: z.string().trim().min(1).max(2000) }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({})
});
const sendMessageLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { success: false, message: 'Bạn đã gửi quá nhiều tin nhắn trong giờ này' }
});

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:lt|gt|amp|quot|#39);/gi, (entity) => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" }[entity.toLowerCase()] || entity)).trim();
}

async function participant(conversationId, user) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { application: { include: { candidate: true, job: true } } }
  });
  if (!conversation) throw new ApiError(404, 'Không tìm thấy cuộc trò chuyện');
  if (user.role === 'CANDIDATE' && conversation.application.candidate.userId !== user.id) throw new ApiError(403, 'Bạn không có quyền truy cập cuộc trò chuyện này');
  if (user.role === 'RECRUITER') {
    const recruiter = await prisma.recruiter.findUnique({ where: { userId: user.id } });
    if (!recruiter || recruiter.companyId !== conversation.application.job.companyId) throw new ApiError(403, 'Bạn không có quyền truy cập cuộc trò chuyện này');
  }
  return conversation;
}

const router = require('express').Router();

router.get('/unread-count', authenticate, authorize('CANDIDATE', 'RECRUITER'), requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, asyncHandler(async (req, res) => {
  const count = await prisma.message.count({
    where: {
      readAt: null,
      senderUserId: { not: req.user.id },
      conversation: {
        application: {
          OR: [
            { candidate: { userId: req.user.id } },
            { job: { company: { recruiters: { some: { userId: req.user.id } } } } }
          ]
        }
      }
    }
  });
  res.json({ success: true, data: { count } });
}));

router.get('/', authenticate, authorize('CANDIDATE', 'RECRUITER'), requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, asyncHandler(async (req, res) => {
  const where = req.user.role === 'CANDIDATE'
    ? { application: { candidate: { userId: req.user.id } } }
    : { application: { job: { company: { recruiters: { some: { userId: req.user.id } } } } } };
  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      application: { include: { job: { select: { id: true, title: true, companyId: true } }, candidate: { include: { user: { select: { id: true, fullName: true } } } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { messages: { where: { readAt: null, senderUserId: { not: req.user.id } } } } }
    },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ success: true, data: conversations.map((conversation) => ({
    id: conversation.id,
    applicationId: conversation.applicationId,
    job: conversation.application.job,
    candidate: conversation.application.candidate.user,
    lastMessage: conversation.messages[0] || null,
    unreadCount: conversation._count.messages
  })) });
}));

router.post('/applications/:id', authenticate, authorize('RECRUITER'), requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, validate(idSchema), asyncHandler(async (req, res) => {
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  const application = await prisma.application.findUnique({ where: { id: req.params.id }, include: { job: true } });
  if (!recruiter || !application || recruiter.companyId !== application.job.companyId) throw new ApiError(403, 'Bạn không có quyền mở cuộc trò chuyện này');
  const conversation = await prisma.conversation.upsert({
    where: { applicationId: application.id },
    update: {},
    create: { applicationId: application.id }
  });
  res.status(201).json({ success: true, data: conversation });
}));

router.get('/:id/messages', authenticate, authorize('CANDIDATE', 'RECRUITER'), requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, validate(idSchema), asyncHandler(async (req, res) => {
  const conversation = await participant(req.params.id, req.user);
  const messages = await prisma.message.findMany({ where: { conversationId: conversation.id }, include: { sender: { select: { id: true, fullName: true, role: true } } }, orderBy: { createdAt: 'asc' } });
  res.json({ success: true, data: messages });
}));

router.post('/:id/messages', authenticate, authorize('CANDIDATE', 'RECRUITER'), requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, sendMessageLimit, validate(messageSchema), asyncHandler(async (req, res) => {
  const conversation = await participant(req.params.id, req.user);
  const content = stripHtml(req.body.content);
  if (!content) throw new ApiError(400, 'Tin nhắn không được để trống');
  const message = await prisma.$transaction(async (transaction) => {
    const created = await transaction.message.create({ data: { conversationId: conversation.id, senderUserId: req.user.id, content }, include: { sender: { select: { id: true, fullName: true, role: true } } } });
    await transaction.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    return created;
  });
  res.status(201).json({ success: true, data: message });
}));

router.patch('/:id/read', authenticate, authorize('CANDIDATE', 'RECRUITER'), requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, validate(idSchema), asyncHandler(async (req, res) => {
  const conversation = await participant(req.params.id, req.user);
  await prisma.message.updateMany({ where: { conversationId: conversation.id, senderUserId: { not: req.user.id }, readAt: null }, data: { readAt: new Date() } });
  res.json({ success: true, data: { conversationId: conversation.id } });
}));

module.exports = router;
module.exports.stripHtml = stripHtml;
