const crypto = require("crypto");
const { query } = require("../config/postgres");

const WINDOW_SQL = `
  INSERT INTO api_rate_limits (bucket_key, subject_hash, window_started_at, request_count)
  VALUES ($1, $2, now(), 1)
  ON CONFLICT (bucket_key, subject_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN api_rate_limits.window_started_at <= now() - ($3 * interval '1 second') THEN now()
      ELSE api_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN api_rate_limits.window_started_at <= now() - ($3 * interval '1 second') THEN 1
      ELSE api_rate_limits.request_count + 1
    END
  RETURNING request_count,
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (api_rate_limits.window_started_at + ($3 * interval '1 second') - now()))))::integer AS retry_after
`;

function hashSubject(value, secret = process.env.JWT_ACCESS_SECRET) {
  if (!secret) throw new Error("Rate-limit hashing is not configured");
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

function createGuestRateLimiter({ bucket, limit, windowSeconds, consume = query, hash = hashSubject }) {
  if (!bucket || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new TypeError("A bucket, positive limit, and positive window are required");
  }
  return async function guestRateLimit(req, res, next) {
    try {
      const remoteAddress = req.ip || req.socket?.remoteAddress || "unknown";
      const identities = [`ip:${remoteAddress}`];
      if (req.user?.id) identities.push(`user:${req.user.id}|ip:${remoteAddress}`);
      let exceeded = null;
      for (const identity of identities) {
        const { rows } = await consume(WINDOW_SQL, [bucket, hash(identity), windowSeconds]);
        const row = rows?.[0];
        if (Number(row?.request_count || 0) > limit) exceeded = Number(row?.retry_after) || windowSeconds;
      }
      if (exceeded) {
        res.set("Retry-After", String(exceeded));
        return res.status(429).json({
          success: false,
          message: "Too many requests. Please try again later.",
          errorCode: "RATE_LIMIT_EXCEEDED",
          retryAfterSeconds: exceeded,
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createGuestRateLimiter, hashSubject, WINDOW_SQL };
