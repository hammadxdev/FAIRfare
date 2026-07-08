function success(res, { message = "Success", data = null, statusCode = 200 } = {}) {
  return res.status(statusCode).json({ success: true, message, data });
}

function failure(res, { message = "Something went wrong", errors = null, statusCode = 500 } = {}) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

module.exports = { success, failure };
