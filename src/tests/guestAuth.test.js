const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");

test("guest-session creation and guest-upgrade endpoints are not exposed", async () => {
  assert.equal((await request(app).post("/api/auth/guest").send({})).status, 404);
  assert.equal((await request(app).post("/api/auth/guest/upgrade").send({})).status, 404);
  assert.equal((await request(app).post("/api/auth/guest/upgrade/verify").send({})).status, 404);
});
