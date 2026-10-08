const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("./setup");
const { query } = require("../config/postgres");
const request = require("supertest");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

let auth;
test.before(async () => { auth = await createAuthenticatedTestUser(app, "Observation Test User"); });
const {
  createObservationRows,
  deriveTimeFeatures,
  persistFareObservations,
  sanitizeRawResponse,
} = require("../services/fareObservation.service");

const route = {
  pickup: { name: "Pickup", lat: 31.5, lng: 74.3 },
  dropoff: { name: "Destination", lat: 31.6, lng: 74.4 },
  distanceMeters: 19124,
  durationSeconds: 2178,
  requestedVehicleType: "bike",
};

test("one successful quote creates one observation with numeric route and history linkage", async () => {
  const response = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send({
    pickup: route.pickup,
    dropoff: route.dropoff,
    vehicleType: "bike",
    route: { distanceKm: 19.124, durationMin: 36.3 },
  });
  assert.equal(response.status, 200);
  const row = (await query("SELECT * FROM fare_observations WHERE comparison_id = $1 LIMIT 1", [response.body.data.comparisonId])).rows[0];
  assert.ok(row);
  assert.equal(typeof row.distance_meters, "number");
  assert.equal(typeof row.duration_seconds, "number");
  assert.equal(Number(row.pickup_latitude), route.pickup.lat);
  assert.equal(Number(row.destination_longitude), route.dropoff.lng);
  assert.equal(row.data_source, "TEST");
  assert.ok(row.comparison_id);
  assert.ok(row.observed_at);
});

test("multiple returned categories create separate observations and preserve semantics", () => {
  const rows = createObservationRows({
    ...route,
    observedAt: Date.parse("2026-09-20T18:00:00.000Z"),
    results: [{
      provider: { id: 1, name: "indrive" },
      quotes: [
        { categoryId: "2", categoryName: "Moto", fare: 250, fareMin: 240, fareMax: 260, currency: "PKR", fareType: "RECOMMENDED", pickupEtaSeconds: null },
        { categoryId: "31", categoryName: "Rickshaw", fare: 430, fareMin: null, fareMax: null, currency: "PKR", fareType: "RECOMMENDED", pickupEtaSeconds: 300 },
      ],
    }],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.vehicle_type), ["BIKE", "RICKSHAW"]);
  assert.equal(rows[0].provider_category_id, "2");
  assert.equal(rows[0].provider_category_name, "Moto");
  assert.equal(rows[0].fare_min, 240);
  assert.equal(rows[0].pickup_eta_seconds, null);
  assert.equal(rows[1].pickup_eta_seconds, 300);
  assert.equal(rows[0].distance_meters, 19124);
  assert.equal(rows[0].duration_seconds, 2178);
});

test("verified inDrive category 33 preserves its Mini mapping", () => {
  const [row] = createObservationRows({
    ...route,
    results: [{ provider: { id: 1, name: "indrive" }, quotes: [{ categoryId: "33", categoryName: "Mini", fare: 500 }] }],
  });
  assert.equal(row.provider_category_id, "33");
  assert.equal(row.provider_category_name, "Mini");
  assert.equal(row.vehicle_type, "ECONOMY_CAR");
});

test("time features use the centralized Lahore market timezone", () => {
  assert.deepEqual(deriveTimeFeatures(Date.parse("2026-09-19T18:00:00.000Z")), { hourOfDay: 23, dayOfWeek: 6, isWeekend: 1 });
});

test("failed providers produce no fabricated observation and raw response is sanitized", () => {
  const raw = sanitizeRawResponse({ fare: 10, Authorization: "secret", refresh_token: "refresh", nested: { oauth_token: "oauth" } });
  assert.doesNotMatch(raw, /secret|refresh|oauth/i);
  assert.deepEqual(createObservationRows({
    ...route,
    results: [
      { provider: { id: 1, name: "indrive" }, quotes: [{ categoryId: "2", fare: 250, metadata: { raw: { fare: 250, Authorization: "secret" } } }] },
      { provider: { id: 2, name: "quickride" }, fare: null, quotes: [] },
    ],
  }).length, 1);
});

test("persisting multi-category rows stores both observations", async () => {
  const history = (await query(`INSERT INTO comparison_history
    (user_id, pickup_label, pickup_latitude, pickup_longitude, destination_label, destination_latitude, destination_longitude, distance_meters, duration_seconds)
    VALUES ($1, 'Observation Test Pickup', 31.5, 74.3, 'Observation Test Destination', 31.6, 74.4, 19124, 2178) RETURNING id`, [auth.user.id]));
  const comparisonId = history.rows[0].id;
  const inserted = await persistFareObservations({
    comparisonId,
    ...route,
    results: [{ provider: { id: 1, name: "indrive" }, quotes: [{ categoryId: "2", fare: 250 }, { categoryId: "31", fare: 430 }] }],
  });
  const after = Number((await query("SELECT COUNT(*) AS count FROM fare_observations WHERE comparison_id = $1", [comparisonId])).rows[0].count);
  assert.equal(inserted, 2);
  assert.equal(after, 2);
});
