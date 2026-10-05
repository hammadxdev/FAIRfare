const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateSimulatedFare, categoryFor, calibrationMatrix, SIMULATION_CONFIG } = require("../providers/simulation.engine");
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
const fixedContext = { hour: 13, dayOfWeek: 2, isWeekend: false };

test("simulation is deterministic for the same route and time context", () => {
  assert.deepEqual(calculateSimulatedFare({ ...context, context: fixedContext }), calculateSimulatedFare({ ...context, context: fixedContext }));
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

test("inDrive exposes recommended fare semantics, boundaries, and deterministic price steps", () => {
  const quote = calculateSimulatedFare({ provider: "indrive", vehicleType: "car", route, context: fixedContext });
  assert.equal(quote.fareType, "RECOMMENDED");
  assert.ok(quote.fareMin <= quote.fare && quote.fare <= quote.fareMax);
  assert.deepEqual(quote.metadata.priceSteps, { down: quote.fareMin, recommended: quote.fare, up: quote.fareMax });
});

test("Yango and Bykea use independent upfront category configurations", () => {
  const yango = calculateSimulatedFare({ provider: "quickride", vehicleType: "bike", route, context: fixedContext });
  const bykea = calculateSimulatedFare({ provider: "urbancab", vehicleType: "bike", route, context: fixedContext });
  const yangoCar = calculateSimulatedFare({ provider: "quickride", vehicleType: "car", route, context: fixedContext });
  assert.equal(yango.fareType, "ESTIMATE");
  assert.equal(bykea.fareType, "ESTIMATE");
  assert.notEqual(yango.fare, bykea.fare);
  assert.ok(yangoCar.fare > yango.fare);
  assert.ok(SIMULATION_CONFIG.quickride.categories.bike.baseFare !== SIMULATION_CONFIG.urbancab.categories.bike.baseFare);
});

test("all simulated fare inputs remain finite, non-negative, PKR, and have usable ETA", () => {
  for (const provider of Object.keys(SIMULATION_CONFIG)) for (const vehicleType of Object.keys(SIMULATION_CONFIG[provider].categories)) {
    const quote = calculateSimulatedFare({ provider, vehicleType, route: { distanceMeters: 0, durationSeconds: 0 }, context: fixedContext });
    assert.equal(quote.currency, "PKR");
    assert.ok(Number.isFinite(quote.fare) && quote.fare >= 0);
    assert.ok(quote.pickupEtaSeconds >= 120 && quote.pickupEtaSeconds <= 720);
    assert.equal(quote.metadata.dataSource, "SIMULATED");
  }
});

test("context and congestion are deterministic and modest", () => {
  const normal = calculateSimulatedFare({ provider: "quickride", vehicleType: "car", route: { distanceMeters: 8000, durationSeconds: 1500 }, context: fixedContext });
  const traffic = calculateSimulatedFare({ provider: "quickride", vehicleType: "car", route: { distanceMeters: 8000, durationSeconds: 2400 }, context: fixedContext });
  const peak = calculateSimulatedFare({ provider: "quickride", vehicleType: "car", route: { distanceMeters: 8000, durationSeconds: 1500 }, context: { hour: 18, dayOfWeek: 2, isWeekend: false } });
  assert.ok(traffic.fare > normal.fare);
  assert.ok(peak.fare > normal.fare);
  assert.deepEqual(peak, calculateSimulatedFare({ provider: "quickride", vehicleType: "car", route: { distanceMeters: 8000, durationSeconds: 1500 }, context: { hour: 18, dayOfWeek: 2, isWeekend: false } }));
});

test("calibration matrix covers every configured provider category", () => {
  const matrix = calibrationMatrix();
  assert.equal(matrix.length, 4 * (5 + 4 + 4));
  assert.ok(matrix.every((row) => Number.isFinite(row.fare) && row.fare > 0));
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
