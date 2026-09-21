const ApiError = require('../utils/apiError');

module.exports = (req, res, next) => next(new ApiError(404, 'Không tìm thấy API'));
