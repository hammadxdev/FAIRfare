const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

let auth;
test.before(async () => { auth = await createAuthenticatedTestUser(app, "Fare Test User"); });

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

test("GET /api/providers/status is safe and does not expose credentials", async () => {
  const res = await request(app).get("/api/providers/status");
  assert.equal(res.status, 200);
  assert.ok(res.body.data.providers.some((provider) => provider.id === "indrive"));
  assert.doesNotMatch(JSON.stringify(res.body), /access_token|refresh_token|fingerprint|authorization/i);
});

test("POST /api/fares/compare works for valid input and returns 3 results", async () => {
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.results.length, 3);
  assert.ok(typeof res.body.data.distanceKm === "number");
  assert.ok(typeof res.body.data.durationMin === "number");
});

test("results are sorted by lowest fare ascending", async () => {
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);
  const fares = res.body.data.results.map((r) => r.fare);
  const sorted = [...fares].sort((a, b) => a - b);
  assert.deepEqual(fares, sorted);
});

test("cheapest provider is correctly marked", async () => {
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);
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
    .set("Authorization", authHeader(auth))
    .send({ ...validPayload, vehicleType: "helicopter" });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("vehicleType")));
});

test("missing pickup/dropoff returns validation error", async () => {
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send({ vehicleType: "bike" });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.includes("pickup is required"));
  assert.ok(res.body.errors.includes("dropoff is required"));
});

test("fare comparison uses route override distance/duration when provided", async () => {
  const res = await request(app)
    .post("/api/fares/compare")
    .set("Authorization", authHeader(auth))
    .send({ ...validPayload, route: { distanceKm: 6.8, durationMin: 18 } });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.distanceKm, 6.8);
  assert.equal(res.body.data.durationMin, 18);
});

test("fare comparison still works without route (haversine fallback)", async () => {
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(typeof res.body.data.distanceKm === "number");
  assert.ok(typeof res.body.data.durationMin === "number");
});

test("fare comparison rejects invalid route override", async () => {
  const res = await request(app)
    .post("/api/fares/compare")
    .set("Authorization", authHeader(auth))
    .send({ ...validPayload, route: { distanceKm: -5, durationMin: "fast" } });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("route.distanceKm")));
  assert.ok(res.body.errors.some((e) => e.includes("route.durationMin")));
});

test("legacy mode preserves the existing public comparison", async () => {
  const previous = process.env.FAIR_FARE_DATASET_MODE;
  process.env.FAIR_FARE_DATASET_MODE = "legacy";
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);
  if (previous === undefined) delete process.env.FAIR_FARE_DATASET_MODE; else process.env.FAIR_FARE_DATASET_MODE = previous;
  assert.equal(res.status, 200);
  assert.equal(res.body.data.results.length, 3);
  assert.equal(res.body.data.coverage.mode, "legacy");
  assert.equal(res.body.data.datasetPreview, undefined);
});

test("preview mode keeps public results unchanged and adds isolated diagnostics", async () => {
  const previous = process.env.FAIR_FARE_DATASET_MODE;
  process.env.FAIR_FARE_DATASET_MODE = "preview";
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);
  if (previous === undefined) delete process.env.FAIR_FARE_DATASET_MODE; else process.env.FAIR_FARE_DATASET_MODE = previous;
  assert.equal(res.status, 200);
  assert.equal(res.body.data.results.length, 3);
  assert.equal(res.body.data.datasetPreview.length, 3);
  assert.ok(res.body.data.datasetPreview.every((item) => item.estimate?.experimental === true && item.estimate?.notPublicResult === true));
  assert.deepEqual([...res.body.data.results.map((item) => item.provider.name)].sort(), ["indrive", "quickride", "urbancab"]);
});

test("verified mode excludes the dataset's unverified coverage", async () => {
  const previous = process.env.FAIR_FARE_DATASET_MODE;
  process.env.FAIR_FARE_DATASET_MODE = "verified";
  const res = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send(validPayload);
  if (previous === undefined) delete process.env.FAIR_FARE_DATASET_MODE; else process.env.FAIR_FARE_DATASET_MODE = previous;
  assert.equal(res.status, 200);
  assert.equal(res.body.data.results.length, 0);
  assert.ok(res.body.data.coverage.providers.every((item) => item.supported === false));
  assert.ok(res.body.data.coverage.providers.every((item) => /UNVERIFIED/.test(item.status)));
});
