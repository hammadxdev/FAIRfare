const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

let auth;
test.before(async () => { auth = await createAuthenticatedTestUser(app, "History Test User"); });

const payload = {
  pickup: { name: "History Pickup", lat: 32.4945, lng: 74.5229 },
  dropoff: { name: "History Destination", lat: 32.5201, lng: 74.56 },
  vehicleType: "bike",
};

test("successful comparisons create one newest-first history snapshot", async () => {
  const before = await request(app).get("/api/history?limit=50").set("Authorization", authHeader(auth));
  const comparison = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(payload);
  assert.equal(comparison.status, 200);

  const after = await request(app).get("/api/history?limit=50").set("Authorization", authHeader(auth));
  assert.equal(after.status, 200);
  const entry = after.body.data.find((item) => item.pickup.label === payload.pickup.name && item.destination.label === payload.dropoff.name);
  assert.ok(entry);
  assert.ok(after.body.data.every((item, index, list) => index === 0 || item.id < list[index - 1].id));
  assert.equal(entry.pickup.label, payload.pickup.name);
  assert.equal(entry.destination.label, payload.dropoff.name);
  assert.equal(entry.quotes.length, 3);
  assert.ok(entry.quotes.some((quote) => quote.provider === "indrive" && quote.fare !== null));
  assert.ok(entry.searchedAt);
  assert.ok(!before.body.data.some((item) => item.id === entry.id));
});

test("history detail is a stored snapshot and invalid comparison creates none", async () => {
  const invalid = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send({ vehicleType: "bike" });
  assert.equal(invalid.status, 400);

  const list = await request(app).get("/api/history?limit=1").set("Authorization", authHeader(auth));
  const detail = await request(app).get(`/api/history/${list.body.data[0].id}`).set("Authorization", authHeader(auth));
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.data.quotes, list.body.data[0].quotes);
});
