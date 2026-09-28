const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");

const password = "correct horse battery";

async function authenticatedSession(label) {
  const email = `profile-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const registered = await request(app).post("/api/auth/register").send({ name: "Profile User", email, password });
  assert.equal(registered.status, 200);
  const code = global.__emailTestCodes.get(`${email}:verify`);
  assert.equal((await request(app).post("/api/auth/email/verify").send({ email, code })).status, 200);
  const logged = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(logged.status, 200);
  return logged.body.data.accessToken;
}

test("profile update requires authentication", async () => {
  assert.equal((await request(app).patch("/api/auth/me").send({ name: "Anonymous" })).status, 401);
});

test("authenticated user can update own name and auth/me reflects it", async () => {
  const token = await authenticatedSession();
  const updated = await request(app).patch("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ name: "  Zoë Fair  " });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Zoë Fair");
  assert.equal(updated.body.data.password_hash, undefined);
  assert.equal(updated.body.data.email_verified_at, undefined);
  assert.equal(typeof updated.body.data.id, "string");
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.name, "Zoë Fair");
  assert.equal(me.body.data.password_hash, undefined);
  assert.equal(me.body.data.emailVerifiedAt !== undefined, true);
});

test("profile update rejects empty or overlong names and ignores client user id", async () => {
  const token = await authenticatedSession();
  const empty = await request(app).patch("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ user_id: 999999, name: "   " });
  assert.equal(empty.status, 400);
  const long = await request(app).patch("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ user_id: 999999, name: "x".repeat(121) });
  assert.equal(long.status, 400);
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(me.body.data.name, "Profile User");
});
