const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

test("anonymous preference reads and writes are rejected", async () => {
  assert.equal((await request(app).get("/api/preferences")).status, 401);
  assert.equal((await request(app).put("/api/preferences").send({ ridePriority: "BALANCED" })).status, 401);
});

test("authenticated users receive defaults and can save validated preferences", async () => {
  const auth = await createAuthenticatedTestUser(app, "Preference User");
  const headers = { Authorization: authHeader(auth) };
  const initial = await request(app).get("/api/preferences").set(headers);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.data, { preferredVehicleType: null, avoidedVehicleTypes: [], typicalBudget: null, ridePriority: "BALANCED", currency: "PKR" });

  const saved = await request(app).put("/api/preferences").set(headers).send({ preferredVehicleType: "rickshaw", avoidedVehicleTypes: ["BIKE", "BIKE"], typicalBudget: 600, ridePriority: "balanced" });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data, { preferredVehicleType: "RICKSHAW", avoidedVehicleTypes: ["BIKE"], typicalBudget: 600, ridePriority: "BALANCED", currency: "PKR" });
  assert.equal(saved.body.data.password_hash, undefined);
  assert.equal(saved.body.data.refreshToken, undefined);

  const reloaded = await request(app).get("/api/preferences").set(headers);
  assert.deepEqual(reloaded.body.data, saved.body.data);
});

test("invalid preference values are rejected", async () => {
  const auth = await createAuthenticatedTestUser(app, "Invalid Preference User");
  const put = (body) => request(app).put("/api/preferences").set("Authorization", authHeader(auth)).send(body);
  assert.equal((await put({ preferredVehicleType: "SCOOTER" })).status, 400);
  assert.equal((await put({ ridePriority: "RANDOM" })).status, 400);
  assert.equal((await put({ typicalBudget: -1 })).status, 400);
  assert.equal((await put({ typicalBudget: "not-a-number" })).status, 400);
  assert.equal((await put({ preferredVehicleType: "RICKSHAW", avoidedVehicleTypes: ["RICKSHAW"] })).status, 400);
  assert.equal((await put({ preferredVehicleType: "UNKNOWN" })).status, 400);
  assert.equal((await put({ avoidedVehicleTypes: ["UNKNOWN"] })).status, 400);
});

test("preferences are isolated and client-supplied user IDs are ignored", async () => {
  const userA = await createAuthenticatedTestUser(app, "Preference A");
  const userB = await createAuthenticatedTestUser(app, "Preference B");
  await request(app).put("/api/preferences").set("Authorization", authHeader(userA)).send({ preferredVehicleType: "BIKE", typicalBudget: 300 });
  const bBefore = await request(app).get("/api/preferences").set("Authorization", authHeader(userB));
  assert.equal(bBefore.body.data.preferredVehicleType, null);
  await request(app).put("/api/preferences").set("Authorization", authHeader(userA)).send({ userId: userB.user.id, preferredVehicleType: "RICKSHAW" });
  const a = await request(app).get("/api/preferences").set("Authorization", authHeader(userA));
  const b = await request(app).get("/api/preferences").set("Authorization", authHeader(userB));
  assert.equal(a.body.data.preferredVehicleType, "RICKSHAW");
  assert.equal(b.body.data.preferredVehicleType, null);
});
