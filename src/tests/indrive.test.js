const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { createSessionManager } = require("../providers/indrive/indrive.auth");
const { createIndriveAdapter, buildPricingPayload } = require("../providers/indrive/indrive.adapter");
const { createIndriveClient } = require("../providers/indrive/indrive.client");
const { mapPricingResponse } = require("../providers/indrive/indrive.mapper");

function createDb() {
  const database = new Database(":memory:");
  database.exec(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  return database;
}

const config = {
  enabled: true, mode: "real", refreshToken: "seed-refresh", deviceFingerprint: "device", fingerprint: "finger",
  appVersion: "android 5.157.0", language: "en_US", osType: "android", appFlavor: "indriver",
  timeoutMs: 1000, refreshBufferSeconds: 300,
};

test("inDrive session manager reports missing refresh configuration without crashing", async () => {
  const database = createDb();
  const manager = createSessionManager({ config: { ...config, refreshToken: "" }, client: { renew: async () => { throw new Error("must not call"); } }, database, logger: { log() {} } });
  await assert.rejects(manager.ensureValidSession(), (error) => error.code === "PROVIDER_NOT_CONFIGURED");
  assert.equal(database.prepare("SELECT status FROM provider_sessions WHERE provider='indrive'").get().status, "NOT_CONFIGURED");
});

test("concurrent refresh calls are single-flight and rotated refresh token persists", async () => {
  const database = createDb();
  let calls = 0;
  const manager = createSessionManager({
    config, database, logger: { log() {} },
    client: { renew: async (token) => { calls += 1; assert.equal(token, "seed-refresh"); await new Promise((resolve) => setTimeout(resolve, 5)); return { status: 200, body: { access_token: "access-1", refresh_token: "refresh-2", expires_in: 3600 } }; } },
  });
  const tokens = await Promise.all([manager.ensureValidSession(), manager.ensureValidSession(), manager.ensureValidSession()]);
  assert.deepEqual(tokens, ["access-1", "access-1", "access-1"]);
  assert.equal(calls, 1);
  assert.equal(database.prepare("SELECT refresh_token FROM provider_sessions WHERE provider='indrive'").get().refresh_token, "refresh-2");
});

test("pricing payload keeps route values numeric and 401 retries once", async () => {
  const payload = buildPricingPayload({ pickup: { latitude: 31.1, longitude: 74.2 }, destination: { latitude: 31.2, longitude: 74.3 }, distanceMeters: 4142, durationSeconds: 944 });
  assert.equal(typeof payload.route[0].latitude, "number");
  assert.equal(payload.geo.distance_meters, 4142);
  const database = createDb();
  let pricingCalls = 0;
  const session = createSessionManager({ config, database, logger: { log() {} }, client: { renew: async () => ({ status: 200, body: { access_token: "token", expires_in: 3600 } }) } });
  const adapter = createIndriveAdapter({ config, session, client: {
    renew: async () => ({ status: 200, body: { access_token: "token", expires_in: 3600 } }),
    getPricing: async () => { pricingCalls += 1; return pricingCalls === 1 ? { status: 401, body: {} } : { status: 200, body: { data: [] } }; },
  } });
  const quotes = await adapter.getQuotes({ route: { ...payload, pickup: { latitude: 31.1, longitude: 74.2 }, destination: { latitude: 31.2, longitude: 74.3 } }, rate: { base_fare: 1, per_km_rate: 1, per_min_rate: 1, minimum_fare: 1, surge_multiplier: 1 }, vehicleType: "bike" });
  assert.deepEqual(quotes, []);
  assert.equal(pricingCalls, 2);
});

test("pricing client sends required auth headers and a fresh request id", async () => {
  const requests = [];
  const client = createIndriveClient({ config, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { status: 200, text: async () => JSON.stringify({ data: [] }) };
  } });
  await client.getPricing("access-token", buildPricingPayload({ pickup: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, distanceMeters: 10, durationSeconds: 20 }));
  await client.getPricing("access-token", buildPricingPayload({ pickup: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, distanceMeters: 10, durationSeconds: 20 }));
  assert.equal(requests[0].url, "https://api-gw-cf.sa.apse1.aws.indriverapp.com/recprice-gateway-backend/api/pricing/v6/price");
  assert.equal(requests[0].options.headers.Authorization, "Bearer access-token");
  assert.equal(requests[0].options.headers["X-Fingerprint"], "finger");
  assert.notEqual(requests[0].options.headers["X-Local-Req-Id"], requests[1].options.headers["X-Local-Req-Id"]);
});

test("inDrive mapper preserves one normalized quote per returned category", () => {
  const quotes = mapPricingResponse({ quotes: [
    { order_type_id: 2, fare: 250, currency: "PKR" },
    { order_type_id: 31, fare: 430, currency: "PKR" },
    { order_type_id: 33, fare: 500, currency: "PKR" },
  ] }, { distanceMeters: 1000, durationSeconds: 120 });
  assert.equal(quotes.length, 3);
  assert.deepEqual(quotes.slice(0, 2).map((quote) => [quote.categoryId, quote.categoryName]), [["2", "Moto"], ["31", "Rickshaw"]]);
  assert.equal(quotes[2].categoryId, "33");
  assert.equal(quotes[2].categoryName, null);
});
