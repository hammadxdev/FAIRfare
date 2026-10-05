const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateSimulatedFare, categoryFor } = require("../providers/simulation.engine");
const { createSimulatedProvider } = require("../providers/simulated.provider");
const indrive = require("../providers/indrive/indrive.adapter");

const route = {
  pickup: { latitude: 24.86, longitude: 67.01 },
  destination: { latitude: 24.90, longitude: 67.08 },
  distanceMeters: 8000,
  durationSeconds: 1800,
};
const rate = { base_fare: 100, per_km_rate: 30, per_min_rate: 2, minimum_fare: 150, surge_multiplier: 1 };
const context = { provider: "indrive", vehicleType: "car", rate, route, observedAt: Date.parse("2026-10-05T13:00:00Z") };

test("simulation is deterministic for the same route and time context", () => {
  assert.deepEqual(calculateSimulatedFare(context), calculateSimulatedFare(context));
});

test("distance and vehicle class affect fares without negative values", () => {
  const shortBike = calculateSimulatedFare({ ...context, vehicleType: "bike", route: { ...route, distanceMeters: 2000 } });
  const longBike = calculateSimulatedFare({ ...context, vehicleType: "bike" });
  const premium = calculateSimulatedFare({ ...context, vehicleType: "premium", rate: { ...rate, base_fare: 180, per_km_rate: 50, per_min_rate: 3, minimum_fare: 250 } });
  assert.ok(longBike.fare > shortBike.fare);
  assert.ok(premium.fare > longBike.fare);
  assert.ok(shortBike.fare >= 0);
  assert.equal(shortBike.currency, "PKR");
});

test("inDrive simulation preserves verified category mapping and taxonomy", () => {
  assert.deepEqual(categoryFor("indrive", "bike"), { id: "2", name: "Moto", normalized: "BIKE" });
  assert.deepEqual(categoryFor("indrive", "mini"), { id: "33", name: "Mini", normalized: "ECONOMY_CAR" });
  assert.deepEqual(categoryFor("indrive", "rickshaw"), { id: "31", name: "Rickshaw", normalized: "RICKSHAW" });
  assert.deepEqual(categoryFor("indrive", "car"), { id: "29", name: "Ride AC", normalized: "STANDARD_CAR" });
  assert.deepEqual(categoryFor("indrive", "premium"), { id: "11", name: "Premium", normalized: "PREMIUM_CAR" });
});

test("simulated adapters use the common quote contract and never call credentials", async () => {
  const providers = [
    ["indrive", indrive.createIndriveAdapter({ config: { ...require("../providers/indrive/indrive.constants").getConfig({ INDRIVE_MODE: "simulated" }), mode: "simulated" }, client: { getPricing() { throw new Error("real pricing must not be called"); } }, session: { getStatus: async () => "READY" } })],
    ["quickride", createSimulatedProvider({ id: "quickride", displayName: "Yango" })],
    ["urbancab", createSimulatedProvider({ id: "urbancab", displayName: "Bykea" })],
  ];
  for (const [id, adapter] of providers) {
    const [quote] = await adapter.getQuotes({ route, rate, vehicleType: "car", observedAt: context.observedAt });
    assert.equal(quote.currency, "PKR");
    assert.equal(quote.metadata.simulated, true);
    assert.equal(id === "indrive" ? quote.providerCategoryId : quote.providerCategoryId, id === "indrive" ? "29" : "car");
  }
});
