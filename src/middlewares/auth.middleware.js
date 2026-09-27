const AppError = require("../utils/AppError");
const { query } = require("../config/postgres");
const { verifyAccessToken } = require("../config/auth");

async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return next(new AppError("Authentication required", 401));
  try {
    const payload = verifyAccessToken(token);
    const { rows } = await query("SELECT id, name, email, email_verified_at, created_at, updated_at FROM users WHERE id = $1", [String(payload.sub)]);
    const row = rows[0];
    if (!row) throw new Error("User not found");
    req.user = { id: row.id, name: row.name, email: row.email, email_verified_at: row.email_verified_at, created_at: row.created_at, updated_at: row.updated_at };
    return next();
  } catch { return next(new AppError("Invalid or expired access token", 401)); }
}

module.exports = { requireAuth };
