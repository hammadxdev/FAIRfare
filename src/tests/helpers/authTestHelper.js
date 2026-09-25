const assert = require("node:assert/strict");
const request = require("supertest");

async function createAuthenticatedTestUser(app, name = "Test User") {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app).post("/api/auth/register").send({ name, email, password: "test-password-123" });
  assert.equal(response.status, 200, `test user registration failed: ${JSON.stringify(response.body)}`);
  return response.body.data;
}

function authHeader(auth) { return `Bearer ${auth.accessToken}`; }

module.exports = { createAuthenticatedTestUser, authHeader };
