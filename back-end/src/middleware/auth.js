const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const config = require('../config/env');
const ApiError = require('../utils/apiError');

function recruiterCompanyAccess(company, requireVerified = false) {
  if (!company || company.status !== 'ACTIVE') return { allowed: false, reason: 'SUSPENDED' };
  if (requireVerified && company.verificationStatus !== 'VERIFIED') {
    return { allowed: false, reason: 'UNVERIFIED', verificationStatus: company.verificationStatus };
  }
  return { allowed: true };
}

async function accessSessionUser(payload, database = prisma, now = new Date()) {
  if (typeof payload.sid !== 'string' || !payload.sid) return null;
  const session = await database.authSession.findUnique({
    where: { id: payload.sid },
    include: { user: true }
  });
  const user = session?.user;
  if (!session || session.userId !== payload.userId || session.revokedAt || session.expiresAt <= now
    || !user || user.status !== 'ACTIVE' || user.tokenVersion !== (payload.tokenVersion || 0)) return null;
  return { user, session };
}

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
    const authenticated = await accessSessionUser(payload);
    if (!authenticated) {
      return next(new ApiError(401, 'Tài khoản không hợp lệ hoặc đã bị khóa'));
    }
    req.user = authenticated.user;
    req.authSession = authenticated.session;
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
        company: { select: { status: true, verificationStatus: true, verificationVersion: true } }
      }
    });
    if (!recruiterCompanyAccess(recruiter?.company).allowed) {
      return next(new ApiError(403, 'Doanh nghiệp đang bị đình chỉ hoạt động'));
    }
    req.recruiter = recruiter;
    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireVerifiedRecruiterCompany(req, res, next) {
  if (!req.user || req.user.role !== 'RECRUITER') return next();
  try {
    let recruiter = req.recruiter;
    if (!recruiter?.company?.verificationStatus) {
      recruiter = await prisma.recruiter.findUnique({
        where: { userId: req.user.id },
        select: { id: true, companyId: true, company: { select: { status: true, verificationStatus: true, verificationVersion: true } } }
      });
    }
    const access = recruiterCompanyAccess(recruiter?.company, true);
    if (access.reason === 'SUSPENDED') {
      return next(new ApiError(403, 'Doanh nghiệp đang bị đình chỉ hoạt động'));
    }
    if (!access.allowed) {
      return next(new ApiError(403, 'Doanh nghiệp phải được xác minh trước khi thực hiện thao tác này', {
        code: 'COMPANY_VERIFICATION_REQUIRED',
        verificationStatus: recruiter.company.verificationStatus
      }));
    }
    req.recruiter = recruiter;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { authenticate, authorize, requireActiveRecruiterCompany, requireVerifiedRecruiterCompany, recruiterCompanyAccess, accessSessionUser };
