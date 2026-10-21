const test = require("node:test");
const assert = require("node:assert/strict");
const { forecastFare, simulationContract } = require("../services/ai/fareForecast.service");

test("requires qualified real observations", () => {
  const result = forecastFare({ observations: [{ fare: 300, sourceType: "simulated" }, { fare: 400, sourceType: "historical_observation", isSynthetic: true }] });
  assert.equal(result.status, "INSUFFICIENT_DATA"); assert.equal(result.sourceType, "unavailable");
});
test("returns a forecast only from qualifying observations", () => {
  const observations = [300, 350, 400, 420, 450].map((fare, index) => ({ fare, sourceType: "historical_observation", providerId: "yango", verifiedVehicleCategory: "car", city: "Lahore", timeBucket: "morning", observedAt: `2026-10-${String(10 + index).padStart(2, "0")}T08:00:00.000Z` }));
  const result = forecastFare({ observations, providerId: "yango", vehicleType: "car", city: "Lahore", timeBucket: "morning", forecastAt: "2026-10-21T08:00:00.000Z" });
  assert.equal(result.status, "LIMITED_CALIBRATION"); assert.equal(result.sourceType, "forecast"); assert.equal(result.dataSource, "qualified_historical_observations");
});
test("simulation contract cannot claim verified availability or actions", () => {
  const result = simulationContract({ providerId: "indrive", estimatedMin: 200, estimatedMax: 300, actions: ["Book Now"] });
  assert.equal(result.sourceType, "simulated"); assert.equal(result.availability, "not_verified"); assert.deepEqual(result.actions, []);
});
