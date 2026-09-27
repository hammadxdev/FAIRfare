require("../src/config/env");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const postgres = require("../src/config/postgres");
const emailProvider = require("../src/services/email/emailProvider");

const suffix = Date.now();
const email = `email-auth-smoke-${suffix}@example.com`;
const password = "Smoke-password-123!";
const nextPassword = "Smoke-password-456!";
const codes = new Map();

emailProvider.setEmailProviderForTests({
  async send({ to, subject, html }) {
    const code = html.match(/letter-spacing:8px[^>]*>(\d{6})</)?.[1];
    assert.ok(code, "mock email must contain a six-digit code");
    codes.set(`${to}:${subject.startsWith("Verify") ? "verify" : "reset"}`, code);
    return { accepted: true };
  },
});

async function run() {
  const register = await request(app).post("/api/auth/register").send({ name: "Email Smoke", email, password });
  assert.equal(register.status, 200);
  assert.equal(register.body.data.accessToken, undefined);
  const user = (await postgres.query("SELECT id,email,email_verified_at,password_hash IS NOT NULL AS has_password_hash FROM users WHERE email=$1", [email])).rows[0];
  assert.ok(user && user.has_password_hash && !user.email_verified_at);
  const unverifiedLogin = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(unverifiedLogin.status, 403);
  assert.equal(unverifiedLogin.body.errorCode, "EMAIL_NOT_VERIFIED");
  assert.equal((await request(app).post("/api/auth/email/send-verification").send({ email })).status, 429);

  const wrongVerify = await request(app).post("/api/auth/email/verify").send({ email, code: "000000" });
  assert.equal(wrongVerify.status, 400);
  const verifyCode = codes.get(`${email}:verify`);
  const verified = await request(app).post("/api/auth/email/verify").send({ email, code: verifyCode });
  assert.equal(verified.status, 200);
  assert.ok((await postgres.query("SELECT email_verified_at FROM users WHERE email=$1", [email])).rows[0].email_verified_at);

  const login = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(login.status, 200);
  const session = login.body.data;
  assert.ok(session.accessToken && session.refreshToken);
  assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${session.accessToken}`)).status, 200);
  const refresh = await request(app).post("/api/auth/refresh").send({ refreshToken: session.refreshToken });
  assert.equal(refresh.status, 200);
  const rotated = refresh.body.data;
  assert.notEqual(rotated.refreshToken, session.refreshToken);
  assert.equal((await request(app).post("/api/auth/logout").send({ refreshToken: rotated.refreshToken })).status, 200);
  assert.equal((await request(app).post("/api/auth/refresh").send({ refreshToken: rotated.refreshToken })).status, 401);

  const resetRequest = await request(app).post("/api/auth/forgot-password").send({ email });
  assert.equal(resetRequest.status, 200);
  const unknownReset = await request(app).post("/api/auth/forgot-password").send({ email: `unknown-${suffix}@example.com` });
  assert.equal(unknownReset.status, 200);
  assert.equal(unknownReset.body.message, resetRequest.body.message);
  const resetCode = codes.get(`${email}:reset`);
  const resetVerification = await request(app).post("/api/auth/forgot-password/verify").send({ email, code: resetCode });
  assert.equal(resetVerification.status, 200);
  const resetToken = resetVerification.body.data.resetToken;
  assert.ok(resetToken);
  assert.equal((await request(app).post("/api/auth/reset-password").send({ resetToken, newPassword: nextPassword, confirmPassword: nextPassword })).status, 200);
  assert.equal((await request(app).post("/api/auth/reset-password").send({ resetToken, newPassword: "Another-password-789!", confirmPassword: "Another-password-789!" })).status, 400);
  assert.equal((await request(app).post("/api/auth/login").send({ email, password })).status, 401);
  const newLogin = await request(app).post("/api/auth/login").send({ email, password: nextPassword });
  assert.equal(newLogin.status, 200);
  assert.equal((await postgres.query("SELECT count(*)::int AS count FROM user_sessions WHERE user_id=$1 AND revoked_at IS NOT NULL", [user.id])).rows[0].count > 0, true);

  const duplicate = await request(app).post("/api/auth/register").send({ name: "Email Smoke", email, password });
  assert.equal(duplicate.status, 409);
  console.log(JSON.stringify({ register: "PASS", verification: "PASS", login: "PASS", me: "PASS", refresh: "PASS", logout: "PASS", reset: "PASS", sessionRevocation: "PASS", duplicate: "PASS" }));
}

run().catch((error) => { console.error(JSON.stringify({ name: error.name, code: error.code || null, message: error.message })); process.exitCode = 1; }).finally(async () => { await postgres.pool?.end(); });
