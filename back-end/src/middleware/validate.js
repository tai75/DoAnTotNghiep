const ApiError = require('../utils/apiError');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({ body: req.body || {}, params: req.params || {}, query: req.query || {} });
    if (!result.success) {
      return next(new ApiError(400, 'Dữ liệu đầu vào không hợp lệ', result.error.flatten()));
    }
    req.body = result.data.body;
    req.params = result.data.params;
    Object.defineProperty(req, 'query', { value: result.data.query, writable: true, configurable: true });
    next();
  };
}

module.exports = validate;
