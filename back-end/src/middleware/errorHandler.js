const { Prisma } = require('@prisma/client');
const { ZodError } = require('zod');

function errorHandler(error, req, res, next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Đã xảy ra lỗi máy chủ';

  if (error instanceof ZodError || error.name === 'ZodError') {
    statusCode = 400;
    message = 'Dữ liệu đầu vào không hợp lệ';
    error.details = error.flatten();
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      statusCode = 409;
      message = 'Dữ liệu đã tồn tại';
    }
    if (error.code === 'P2025') {
      statusCode = 404;
      message = 'Không tìm thấy dữ liệu';
    }
  }

  if (statusCode >= 500) {
    console.error({ requestId: req.id, name: error.name, statusCode });
    message = 'Đã xảy ra lỗi máy chủ';
  }
  const body = { success: false, message };
  if (statusCode < 500 && error.details) body.details = error.details;
  res.status(statusCode).json(body);
}

module.exports = errorHandler;
