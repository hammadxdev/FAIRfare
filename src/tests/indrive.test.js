const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionManager } = require("../providers/indrive/indrive.auth");
const { createIndriveAdapter, buildPricingPayload } = require("../providers/indrive/indrive.adapter");
const { createIndriveClient } = require("../providers/indrive/indrive.client");
const { mapPricingResponse } = require("../providers/indrive/indrive.mapper");

function createDb() {
  const state = { row: null };
  return {
    state,
    async query(text, params) {
      if (/^SELECT \* FROM provider_sessions/i.test(text)) return { rows: state.row ? [{ ...state.row }] : [] };
      state.row = {
        provider: params[0],
        access_token: params[1],
        refresh_token: params[2],
        access_expires_at: params[3],
        status: params[4],
        updated_at: params[5],
      };
      return { rows: [], rowCount: 1 };
    },
  };
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
  assert.equal(database.state.row.status, "NOT_CONFIGURED");
});

test("concurrent refresh calls are single-flight and rotated refresh token persists", async () => {
  const database = createDb();
  let calls = 0;
  const logs = [];
  const now = () => 1_700_000_000_000;
  const manager = createSessionManager({
    config, database, now, logger: { log(message) { logs.push(message); } },
    client: { renew: async (token) => { calls += 1; assert.equal(token, "seed-refresh"); await new Promise((resolve) => setTimeout(resolve, 5)); return { status: 200, body: { access_token: "access-1", refresh_token: "refresh-2", expires_in: 3600 } }; } },
  });
  const tokens = await Promise.all([manager.ensureValidSession(), manager.ensureValidSession(), manager.ensureValidSession()]);
  assert.deepEqual(tokens, ["access-1", "access-1", "access-1"]);
  assert.equal(calls, 1);
  assert.equal(database.state.row.access_token, "access-1");
  assert.equal(database.state.row.access_expires_at, now() + 3600 * 1000);
  assert.equal(database.state.row.refresh_token, "refresh-2");
  assert.doesNotMatch(logs.join(" "), /seed-refresh|refresh-2|access-1/);
});

test("renewal client sends the verified endpoint, body, and observed fingerprint headers", async () => {
  let request;
  const client = createIndriveClient({ config, fetchImpl: async (url, options) => {
    request = { url, options };
    return { status: 200, text: async () => JSON.stringify({ access_token: "synthetic-access", expires_in: 10800, refresh_token: "synthetic-rotated-refresh" }) };
  } });
  const response = await client.renew("synthetic-refresh");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { access_token: "synthetic-access", expires_in: 10800, refresh_token: "synthetic-rotated-refresh" });
  assert.equal(request.url, "https://ath-gw-cf.euce1.indriverapp.com/api/auth/v1/token/renew");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { refresh_token: "synthetic-refresh" });
  assert.equal(request.options.headers["X-Device-Fingerprint"], "device");
  assert.equal(request.options.headers["X-Fingerprint"], "finger");
  assert.doesNotMatch(JSON.stringify(request), /live|real-secret|captured/i);
});

test("pricing payload keeps route values numeric and 401 retries once", async () => {
  const payload = buildPricingPayload({ vehicleType: "bike", pickup: { latitude: 31.1, longitude: 74.2 }, destination: { latitude: 31.2, longitude: 74.3 }, distanceMeters: 4142, durationSeconds: 944 });
  assert.equal(typeof payload.route[0].latitude, "number");
  assert.equal(payload.order_type_id, 2);
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
  await client.getPricing("access-token", buildPricingPayload({ vehicleType: "BIKE", pickup: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, distanceMeters: 10, durationSeconds: 20 }));
  await client.getPricing("access-token", buildPricingPayload({ vehicleType: "BIKE", pickup: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, distanceMeters: 10, durationSeconds: 20 }));
  assert.equal(requests[0].url, "https://api-gw-cf.sa.apse1.aws.indriverapp.com/recprice-gateway-backend/api/pricing/v5/price");
  assert.equal(requests[0].options.headers.Authorization, "Bearer access-token");
  assert.equal(requests[0].options.headers["X-Fingerprint"], "finger");
  assert.notEqual(requests[0].options.headers["X-Local-Req-Id"], requests[1].options.headers["X-Local-Req-Id"]);
});

test("inDrive mapper preserves one normalized quote per returned category", () => {
  const quotes = mapPricingResponse({ currency: { code: "PKR", multiplier: 100 }, quotes: [
     { order_type_id: 2, autofill_price: 25000 },
     { order_type_id: 31, autofill_price: 43000 },
     { order_type_id: 33, autofill_price: 50000 },
  ] }, { distanceMeters: 1000, durationSeconds: 120 });
  assert.equal(quotes.length, 3);
  assert.deepEqual(quotes.slice(0, 2).map((quote) => [quote.categoryId, quote.categoryName]), [["2", "Moto"], ["31", "Rickshaw"]]);
  assert.equal(quotes[2].categoryId, "33");
  assert.equal(quotes[2].categoryName, "Mini");
  assert.deepEqual(quotes.map((quote) => quote.normalizedCategory), ["BIKE", "RICKSHAW", "ECONOMY_CAR"]);
});

test("all verified order type mappings are preserved", () => {
  const response = { currency: { code: "PKR", multiplier: 100 }, calculations: [
    { order_type_id: 2, autofill_price: 100 }, { order_type_id: 33, autofill_price: 100 },
    { order_type_id: 31, autofill_price: 100 }, { order_type_id: 29, autofill_price: 100 },
    { order_type_id: 11, autofill_price: 100 },
  ] };
  assert.deepEqual(mapPricingResponse(response).map((quote) => [quote.categoryId, quote.categoryName, quote.normalizedCategory]), [
    ["2", "Moto", "BIKE"], ["33", "Mini", "ECONOMY_CAR"], ["31", "Rickshaw", "RICKSHAW"],
    ["29", "Ride AC", "STANDARD_CAR"], ["11", "Premium", "PREMIUM_CAR"],
  ]);
});

test("verified single-category response normalizes money and preserves fare semantics", () => {
  const [quote] = mapPricingResponse({
    order_type_id: 29,
    autofill_price: { currency: { code: "PKR", multiplier: 100 }, value: 10900 },
    price: { value: 11000 }, price_min: { value: 10000 }, price_max: { value: 12000 },
    rush_hour: { is_rush: true }, ttl: 300,
  }, { distanceMeters: 12, durationSeconds: 34 });
  assert.equal(quote.fare, 109);
  assert.equal(quote.fareMin, 100);
  assert.equal(quote.fareMax, 120);
  assert.equal(quote.metadata.price, 110);
  assert.equal(quote.metadata.isRush, true);
  assert.equal(quote.metadata.providerTtlSeconds, 300);
  assert.equal(quote.pickupEtaSeconds, null);
});

test("multi-category calculations preserve price steps and unknown categories safely", () => {
  const quotes = mapPricingResponse({ currency: { code: "PKR", multiplier: 100 }, ttl: 300, calculations: [
    { order_type_id: 11, autofill_price: 15000, price: 15500, price_min: 14000, price_max: 17000, is_rush: false, price_steps: { delta_up: 100, values: [14000, 15000] } },
    { order_type_id: 999, autofill_price: 20000, price_steps: { delta_up: 100, values: [20000] } },
  ] });
  assert.equal(quotes[0].fare, 150);
  assert.equal(quotes[0].normalizedCategory, "PREMIUM_CAR");
  assert.deepEqual(quotes[0].metadata.priceSteps.values, [14000, 15000]);
  assert.equal(quotes[1].categoryId, "999");
  assert.equal(quotes[1].categoryName, null);
  assert.equal(quotes[1].normalizedCategory, "UNKNOWN");
});

test("missing or invalid multiplier does not create a monetary quote", () => {
  assert.equal(mapPricingResponse({ currency: { code: "PKR" }, calculations: [{ order_type_id: 2, autofill_price: 100 }] })[0].fare, null);
  assert.equal(mapPricingResponse({ currency: { code: "PKR", multiplier: 0 }, calculations: [{ order_type_id: 2, autofill_price: 100 }] })[0].fare, null);
});

test("normalized provider metadata excludes credentials and fingerprint fields", () => {
  const [quote] = mapPricingResponse({ currency: { code: "PKR", multiplier: 100 }, calculations: [{
    order_type_id: 2, autofill_price: 10000, Authorization: "synthetic-access-token",
    profile_id: "synthetic-profile-id", X_Fingerprint: "synthetic-fingerprint",
  }] });
  assert.doesNotMatch(JSON.stringify(quote), /synthetic-access-token|synthetic-profile-id|synthetic-fingerprint/);
});

test("a second pricing 401 marks auth required without another retry", async () => {
  let pricingCalls = 0;
  const database = createDb();
  const session = createSessionManager({ config, database, logger: { log() {} }, client: {
    renew: async () => ({ status: 200, body: { access_token: "access-2", expires_in: 3600 } }),
  } });
  const adapter = createIndriveAdapter({ config, session, client: {
    renew: async () => ({ status: 200, body: { access_token: "access-2", expires_in: 3600 } }),
    getPricing: async () => { pricingCalls += 1; return { status: 401, body: {} }; },
  } });
  await assert.rejects(adapter.getQuotes({ route: { pickup: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, distanceMeters: 10, durationSeconds: 20 }, rate: {}, vehicleType: "bike" }), (error) => error.code === "PROVIDER_AUTH_REQUIRED");
  assert.equal(pricingCalls, 2);
});

test("unsupported request category is rejected without guessing", () => {
  assert.throws(() => buildPricingPayload({ vehicleType: "spaceship", pickup: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 }, distanceMeters: 10, durationSeconds: 20 }), /category is not supported/);
});
