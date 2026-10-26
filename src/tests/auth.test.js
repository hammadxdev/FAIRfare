const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { query } = require("../config/postgres");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
const { MAX_VERIFICATION_RESENDS, resendMetadata, cooldownRemainingSeconds } = require("../services/emailAuth.service");

test("verification resend metadata is bounded to two user-requested resends", () => {
  assert.equal(MAX_VERIFICATION_RESENDS, 2);
  assert.deepEqual(resendMetadata(0, 60), { resendCount: 0, remainingResends: 2, resendLimit: 2, cooldownSeconds: 60 });
  assert.deepEqual(resendMetadata(1, 60), { resendCount: 1, remainingResends: 1, resendLimit: 2, cooldownSeconds: 60 });
  assert.deepEqual(resendMetadata(99, 60), { resendCount: 2, remainingResends: 0, resendLimit: 2, cooldownSeconds: 60 });
});

test("verification resend cooldown reports remaining seconds without exposing state", () => {
  const now = Date.parse("2026-01-01T00:00:30.000Z");
  assert.equal(cooldownRemainingSeconds("2026-01-01T00:00:00.000Z", 60, now), 30);
  assert.equal(cooldownRemainingSeconds("2026-01-01T00:00:00.000Z", 60, now + 60000), 0);
});

test("password, signup, guest and legacy email-verification routes are not exposed", async () => {
  for (const [method, path] of [["post", "/api/auth/register"], ["post", "/api/auth/login"], ["post", "/api/auth/guest"], ["post", "/api/auth/email/verify"], ["post", "/api/auth/forgot-password"]]) {
    assert.equal((await request(app)[method](path).send({})).status, 404, `${path} should not be exposed`);
  }
});

test("OTP session rotates refresh credentials, logout revokes them, and protected routes require auth", async () => {
  const auth = await createAuthenticatedTestUser(app, "Auth User");
  const me = await request(app).get("/api/auth/me").set("Authorization", authHeader(auth));
  assert.equal(me.status, 200);
  assert.equal(me.body.data.id, auth.user.id);
  assert.equal(me.body.data.email, auth.email);
  assert.equal(me.body.data.password_hash, undefined);
  assert.equal((await request(app).get("/api/auth/me")).status, 401);
  assert.equal((await request(app).get("/api/auth/me").set("Authorization", "Bearer invalid")).status, 401);

  const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: auth.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.data.user.id, auth.user.id);
  assert.notEqual(refreshed.body.data.refreshToken, auth.refreshToken);
  assert.equal((await request(app).post("/api/auth/refresh").send({ refreshToken: auth.refreshToken })).status, 401);
  assert.equal((await request(app).post("/api/auth/logout").send({ refreshToken: refreshed.body.data.refreshToken })).status, 200);
  assert.equal((await request(app).post("/api/auth/refresh").send({ refreshToken: refreshed.body.data.refreshToken })).status, 401);
});

test("history remains isolated by verified email identity", async () => {
  const a = await createAuthenticatedTestUser(app, "History A");
  const b = await createAuthenticatedTestUser(app, "History B");
  const row = (await query("INSERT INTO comparison_history (user_id,pickup_label,pickup_latitude,pickup_longitude,destination_label,destination_latitude,destination_longitude) VALUES ($1,'A',31.5,74.3,'B',31.6,74.4) RETURNING id", [a.user.id])).rows[0];
  assert.equal((await request(app).get("/api/history").set("Authorization", authHeader(a))).body.data.some((item) => item.id === row.id), true);
  assert.equal((await request(app).get("/api/history").set("Authorization", authHeader(b))).body.data.some((item) => item.id === row.id), false);
  assert.equal((await request(app).get(`/api/history/${row.id}`).set("Authorization", authHeader(b))).status, 404);
});

test("protected fare and history endpoints reject missing authentication", async () => {
  assert.equal((await request(app).post("/api/fares/compare").send({})).status, 401);
  assert.equal((await request(app).get("/api/history")).status, 401);
  assert.equal((await request(app).get("/api/history/1")).status, 401);
});