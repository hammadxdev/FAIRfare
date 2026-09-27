const { failure } = require("../utils/apiResponse");

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : "Something went wrong";
  const errorCode = /^(EMAIL|RESET|AUTH)_/.test(String(err.code || "")) ? err.code : null;

  if (!err.isOperational && !err.suppressRawLog) {
    console.error(err);
  }

  return failure(res, { message, errors: err.errors, errorCode, statusCode });
}

module.exports = errorMiddleware;
