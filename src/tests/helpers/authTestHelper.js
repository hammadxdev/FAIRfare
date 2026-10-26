const assert = require("node:assert/strict");
const request = require("supertest");

async function createAuthenticatedTestUser(app, name = "Test User") {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const sent = await request(app).post("/api/auth/email/otp/request").send({ email });
  assert.equal(sent.status, 200, `OTP request failed: ${JSON.stringify(sent.body)}`);
  const code = global.__emailTestCodes.get(`${email}:verify`);
  assert.match(code || "", /^\d{6}$/);
  const verified = await request(app).post("/api/auth/email/otp/verify").send({ email, code });
  assert.equal(verified.status, 200, `OTP verification failed: ${JSON.stringify(verified.body)}`);
  const auth = verified.body.data;
  if (auth.needsName) {
    const profile = await request(app).patch("/api/auth/me").set("Authorization", authHeader(auth)).send({ name });
    assert.equal(profile.status, 200, `test profile setup failed: ${JSON.stringify(profile.body)}`);
    auth.user = profile.body.data;
  }
  auth.email = email;
  return auth;
}

function authHeader(auth) { return `Bearer ${auth.accessToken}`; }

module.exports = { createAuthenticatedTestUser, authHeader };
