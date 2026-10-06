const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { query } = require("../config/postgres");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

const routePayload = {
  name: " Home to University ", labelType: "UNIVERSITY",
  pickup: { name: "Home", address: "1 Main Street", latitude: 31.123, longitude: 74.123 },
  destination: { name: "University", address: "Campus Road", latitude: 31.456, longitude: 74.456 },
};

test("saved routes require authentication for every operation", async () => {
  assert.equal((await request(app).get("/api/saved-routes")).status, 401);
  assert.equal((await request(app).post("/api/saved-routes").send(routePayload)).status, 401);
});

test("user can create, list, read, rename, relabel, compare freshly, and delete a saved route", async () => {
  const auth = await createAuthenticatedTestUser(app, "Saved Route Owner");
  const created = await request(app).post("/api/saved-routes").set("Authorization", authHeader(auth)).send(routePayload);
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, "Home to University");
  assert.equal(created.body.data.labelType, "UNIVERSITY");
  assert.equal(created.body.data.pickup.lat, routePayload.pickup.latitude);
  assert.equal(created.body.data.pickup.lng, routePayload.pickup.longitude);
  assert.equal(created.body.data.destination.lat, routePayload.destination.latitude);
  assert.equal(created.body.data.destination.lng, routePayload.destination.longitude);
  assert.equal(created.body.data.userId, undefined);
  assert.equal(created.body.data.password, undefined);

  const id = created.body.data.id;
  assert.equal((await request(app).get("/api/saved-routes").set("Authorization", authHeader(auth))).body.data.length >= 1, true);
  assert.equal((await request(app).get(`/api/saved-routes/${id}`).set("Authorization", authHeader(auth))).status, 200);
  const renamed = await request(app).put(`/api/saved-routes/${id}`).set("Authorization", authHeader(auth)).send({ name: "Campus Trip", labelType: "FAVORITE" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.name, "Campus Trip");
  assert.equal(renamed.body.data.labelType, "FAVORITE");

  const comparison = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send({
    pickup: { name: created.body.data.pickup.name, lat: created.body.data.pickup.lat, lng: created.body.data.pickup.lng },
    dropoff: { name: created.body.data.destination.name, lat: created.body.data.destination.lat, lng: created.body.data.destination.lng },
    vehicleType: "bike",
  });
  assert.equal(comparison.status, 200);
  assert.ok(comparison.body.data.comparisonId);
  assert.equal(comparison.body.data.results.length > 0, true);

  assert.equal((await request(app).delete(`/api/saved-routes/${id}`).set("Authorization", authHeader(auth))).status, 200);
  assert.equal((await request(app).get(`/api/saved-routes/${id}`).set("Authorization", authHeader(auth))).status, 404);
  assert.equal((await request(app).get("/api/history").set("Authorization", authHeader(auth))).body.data.length > 0, true);
});

test("saved route validation rejects empty names, unknown labels, missing locations, and invalid coordinates", async () => {
  const auth = await createAuthenticatedTestUser(app, "Validation Owner");
  for (const body of [
    { ...routePayload, name: "   " },
    { ...routePayload, labelType: "UNKNOWN" },
    { ...routePayload, pickup: undefined },
    { ...routePayload, destination: undefined },
    { ...routePayload, pickup: { ...routePayload.pickup, latitude: 91 } },
    { ...routePayload, destination: { ...routePayload.destination, longitude: 181 } },
  ]) {
    assert.equal((await request(app).post("/api/saved-routes").set("Authorization", authHeader(auth)).send(body)).status, 400);
  }
});

test("saved routes are private, client userId cannot bypass ownership, and coordinate-near duplicates are rejected", async () => {
  const owner = await createAuthenticatedTestUser(app, "Owner");
  const other = await createAuthenticatedTestUser(app, "Other");
  const created = await request(app).post("/api/saved-routes").set("Authorization", authHeader(owner)).send({ ...routePayload, userId: other.user.id });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal((await request(app).get("/api/saved-routes").set("Authorization", authHeader(other))).body.data.some((item) => item.id === id), false);
  assert.equal((await request(app).get(`/api/saved-routes/${id}`).set("Authorization", authHeader(other))).status, 404);
  assert.equal((await request(app).put(`/api/saved-routes/${id}`).set("Authorization", authHeader(other)).send({ name: "Stolen" })).status, 404);
  assert.equal((await request(app).delete(`/api/saved-routes/${id}`).set("Authorization", authHeader(other))).status, 404);
  const duplicate = await request(app).post("/api/saved-routes").set("Authorization", authHeader(owner)).send({ ...routePayload, name: "Same Route", pickup: { ...routePayload.pickup, latitude: 31.12305 } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.errorCode, "ALREADY_SAVED");
  const displayOnlyChange = await request(app).post("/api/saved-routes").set("Authorization", authHeader(owner)).send({ ...routePayload, name: "Different label", pickup: { ...routePayload.pickup, name: "Renamed home", address: "A different display address" } });
  assert.equal(displayOnlyChange.status, 409);
  const reverse = await request(app).post("/api/saved-routes").set("Authorization", authHeader(owner)).send({ ...routePayload, name: "Reverse", pickup: routePayload.destination, destination: routePayload.pickup });
  assert.equal(reverse.status, 201);
  const differentDestination = await request(app).post("/api/saved-routes").set("Authorization", authHeader(owner)).send({ ...routePayload, name: "Different destination", destination: { ...routePayload.destination, latitude: 31.5 } });
  assert.equal(differentDestination.status, 201);
  const otherCopy = await request(app).post("/api/saved-routes").set("Authorization", authHeader(other)).send(routePayload);
  assert.equal(otherCopy.status, 201);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM saved_routes WHERE user_id = $1", [owner.user.id])).rows[0].count) >= 1, true);
});
