const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");

const validPayload = {
  pickup: { name: "University Road, Sialkot", lat: 32.4945, lng: 74.5229 },
  dropoff: { name: "Sialkot Cantt", lat: 32.5201, lng: 74.56 },
  vehicleType: "bike",
};

test("GET /api/providers returns 3 providers", async () => {
  const res = await request(app).get("/api/providers");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 3);
});

test("POST /api/fares/compare works for valid input and returns 3 results", async () => {
  const res = await request(app).post("/api/fares/compare").send(validPayload);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.results.length, 3);
  assert.ok(typeof res.body.data.distanceKm === "number");
  assert.ok(typeof res.body.data.durationMin === "number");
});

test("results are sorted by lowest fare ascending", async () => {
  const res = await request(app).post("/api/fares/compare").send(validPayload);
  const fares = res.body.data.results.map((r) => r.fare);
  const sorted = [...fares].sort((a, b) => a - b);
  assert.deepEqual(fares, sorted);
});

test("cheapest provider is correctly marked", async () => {
  const res = await request(app).post("/api/fares/compare").send(validPayload);
  const results = res.body.data.results;
  const lowestFare = Math.min(...results.map((r) => r.fare));
  const cheapestResults = results.filter((r) => r.isCheapest);

  assert.equal(cheapestResults.length, 1);
  assert.equal(cheapestResults[0].fare, lowestFare);
  assert.ok(cheapestResults[0].badges.includes("Cheapest"));
});

test("invalid vehicle type returns validation error", async () => {
  const res = await request(app)
    .post("/api/fares/compare")
    .send({ ...validPayload, vehicleType: "helicopter" });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("vehicleType")));
});

test("missing pickup/dropoff returns validation error", async () => {
  const res = await request(app).post("/api/fares/compare").send({ vehicleType: "bike" });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.includes("pickup is required"));
  assert.ok(res.body.errors.includes("dropoff is required"));
});

test("fare comparison uses route override distance/duration when provided", async () => {
  const res = await request(app)
    .post("/api/fares/compare")
    .send({ ...validPayload, route: { distanceKm: 6.8, durationMin: 18 } });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.distanceKm, 6.8);
  assert.equal(res.body.data.durationMin, 18);
});

test("fare comparison still works without route (haversine fallback)", async () => {
  const res = await request(app).post("/api/fares/compare").send(validPayload);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(typeof res.body.data.distanceKm === "number");
  assert.ok(typeof res.body.data.durationMin === "number");
});

test("fare comparison rejects invalid route override", async () => {
  const res = await request(app)
    .post("/api/fares/compare")
    .send({ ...validPayload, route: { distanceKm: -5, durationMin: "fast" } });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("route.distanceKm")));
  assert.ok(res.body.errors.some((e) => e.includes("route.durationMin")));
});
