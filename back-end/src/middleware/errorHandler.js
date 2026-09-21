const { Prisma } = require('@prisma/client');

function errorHandler(error, req, res, next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Đã xảy ra lỗi máy chủ';

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

  if (statusCode >= 500) console.error(error);
  res.status(statusCode).json({ success: false, message, details: error.details });
}

module.exports = errorHandler;
