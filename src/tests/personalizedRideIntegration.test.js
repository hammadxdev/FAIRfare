const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

const payload = {
  pickup: { name: "Personalization Pickup", lat: 32.4945, lng: 74.5229 },
  dropoff: { name: "Personalization Destination", lat: 32.5201, lng: 74.56 },
  vehicleType: "bike",
};

test("comparison uses authenticated user's preferences, ignores client userId, and keeps avoided fares/actions", async () => {
  const userA = await createAuthenticatedTestUser(app, "Personalization User A");
  const userB = await createAuthenticatedTestUser(app, "Personalization User B");
  await request(app).put("/api/preferences").set("Authorization", authHeader(userA)).send({ avoidedVehicleTypes: ["BIKE"], ridePriority: "CHEAPEST" });
  await request(app).put("/api/preferences").set("Authorization", authHeader(userB)).send({ preferredVehicleType: "BIKE", ridePriority: "BALANCED" });

  const [a, b] = await Promise.all([
    request(app).post("/api/fares/compare").set("Authorization", authHeader(userA)).send({ ...payload, userId: userB.user.id }),
    request(app).post("/api/fares/compare").set("Authorization", authHeader(userB)).send(payload),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.ok(a.body.data.results.every((result) => result.personalization.eligible === false));
  assert.equal(a.body.data.results.filter((result) => result.personalization.isTopRecommendation).length, 0);
  assert.ok(a.body.data.results.every((result) => result.fare > 0));
  assert.ok(a.body.data.results.every((result) => typeof result.provider.name === "string"));
  assert.equal(b.body.data.results.filter((result) => result.personalization.isTopRecommendation).length, 1);
  assert.ok(b.body.data.results.some((result) => result.personalization.preferredVehicleMatch === true));
});
