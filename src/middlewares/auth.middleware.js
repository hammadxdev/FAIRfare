const AppError = require("../utils/AppError");
const db = require("../config/database");
const { verifyAccessToken } = require("../config/auth");

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return next(new AppError("Authentication required", 401));
  try {
    const payload = verifyAccessToken(token);
    const row = db.prepare("SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?").get(Number(payload.sub));
    if (!row) throw new Error("User not found");
    req.user = { id: row.id, name: row.name, email: row.email };
    return next();
  } catch { return next(new AppError("Invalid or expired access token", 401)); }
}

module.exports = { requireAuth };
