const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { query } = require("../config/postgres");
const authService = require("../services/auth.service");
const emailAuth = require("../services/emailAuth.service");

function newEmail(prefix = "email-otp") { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`; }
async function sendCode(email) {
  const result = await request(app).post("/api/auth/email/otp/request").send({ email });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
}
function codeFor(email) {
  const value = global.__emailTestCodes.get(`${email.toLowerCase()}:verify`);
  assert.match(value || "", /^\d{6}$/);
  return value;
}
async function verify(email, code) { return request(app).post("/api/auth/email/otp/verify").send({ email, code }); }

test("OTP requests do not enumerate existing accounts and do not create a user before verification", async () => {
  const known = newEmail("known");
  const unknown = newEmail("unknown");
  const legacy = await authService.register({ name: "Existing", email: known, password: "legacy password" });
  const before = Number((await query("SELECT count(*)::int AS count FROM users WHERE lower(btrim(email))=$1", [unknown])).rows[0].count);
  const knownResponse = await sendCode(known);
  const unknownResponse = await sendCode(unknown);
  assert.equal(knownResponse.body.message, unknownResponse.body.message);
  assert.deepEqual(knownResponse.body.data, unknownResponse.body.data);
  const after = Number((await query("SELECT count(*)::int AS count FROM users WHERE lower(btrim(email))=$1", [unknown])).rows[0].count);
  assert.equal(after, before);
  assert.ok(legacy.user.id);
});

test("new email creates a verified passwordless account only after OTP and asks for name once", async () => {
  const email = newEmail("new-user");
  await sendCode(email);
  assert.equal(Number((await query("SELECT count(*)::int AS count FROM users WHERE lower(btrim(email))=$1", [email])).rows[0].count), 0);
  const first = await verify(email, codeFor(email));
  assert.equal(first.status, 200);
  assert.equal(first.body.data.needsName, true);
  assert.equal(first.body.data.user.emailVerifiedAt != null, true);
  assert.equal(first.body.data.user.name, null);
  const userId = first.body.data.user.id;
  const profile = await request(app).patch("/api/auth/me").set("Authorization", `Bearer ${first.body.data.accessToken}`).send({ name: "New User" });
  assert.equal(profile.status, 200);

  await sendCode(email.toUpperCase());
  const returning = await verify(email.toUpperCase(), codeFor(email));
  assert.equal(returning.status, 200);
  assert.equal(returning.body.data.user.id, userId);
  assert.equal(returning.body.data.needsName, false);
  assert.equal((await verify(email, codeFor(email))).status, 400, "a consumed OTP cannot be reused");
  const row = (await query("SELECT name,password_hash,email_verified_at FROM users WHERE id=$1", [userId])).rows[0];
  assert.equal(row.name, "New User");
  assert.equal(row.password_hash, null);
  assert.ok(row.email_verified_at);
});

test("a legacy password account restores its same user ID, hash, history and AI conversations", async () => {
  const email = newEmail("legacy");
  const legacy = await authService.register({ name: "Legacy User", email, password: "legacy-password-123" });
  const userId = legacy.user.id;
  const beforeHash = (await query("SELECT password_hash FROM users WHERE id=$1", [userId])).rows[0].password_hash;
  const comparison = (await query("INSERT INTO comparison_history (user_id,pickup_label,pickup_latitude,pickup_longitude,destination_label,destination_latitude,destination_longitude) VALUES ($1,'Pickup',31.5,74.3,'Dropoff',31.6,74.4) RETURNING id", [userId])).rows[0];
  const conversation = (await query("INSERT INTO ai_conversations (user_id,title) VALUES ($1,'Saved conversation') RETURNING id", [userId])).rows[0];

  await sendCode(email.toUpperCase());
  const session = await verify(email.toUpperCase(), codeFor(email));
  assert.equal(session.status, 200);
  assert.equal(session.body.data.user.id, userId);
  assert.equal(session.body.data.user.name, "Legacy User");
  assert.equal(session.body.data.needsName, false);
  assert.equal((await query("SELECT password_hash FROM users WHERE id=$1", [userId])).rows[0].password_hash, beforeHash);
  const auth = `Bearer ${session.body.data.accessToken}`;
  assert.equal((await request(app).get("/api/history").set("Authorization", auth)).body.data.some((row) => row.id === comparison.id), true);
  assert.equal((await request(app).get("/api/ai/conversations").set("Authorization", auth)).body.data.some((row) => row.id === conversation.id), true);
});

test("concurrent verification of one challenge cannot create duplicate accounts", async () => {
  const email = newEmail("race");
  await sendCode(email);
  const code = codeFor(email);
  const results = await Promise.all([verify(email, code), verify(email, code)]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 400]);
  assert.equal(Number((await query("SELECT count(*)::int AS count FROM users WHERE lower(btrim(email))=$1", [email])).rows[0].count), 1);
});

test("invalid, expired and brute-forced OTPs are rejected and attempt counts persist", async () => {
  const email = newEmail("invalid");
  await emailAuth.requestLoginOtp(email);
  const valid = codeFor(email);
  const invalid = valid === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(authService.verifyEmailOtpLogin(email, invalid), (error) => error.code === "EMAIL_OTP_INVALID");
  }
  await assert.rejects(authService.verifyEmailOtpLogin(email, valid), (error) => error.code === "EMAIL_OTP_ATTEMPTS_EXCEEDED");
  const attempt = (await query("SELECT attempt_count,otp_hash FROM email_login_challenges WHERE email=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [email])).rows[0];
  assert.equal(attempt.attempt_count, 5);
  assert.notEqual(attempt.otp_hash, valid, "stored challenge contains only a keyed hash");

  const expiredEmail = newEmail("expired");
  await emailAuth.requestLoginOtp(expiredEmail);
  await query("UPDATE email_login_challenges SET expires_at=now()-interval '1 second' WHERE email=$1 AND used_at IS NULL", [expiredEmail]);
  await assert.rejects(authService.verifyEmailOtpLogin(expiredEmail, codeFor(expiredEmail)), (error) => error.code === "EMAIL_OTP_EXPIRED");
});

test("resend cooldown throttles OTP delivery", async () => {
  const email = newEmail("resend");
  await emailAuth.requestLoginOtp(email);
  await assert.rejects(emailAuth.requestLoginOtp(email), (error) => error.code === "EMAIL_OTP_COOLDOWN");
});
