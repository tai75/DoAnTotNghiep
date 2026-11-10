const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const config = require('../config/env');
const ApiError = require('../utils/apiError');

async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization && authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token) return next(new ApiError(401, 'Vui lòng đăng nhập'));

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience
    });
    if (payload.sub !== String(payload.userId)) {
      return next(new ApiError(401, 'Token không hợp lệ hoặc đã hết hạn'));
    }
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== (payload.tokenVersion || 0)) {
      return next(new ApiError(401, 'Tài khoản không hợp lệ hoặc đã bị khóa'));
    }
    req.user = user;
    next();
  } catch (error) {
    next(new ApiError(401, 'Token không hợp lệ hoặc đã hết hạn'));
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Bạn không có quyền thực hiện thao tác này'));
    }
    next();
  };
}

async function requireActiveRecruiterCompany(req, res, next) {
  if (!req.user || req.user.role !== 'RECRUITER') return next();

  try {
    const recruiter = await prisma.recruiter.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        companyId: true,
        company: { select: { status: true } }
      }
    });
    if (!recruiter || recruiter.company?.status !== 'ACTIVE') {
      return next(new ApiError(403, 'Doanh nghiệp đang bị đình chỉ hoạt động'));
    }
    req.recruiter = recruiter;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { authenticate, authorize, requireActiveRecruiterCompany };
