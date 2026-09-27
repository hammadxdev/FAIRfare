const assert = require("node:assert/strict");
const request = require("supertest");

async function createAuthenticatedTestUser(app, name = "Test User") {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app).post("/api/auth/register").send({ name, email, password: "test-password-123" });
  assert.equal(response.status, 200, `test user registration failed: ${JSON.stringify(response.body)}`);
  let login = await request(app).post("/api/auth/login").send({ email, password: "test-password-123" });
  if (login.status === 403 && login.body.errorCode === "EMAIL_NOT_VERIFIED") {
    const code = global.__emailTestCodes.get(`${email}:verify`);
    const verified = await request(app).post("/api/auth/email/verify").send({ email, code });
    assert.equal(verified.status, 200, `test user verification failed: ${JSON.stringify(verified.body)}`);
    login = await request(app).post("/api/auth/login").send({ email, password: "test-password-123" });
  }
  assert.equal(login.status, 200, `test user login failed: ${JSON.stringify(login.body)}`);
  return login.body.data;
}

function authHeader(auth) { return `Bearer ${auth.accessToken}`; }

module.exports = { createAuthenticatedTestUser, authHeader };
