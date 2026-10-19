const test = require("node:test");
const assert = require("node:assert/strict");
const { createIndriveProvider } = require("../providers/indrive-architecture");

const route = { pickup: { latitude: 31.4742, longitude: 74.4163 }, destination: { latitude: 31.5204, longitude: 74.3587 }, distanceMeters: 9301, durationSeconds: 1139 };

test("inDrive fixture normalizes vehicle-wise fares and converts PKR minor units", async () => {
  const provider = createIndriveProvider({ config: { id: "indrive", displayName: "inDrive", currency: "PKR", currencyMultiplier: 100, mode: "authorized-live" }, transport: { async getFareEstimates() { return { status: "available", currency: "PKR", estimates: [{ rideType: "ride_moto", categoryName: "Moto", fareMinor: 16300, priceType: "suggested", negotiable: true }, { rideType: "ride_mini", categoryName: "Mini", fareMinor: 45000, priceType: "fixed" }, { rideType: "ride_premium", categoryName: "Premium", fareMinor: 78000, priceType: "fixed" }] }; } } });
  const response = await provider.getFareEstimates({ pickup: route.pickup, destination: route.destination, route });
  assert.equal(response.status, "available"); assert.equal(response.source, "live"); assert.equal(response.currency, "PKR");
  assert.deepEqual(response.estimates.map((estimate) => [estimate.rideType, estimate.fare, estimate.currency]), [["ride_moto", 163, "PKR"], ["ride_mini", 450, "PKR"], ["ride_premium", 780, "PKR"]]);
  assert.equal(response.estimates[0].priceType, "suggested"); assert.equal(response.estimates[0].isNegotiable, true); assert.equal(response.estimates[1].priceType, "fixed");
});

test("inDrive diagnostic transport is not invoked without authorization configuration", async () => {
  let calls = 0;
  const provider = createIndriveProvider({ config: { id: "indrive", displayName: "inDrive", currency: "PKR", currencyMultiplier: 100, mode: "unavailable" }, transport: { async getFareEstimates() { calls += 1; return { status: "available", currency: "PKR", estimates: [{ fare: 1 }] }; } } });
  const response = await provider.getFareEstimates({ pickup: route.pickup, destination: route.destination, route });
  assert.equal(calls, 0); assert.equal(response.status, "unavailable"); assert.equal(response.error.code, "LIVE_INTEGRATION_NOT_CONFIGURED"); assert.deepEqual(response.estimates, []);
});
