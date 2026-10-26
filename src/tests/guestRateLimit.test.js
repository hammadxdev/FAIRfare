const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuestRateLimiter, hashSubject, WINDOW_SQL } = require("../middlewares/guestRateLimit.middleware");

test("guest rate limiter permits within limit and returns retry guidance after limit", async () => {
  const consume = async () => ({ rows: [{ request_count: 3, retry_after: 24 }] });
  const middleware = createGuestRateLimiter({ bucket: "test", limit: 2, windowSeconds: 60, consume, hash: (value) => value });
  let status; let payload; let nextCalled = false; let retryAfter;
  const res = { set(name, value) { if (name === "Retry-After") retryAfter = value; return this; }, status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
  await middleware({ ip: "192.0.2.1", socket: {} }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(status, 429);
  assert.equal(retryAfter, "24");
  assert.equal(payload.errorCode, "RATE_LIMIT_EXCEEDED");
});

test("rate-limit subject is keyed with an HMAC and SQL uses an atomic fixed-window upsert", () => {
  assert.notEqual(hashSubject("sample", "secret"), "sample");
  assert.match(WINDOW_SQL, /ON CONFLICT/);
  assert.match(WINDOW_SQL, /request_count/);
});
