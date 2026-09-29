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
    const payload = jwt.verify(token, config.jwtSecret);
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

module.exports = { authenticate, authorize };
