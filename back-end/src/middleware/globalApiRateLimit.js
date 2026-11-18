const rateLimit = require('express-rate-limit');
const config = require('../config/env');

function createGlobalApiRateLimit(limit = config.apiRateLimitMax) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' }
  });
}

module.exports = { createGlobalApiRateLimit };
