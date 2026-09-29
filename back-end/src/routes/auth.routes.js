const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../config/prisma');
const config = require('../config/env');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(2).max(150),
    phone: z.string().max(30).optional(),
    role: z.enum(['CANDIDATE', 'RECRUITER']).default('CANDIDATE'),
    companyName: z.string().min(2).max(180).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const loginSchema = z.object({
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
  params: z.object({}),
  query: z.object({})
});

const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).max(150).optional(),
    phone: z.string().max(30).nullable().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({}),
  query: z.object({})
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8)
  }),
  params: z.object({}),
  query: z.object({})
});

function createToken(user) {
  return jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    status: user.status
  };
}

const router = require('express').Router();

router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, fullName, phone, role, companyName } = req.body;
  if (role === 'RECRUITER' && !companyName) {
    throw new ApiError(400, 'companyName là bắt buộc với nhà tuyển dụng');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (transaction) => {
    const createdUser = await transaction.user.create({
      data: { email, passwordHash, fullName, phone, role }
    });
    if (role === 'CANDIDATE') {
      await transaction.candidate.create({ data: { userId: createdUser.id } });
    } else {
      const company = await transaction.company.create({ data: { name: companyName } });
      await transaction.recruiter.create({
        data: { userId: createdUser.id, companyId: company.id }
      });
    }
    return createdUser;
  });

  res.status(201).json({ success: true, data: { user: publicUser(user), token: createToken(user) } });
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw new ApiError(401, 'Email hoặc mật khẩu không đúng');
  }
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'Tài khoản không hoạt động');
  res.json({ success: true, data: { user: publicUser(user), token: createToken(user) } });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      candidate: true,
      recruiter: { include: { company: true } }
    }
  });
  res.json({ success: true, data: user });
}));

router.patch('/me', authenticate, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.user.id }, data: req.body });
  res.json({ success: true, data: publicUser(user) });
}));

router.patch('/me/password', authenticate, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  if (!(await bcrypt.compare(req.body.currentPassword, req.user.passwordHash))) {
    throw new ApiError(400, 'Mật khẩu hiện tại không đúng');
  }
  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash, tokenVersion: { increment: 1 } }
  });
  res.json({ success: true, message: 'Đổi mật khẩu thành công, vui lòng đăng nhập lại' });
}));

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } });
  res.json({ success: true, message: 'Đăng xuất thành công' });
}));

module.exports = router;
