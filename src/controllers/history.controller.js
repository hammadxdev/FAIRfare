const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { getHistory, getHistoryById } = require("../services/history.service");

const listHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  return success(res, { message: "Comparison history fetched successfully", data: getHistory({ userId: req.user.id, limit, offset }) });
});

const readHistory = asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) throw new AppError("Invalid history id", 400);
  const entry = getHistoryById(id, req.user.id);
  if (!entry) throw new AppError("History entry not found", 404);
  return success(res, { message: "Comparison history fetched successfully", data: entry });
});

module.exports = { listHistory, readHistory };
