const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/apiResponse");
const service = require("../services/auth.service");
const db = require("../config/database");
const { normalizeEmail, basicEmail, safeUser } = require("../utils/auth");

function credentials(body, requireName = false) {
  const errors = []; const name = String(body.name || "").trim(); const email = normalizeEmail(body.email); const password = String(body.password || "");
  if (requireName && !name) errors.push("name is required");
  if (!basicEmail(email)) errors.push("email must be valid");
  if (password.length < 8) errors.push("password must be at least 8 characters");
  if (errors.length) throw new AppError("Validation failed", 400, errors);
  return { name, email, password };
}
const register = asyncHandler(async (req, res) => { const data = credentials(req.body, true); try { return success(res, { message: "Registration successful", data: service.register(data) }); } catch (e) { if (e.code === "SQLITE_CONSTRAINT_UNIQUE") throw new AppError("An account with that email already exists", 409); throw e; } });
const login = asyncHandler(async (req, res) => { const email = normalizeEmail(req.body.email); const password = String(req.body.password || ""); if (!basicEmail(email) || !password) throw new AppError("Invalid email or password", 401); return success(res, { message: "Login successful", data: service.login({ email, password }) }); });
const refresh = asyncHandler(async (req, res) => success(res, { message: "Session refreshed", data: service.refresh(req.body.refreshToken) }));
const logout = asyncHandler(async (req, res) => { service.logout(req.body.refreshToken); return success(res, { message: "Logged out successfully", data: null }); });
const me = asyncHandler(async (req, res) => { const row = db.prepare("SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?").get(req.user.id); return success(res, { message: "Authenticated user fetched successfully", data: safeUser(row) }); });
module.exports = { register, login, refresh, logout, me };
