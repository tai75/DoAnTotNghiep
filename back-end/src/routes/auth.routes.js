const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../config/prisma');
const config = require('../config/env');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều yêu cầu xác thực, vui lòng thử lại sau.' }
});

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

const passwordResetRequestSchema = z.object({
  body: z.object({ email: z.string().email() }),
  params: z.object({}),
  query: z.object({})
});

const passwordResetSchema = z.object({
  body: z.object({
    token: z.string().min(20),
    password: z.string().min(8)
  }),
  params: z.object({}),
  query: z.object({})
});

function createToken(user) {
  return jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  return Object.fromEntries((header || '').split(';').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
}

function setRefreshCookie(res, token) {
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  res.setHeader('Set-Cookie', `${config.refreshCookieName}=${encodeURIComponent(token)}; Max-Age=${maxAge / 1000}; Path=/api/auth; HttpOnly; SameSite=Lax${config.nodeEnv === 'production' ? '; Secure' : ''}`);
}

function clearRefreshCookie(res) {
  res.setHeader('Set-Cookie', `${config.refreshCookieName}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Lax${config.nodeEnv === 'production' ? '; Secure' : ''}`);
}

async function createSession(user, res) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });
  setRefreshCookie(res, refreshToken);
  return createToken(user);
}

async function sendResetLink(email, token) {
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
  if (!config.smtp.host || !config.smtp.user || !config.smtp.password) {
    console.info(`[password-reset] ${email}: ${link}`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password }
  });
  await transporter.sendMail({
    from: config.smtp.from,
    to: email,
    subject: 'Đặt lại mật khẩu Job Connect',
    text: `Mở liên kết sau để đặt lại mật khẩu: ${link}`
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

router.post('/register', authRateLimit, validate(registerSchema), asyncHandler(async (req, res) => {
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

  const token = await createSession(user, res);
  res.status(201).json({ success: true, data: { user: publicUser(user), token } });
}));

router.post('/login', authRateLimit, validate(loginSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw new ApiError(401, 'Thông tin đăng nhập không hợp lệ');
  }
  if (user.status !== 'ACTIVE') throw new ApiError(401, 'Thông tin đăng nhập không hợp lệ');
  const token = await createSession(user, res);
  res.json({ success: true, data: { user: publicUser(user), token } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const rawToken = parseCookies(req.headers.cookie)[config.refreshCookieName];
  if (!rawToken) throw new ApiError(401, 'Refresh token không tồn tại');
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || stored.user.status !== 'ACTIVE') {
    clearRefreshCookie(res);
    throw new ApiError(401, 'Refresh token không hợp lệ hoặc đã hết hạn');
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const token = await createSession(stored.user, res);
  res.json({ success: true, data: { user: publicUser(stored.user), token } });
}));

router.post('/password-reset/request', authRateLimit, validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!user) {
    res.json({ success: true, message: 'Nếu email tồn tại, yêu cầu đặt lại mật khẩu đã được tạo' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }
    })
  ]);
  await sendResetLink(user.email, token);
  res.json({
    success: true,
    message: 'Nếu email tồn tại, yêu cầu đặt lại mật khẩu đã được tạo',
    ...(config.nodeEnv !== 'production' ? { data: { token } } : {})
  });
}));

router.post('/password-reset/confirm', authRateLimit, validate(passwordResetSchema), asyncHandler(async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
    throw new ApiError(400, 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
  }
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: resetToken.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await transaction.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } });
  });
  res.json({ success: true, message: 'Đặt lại mật khẩu thành công' });
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
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } })
  ]);
  clearRefreshCookie(res);
  res.json({ success: true, message: 'Đăng xuất thành công' });
}));

module.exports = router;
module.exports.authRateLimit = authRateLimit;
