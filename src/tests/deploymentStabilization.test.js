const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
process.env.NODE_ENV = "test";
const { getConfig } = require("../providers/indrive/indrive.constants");
const { modeFor } = require("../providers/simulated.provider");
const { createIndriveAdapter } = require("../providers/indrive/indrive.adapter");
const { getProviderStatus } = require("../providers/provider.registry");

const route = {
  pickup: { latitude: 31.48, longitude: 74.31 },
  destination: { latitude: 31.50, longitude: 74.34 },
  distanceMeters: 8000,
  durationSeconds: 1500,
};

test("provider mode configuration fails closed to simulation", () => {
  assert.equal(getConfig({ INDRIVE_MODE: "real" }).mode, "simulated");
  assert.equal(getConfig({ INDRIVE_MODE: "unexpected", FAIRFARE_SIMULATION_ONLY: "false" }).mode, "simulated");
  assert.equal(modeFor("quickride", { YANGO_MODE: "real" }).toString(), "simulated");
  assert.equal(modeFor("urbancab", { BYKEA_MODE: "real" }).toString(), "simulated");
});

test("simulated inDrive quotes and status do not call real session or pricing", async () => {
  let renewCalls = 0;
  let pricingCalls = 0;
  const adapter = createIndriveAdapter({
    config: { mode: "simulated", enabled: true },
    session: { getStatus: () => { throw new Error("session status must not be read"); }, ensureValidSession: async () => { renewCalls += 1; throw new Error("renew must not run"); } },
    client: { getPricing: async () => { pricingCalls += 1; throw new Error("pricing must not run"); } },
  });
  assert.equal(adapter.getStatus(), "READY");
  const quotes = await adapter.getQuotes({ route, vehicleType: "BIKE", rate: {}, observedAt: 1700000000000, context: { hour: 12, dayOfWeek: 2, isWeekend: false }, weather: { condition: "CLEAR", weatherSeverity: "LIGHT" } });
  assert.ok(quotes[0].fare > 0);
  assert.equal(renewCalls, 0);
  assert.equal(pricingCalls, 0);
});

test("provider status is safe in the default simulated deployment", async () => {
  const statuses = await getProviderStatus();
  assert.deepEqual(statuses.map((item) => item.id), ["indrive", "quickride", "yango", "urbancab"]);
  assert.deepEqual(statuses.map((item) => item.mode), ["simulated", "simulated", "unavailable", "simulated"]);
  assert.deepEqual(statuses.map((item) => item.status), ["READY", "READY", "NOT_CONFIGURED", "READY"]);
  assert.deepEqual(statuses.find((item) => item.id === "yango"), { id: "yango", enabled: false, mode: "unavailable", status: "NOT_CONFIGURED" });
});

test("weather observation migration contains every runtime column", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/007_weather_observation_columns.sql"), "utf8");
  for (const column of ["weather_condition", "weather_severity", "precipitation_mm", "temperature_c"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
});
