const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const accessSecret = process.env.JWT_ACCESS_SECRET || (process.env.NODE_ENV === "test" ? "test-only-fairfare-access-secret" : null);
const accessTtl = process.env.ACCESS_TOKEN_TTL || "15m";
// Refresh sessions use a sliding 30-day lifetime. Keep the existing seconds
// setting as the single source of truth for backwards compatibility.
const refreshTtlSeconds = Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 30);

if (!Number.isFinite(refreshTtlSeconds) || refreshTtlSeconds <= 0) {
  throw new Error("REFRESH_TOKEN_TTL_SECONDS must be a positive number");
}

function requireAccessSecret() {
  if (!accessSecret) throw new Error("JWT_ACCESS_SECRET is not configured");
  return accessSecret;
}

function validateAuthConfig() {
  if (process.env.NODE_ENV === "test") return;
  requireAccessSecret();
}

function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email, name: user.name }, requireAccessSecret(), { expiresIn: accessTtl });
}

function verifyAccessToken(token) { return jwt.verify(token, requireAccessSecret()); }
function createRefreshToken() { return crypto.randomBytes(48).toString("base64url"); }
function hashRefreshToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

module.exports = { accessTtl, refreshTtlSeconds, signAccessToken, verifyAccessToken, createRefreshToken, hashRefreshToken, validateAuthConfig };
