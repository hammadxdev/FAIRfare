const bcrypt = require("bcryptjs");
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { signAccessToken, refreshTtlSeconds, createRefreshToken, hashRefreshToken } = require("../config/auth");
const { safeUser } = require("../utils/auth");

const USER_SELECT = "SELECT id, name, email, password_hash, created_at, updated_at FROM users";
function issueSession(user) {
  const refreshToken = createRefreshToken();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, last_used_at) VALUES (?, ?, ?, ?)").run(user.id, hashRefreshToken(refreshToken), now + refreshTtlSeconds, now);
  return { user: safeUser(user), accessToken: signAccessToken(user), refreshToken, expiresIn: refreshTtlSeconds };
}
function register({ name, email, password }) {
  const result = db.prepare("INSERT INTO users (name, email, password_hash, updated_at) VALUES (?, ?, ?, datetime('now'))").run(name.trim(), email, bcrypt.hashSync(password, 12));
  return issueSession(db.prepare(`${USER_SELECT} WHERE id = ?`).get(result.lastInsertRowid));
}
function login({ email, password }) {
  const user = db.prepare(`${USER_SELECT} WHERE email = ? COLLATE NOCASE`).get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new AppError("Invalid email or password", 401);
  return issueSession(user);
}
function refresh(refreshToken) {
  const hash = hashRefreshToken(refreshToken || "");
  const row = db.prepare("SELECT u.id, u.name, u.email, u.password_hash, u.created_at, u.updated_at FROM users u JOIN user_sessions s ON s.user_id = u.id WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?").get(hash, Math.floor(Date.now() / 1000));
  if (!row) throw new AppError("Invalid or expired refresh token", 401);
  const next = createRefreshToken(); const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    db.prepare("UPDATE user_sessions SET revoked_at = ?, last_used_at = ? WHERE refresh_token_hash = ?").run(now, now, hash);
    db.prepare("INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, last_used_at) VALUES (?, ?, ?, ?)").run(row.id, hashRefreshToken(next), now + refreshTtlSeconds, now);
  })();
  return { user: safeUser(row), accessToken: signAccessToken(row), refreshToken: next, expiresIn: refreshTtlSeconds };
}
function logout(refreshToken) { if (refreshToken) db.prepare("UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE refresh_token_hash = ?").run(Math.floor(Date.now() / 1000), hashRefreshToken(refreshToken)); }
module.exports = { register, login, refresh, logout };
