const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 20;
const requests = new Map();

function emailRateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = requests.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requests.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (current.count >= MAX_REQUESTS) return res.status(429).json({ success: false, message: "Too many requests. Please try again shortly.", errorCode: "AUTH_RATE_LIMITED" });
  current.count += 1;
  return next();
}

module.exports = emailRateLimit;
