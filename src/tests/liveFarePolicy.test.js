const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createIndriveProvider, normalizeLiveEstimate } = require("../providers/indrive-architecture");
const { isLiveFareResult } = require("../services/fare.service");

const locations = {
  pickup: { latitude: 31.47, longitude: 74.41 },
  destination: { latitude: 31.52, longitude: 74.35 },
};
const route = { distanceMeters: 9301, durationSeconds: 1139 };

test("non-live and invalid fare values are never eligible for comparison", () => {
  assert.equal(isLiveFareResult({ dataSource: "SIMULATED", isAvailable: true, fare: 200 }), false);
  assert.equal(isLiveFareResult({ dataSource: "REAL", isAvailable: true, fare: 0 }), false);
  assert.equal(isLiveFareResult({ dataSource: "REAL", isAvailable: true, fare: "not-a-number" }), false);
  assert.equal(isLiveFareResult({ dataSource: "REAL", isAvailable: true, fare: 450 }), true);
});
test("authorized minor-unit fares normalize to PKR and stale responses are rejected", async () => {
  assert.equal(normalizeLiveEstimate({ rideType: "standard", fareMinor: 45000 }, "PKR", 100).fare, 450);
  const provider = createIndriveProvider({
    config: { id: "indrive", displayName: "inDrive", currency: "PKR", currencyMultiplier: 100, mode: "authorized-live" },
    transport: { getFareEstimates: async () => ({ status: "available", currency: "PKR", expiresAt: new Date(Date.now() - 1000).toISOString(), estimates: [{ rideType: "standard", fareMinor: 45000 }] }) },
  });
  const response = await provider.getFareEstimates({ ...locations, route });
  assert.equal(response.status, "unavailable");
  assert.equal(response.error.code, "STALE_PROVIDER_RESPONSE");
  assert.deepEqual(response.estimates, []);
});

test("authorized live transport returns normalized live estimates", async () => {
  const provider = createIndriveProvider({
    config: { id: "indrive", displayName: "inDrive", currency: "PKR", currencyMultiplier: 100, mode: "authorized-live" },
    transport: { getFareEstimates: async () => ({ status: "available", currency: "PKR", estimates: [{ rideType: "standard", fareMinor: 45000 }] }) },
  });
  const response = await provider.getFareEstimates({ ...locations, route });
  assert.equal(response.status, "available");
  assert.equal(response.source, "live");
  assert.equal(response.estimates[0].fare, 450);
});

test("comparison source uses isolated settlement and contains no production mock fare fallback", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "services", "fare.service.js"), "utf8");
  assert.match(service, /Promise\.allSettled/);
  assert.doesNotMatch(service, /mockCompareFares|mockFares/);
});

test("provider without authorized live transport returns no fare", async () => {
  const provider = createIndriveProvider({ config: { id: "indrive", displayName: "inDrive", currency: "PKR", mode: "unavailable" } });
  const response = await provider.getFareEstimates({ ...locations, route });
  assert.equal(response.status, "unavailable");
  assert.equal(response.source, "none");
  assert.deepEqual(response.estimates, []);
  assert.equal(response.error.code, "LIVE_INTEGRATION_NOT_CONFIGURED");
});

test("timeout does not fall back to a simulated fare", async () => {
  const provider = createIndriveProvider({
    config: { id: "indrive", displayName: "inDrive", currency: "PKR", mode: "authorized-live" },
    transport: { getFareEstimates: async () => { const error = new Error("timeout"); error.code = "PROVIDER_TIMEOUT"; throw error; } },
  });
  const response = await provider.getFareEstimates({ ...locations, route });
  assert.equal(response.status, "timeout");
  assert.deepEqual(response.estimates, []);
  assert.equal(response.source, "none");
});

test("zero and invalid live fares are rejected", async () => {
  for (const fare of [0, "bad", -1]) {
    const provider = createIndriveProvider({
      config: { id: "indrive", displayName: "inDrive", currency: "PKR", mode: "authorized-live" },
      transport: { getFareEstimates: async () => ({ provider: "indrive", status: "available", currency: "PKR", estimates: [{ rideType: "standard", fare }] }) },
    });
    const response = await provider.getFareEstimates({ ...locations, route });
    assert.equal(response.status, "provider_error");
    assert.deepEqual(response.estimates, []);
  }
});
