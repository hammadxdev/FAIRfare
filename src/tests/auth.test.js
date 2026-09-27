const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { query } = require("../config/postgres");

const email = `auth-${Date.now()}@example.com`;
const otherEmail = `auth-other-${Date.now()}@example.com`;
const password = "correct horse battery";
async function register(value = email, name = "Ali") { return request(app).post("/api/auth/register").send({ name, email: value, password }); }
async function login(value = email) { let result = await request(app).post("/api/auth/login").send({ email: value, password }); if (result.status === 403 && result.body.errorCode === "EMAIL_NOT_VERIFIED") { const code = global.__emailTestCodes.get(`${value}:verify`); assert.equal((await request(app).post("/api/auth/email/verify").send({ email: value, code })).status, 200); result = await request(app).post("/api/auth/login").send({ email: value, password }); } return result; }

test("registration hashes password and returns an account without a session", async () => {
  const res = await register();
  assert.equal(res.status, 200); assert.equal(res.body.data.accessToken, undefined); assert.equal(res.body.data.refreshToken, undefined); assert.equal(res.body.data.user.email, email); assert.equal(res.body.data.user.password_hash, undefined);
  const row = (await query("SELECT password_hash FROM users WHERE email = $1", [email])).rows[0];
  assert.ok(row.password_hash.startsWith("$2")); assert.notEqual(row.password_hash, password);
});
test("registration validation and duplicate email are rejected", async () => {
  assert.equal((await register(email)).status, 409);
  assert.equal((await request(app).post("/api/auth/register").send({ name: "x", email: "bad", password: "short" })).status, 400);
});
test("login, me, refresh rotation, logout and ownership are enforced", async () => {
  const logged = await login(); assert.equal(logged.status, 200); const session = logged.body.data;
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${session.accessToken}`); assert.equal(me.status, 200); assert.equal(me.body.data.email, email); assert.equal(me.body.data.password_hash, undefined);
  assert.equal((await request(app).get("/api/auth/me")).status, 401); assert.equal((await request(app).get("/api/auth/me").set("Authorization", "Bearer invalid")).status, 401);
  const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: session.refreshToken }); assert.equal(refreshed.status, 200); assert.notEqual(refreshed.body.data.refreshToken, session.refreshToken);
  assert.equal((await request(app).post("/api/auth/refresh").send({ refreshToken: session.refreshToken })).status, 401);
  await register(otherEmail, "Sara"); const other = await login(otherEmail);
  const comparison = await request(app).post("/api/fares/compare").set("Authorization", `Bearer ${session.accessToken}`).send({ pickup: { name: "A", lat: 31.5, lng: 74.3 }, dropoff: { name: "B", lat: 31.6, lng: 74.4 }, vehicleType: "bike" });
  assert.equal(comparison.status, 200);
  const own = await request(app).get("/api/history").set("Authorization", `Bearer ${session.accessToken}`); assert.equal(own.status, 200); assert.ok(own.body.data.length > 0);
  const id = own.body.data[0].id;
  const otherHistory = await request(app).get("/api/history").set("Authorization", `Bearer ${other.body.data.accessToken}`); assert.equal(otherHistory.status, 200); assert.equal(otherHistory.body.data.some((row) => row.id === id), false);
  assert.equal((await request(app).get(`/api/history/${id}`).set("Authorization", `Bearer ${other.body.data.accessToken}`)).status, 404);
  assert.equal((await request(app).post("/api/auth/logout").send({ refreshToken: refreshed.body.data.refreshToken })).status, 200);
  assert.equal((await request(app).post("/api/auth/refresh").send({ refreshToken: refreshed.body.data.refreshToken })).status, 401);
});

test("protected comparison and history endpoints reject anonymous requests", async () => {
  assert.equal((await request(app).post("/api/fares/compare").send({})).status, 401);
  assert.equal((await request(app).get("/api/history")).status, 401);
  assert.equal((await request(app).get("/api/history/1")).status, 401);
});
