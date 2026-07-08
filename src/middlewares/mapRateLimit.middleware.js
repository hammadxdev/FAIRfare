// Basic per-IP fixed-window rate limiter for /api/maps/*. This protects
// against a buggy/rapid client hammering the backend; the daily Google
// usage limit (mapUsage.service.js) is the separate guard against runaway
// billing. In-memory only — fine for a single-instance FYP demo.
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

const requestLog = new Map();

function mapRateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();

  const entry = requestLog.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    requestLog.set(key, { windowStart: now, count: 1 });
    return next();
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      success: false,
      message: "Too many map requests. Please slow down and try again shortly.",
    });
  }

  entry.count += 1;
  next();
}

module.exports = mapRateLimit;
