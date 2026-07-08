const { failure } = require("../utils/apiResponse");

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : "Something went wrong";

  if (!err.isOperational) {
    console.error(err);
  }

  return failure(res, { message, errors: err.errors, statusCode });
}

module.exports = errorMiddleware;
