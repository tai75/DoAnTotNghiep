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
const { consumePasswordResetToken, requestPasswordReset } = require('../services/passwordRecovery.service');

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều yêu cầu xác thực, vui lòng thử lại sau.' }
});
const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều yêu cầu làm mới phiên đăng nhập, vui lòng thử lại sau.' }
});
const passwordResetRequestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều yêu cầu đặt lại mật khẩu, vui lòng thử lại sau.' }
});

const registerSchema = z.object({
  body: z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(128),
    fullName: z.string().trim().min(2).max(150),
    phone: z.string().trim().max(30).optional(),
    role: z.enum(['CANDIDATE', 'RECRUITER']).default('CANDIDATE'),
    companyName: z.string().trim().min(2).max(180).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const loginSchema = z.object({
  body: z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) }),
  params: z.object({}),
  query: z.object({})
});

const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(150).optional(),
    phone: z.string().trim().max(30).nullable().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Cần có ít nhất một trường để cập nhật'),
  params: z.object({}),
  query: z.object({})
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128)
  }),
  params: z.object({}),
  query: z.object({})
});

const passwordResetRequestSchema = z.object({
  body: z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }),
  params: z.object({}),
  query: z.object({})
});

const passwordResetSchema = z.object({
  body: z.object({
    token: z.string().min(20),
    password: z.string().min(8).max(128)
  }),
  params: z.object({}),
  query: z.object({})
});

function createToken(user, sessionId) {
  return jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion, sid: sessionId }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    subject: String(user.id)
  });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  return Object.fromEntries((header || '').split(';').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return ['', ''];
    const key = part.slice(0, separator).trim();
    try {
      return [key, decodeURIComponent(part.slice(separator + 1).trim())];
    } catch {
      return [key, ''];
    }
  }));
}

function durationToMs(value) {
  const match = /^(\d+)(ms|s|m|h|d)$/i.exec(String(value || '').trim());
  if (!match) throw new Error('REFRESH_TOKEN_EXPIRES_IN must use ms, s, m, h, or d');
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = Number(match[1]) * factors[match[2].toLowerCase()];
  if (!Number.isSafeInteger(duration) || duration < 60_000) throw new Error('REFRESH_TOKEN_EXPIRES_IN must be at least one minute');
  return duration;
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.refreshCookieSameSite,
    path: '/api/auth',
    maxAge: durationToMs(config.refreshTokenExpiresIn)
  };
}

function setRefreshCookie(res, token) {
  res.cookie(config.refreshCookieName, token, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(config.refreshCookieName, options);
}

function isRetryableTransactionError(error) {
  return error?.code === 'P2034' || /deadlock|write conflict/i.test(error?.message || '');
}

async function runSerializable(database, work, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await database.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5));
    }
  }
  throw new Error('Serializable transaction retry exhausted');
}

async function createSession(user, res, database = prisma) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + durationToMs(config.refreshTokenExpiresIn));
  await runSerializable(database, async (transaction) => {
    await transaction.authSession.create({ data: { id: sessionId, userId: user.id, expiresAt } });
    await transaction.refreshToken.create({
      data: { userId: user.id, sessionId, tokenHash: hashToken(refreshToken), expiresAt }
    });
  });
  setRefreshCookie(res, refreshToken);
  return createToken(user, sessionId);
}

async function rotateRefreshToken(rawToken, database = prisma, now = new Date()) {
  const tokenHash = hashToken(rawToken);
  return runSerializable(database, async (transaction) => {
    const stored = await transaction.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true, session: true }
    });
    if (!stored) return { status: 'invalid' };
    if (!stored.sessionId || !stored.session || stored.session.userId !== stored.userId) return { status: 'legacy' };

    if (stored.revokedAt) {
      await transaction.authSession.updateMany({
        where: { id: stored.sessionId, userId: stored.userId, revokedAt: null },
        data: { revokedAt: now }
      });
      await transaction.refreshToken.updateMany({
        where: { sessionId: stored.sessionId, revokedAt: null },
        data: { revokedAt: now }
      });
      return { status: 'replay' };
    }
    if (stored.expiresAt <= now || stored.session.expiresAt <= now || stored.session.revokedAt || stored.user.status !== 'ACTIVE') {
      await transaction.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: now } });
      return { status: 'invalid' };
    }

    const claimed = await transaction.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now }
    });
    if (claimed.count !== 1) {
      await transaction.authSession.updateMany({
        where: { id: stored.sessionId, userId: stored.userId, revokedAt: null },
        data: { revokedAt: now }
      });
      await transaction.refreshToken.updateMany({
        where: { sessionId: stored.sessionId, revokedAt: null },
        data: { revokedAt: now }
      });
      return { status: 'replay' };
    }

    const nextToken = crypto.randomBytes(48).toString('base64url');
    const expiresAt = new Date(now.getTime() + durationToMs(config.refreshTokenExpiresIn));
    const extended = await transaction.authSession.updateMany({
      where: { id: stored.sessionId, userId: stored.userId, revokedAt: null, expiresAt: { gt: now } },
      data: { expiresAt }
    });
    if (extended.count !== 1) return { status: 'invalid' };
    await transaction.refreshToken.create({
      data: {
        userId: stored.userId,
        sessionId: stored.sessionId,
        tokenHash: hashToken(nextToken),
        expiresAt
      }
    });
    return { status: 'ok', user: stored.user, sessionId: stored.sessionId, refreshToken: nextToken };
  });
}

async function revokeRefreshSession(rawToken, database = prisma, now = new Date()) {
  if (!rawToken) return { status: 'missing' };
  const tokenHash = hashToken(rawToken);
  return runSerializable(database, async (transaction) => {
    const stored = await transaction.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return { status: 'invalid' };
    if (!stored.sessionId) return { status: 'legacy' };
    await transaction.authSession.updateMany({
      where: { id: stored.sessionId, userId: stored.userId, revokedAt: null },
      data: { revokedAt: now }
    });
    await transaction.refreshToken.updateMany({
      where: { sessionId: stored.sessionId, revokedAt: null },
      data: { revokedAt: now }
    });
    return { status: 'revoked' };
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
      await transaction.candidate.create({ data: { userId: createdUser.id, isSearchable: false } });
    } else {
      const company = await transaction.company.create({ data: { name: companyName, verificationStatus: 'UNVERIFIED' } });
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

router.post('/refresh', refreshRateLimit, asyncHandler(async (req, res) => {
  const rawToken = parseCookies(req.headers.cookie)[config.refreshCookieName];
  if (!rawToken) throw new ApiError(401, 'Refresh token không tồn tại');
  const result = await rotateRefreshToken(rawToken);
  if (result.status !== 'ok') {
    clearRefreshCookie(res);
    throw new ApiError(401, 'Refresh token không hợp lệ hoặc đã hết hạn');
  }
  setRefreshCookie(res, result.refreshToken);
  res.json({ success: true, data: { user: publicUser(result.user), token: createToken(result.user, result.sessionId) } });
}));

router.post('/password-reset/request', passwordResetRequestRateLimit, validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
  res.json(await requestPasswordReset(req.body.email));
}));

router.post('/password-reset/confirm', authRateLimit, validate(passwordResetSchema), asyncHandler(async (req, res) => {
  await consumePasswordResetToken(req.body.token, req.body.password);
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
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.authSession.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } })
  ]);
  clearRefreshCookie(res);
  res.json({ success: true, message: 'Đổi mật khẩu thành công, vui lòng đăng nhập lại' });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const rawToken = parseCookies(req.headers.cookie)[config.refreshCookieName];
  await revokeRefreshSession(rawToken);
  clearRefreshCookie(res);
  res.json({ success: true, message: 'Đăng xuất thành công' });
}));

module.exports = router;
module.exports.authRateLimit = authRateLimit;
module.exports.passwordResetRequestRateLimit = passwordResetRequestRateLimit;
module.exports.refreshRateLimit = refreshRateLimit;
module.exports.durationToMs = durationToMs;
module.exports.refreshCookieOptions = refreshCookieOptions;
module.exports.createSession = createSession;
module.exports.createToken = createToken;
module.exports.isRetryableTransactionError = isRetryableTransactionError;
module.exports.runSerializable = runSerializable;
module.exports.rotateRefreshToken = rotateRefreshToken;
module.exports.revokeRefreshSession = revokeRefreshSession;
