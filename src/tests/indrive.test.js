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
      if (/pg_advisory_xact_lock/i.test(text)) return { rows: [] };
      if (/^SELECT \* FROM provider_sessions/i.test(text)) return { rows: state.row ? [{ ...state.row }] : [] };
      state.row = {
        provider: params[0],
        access_token: params[1],
        refresh_token: params[2],
        access_expires_at: params[3],
        status: params[4],
        rotation_version: params[5],
        last_rotated_at: params[6],
        updated_at: params[7],
      };
      return { rows: [], rowCount: 1 };
    },
  };
}

function createAuthoritativeDb(initial = null) {
  const db = createDb();
  db.state.row = initial;
  let queue = Promise.resolve();
  db.withTransaction = async (work) => {
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const previous = queue;
    queue = queue.then(() => turn);
    await previous;
    try { return await work({ query: db.query.bind(db) }); }
    finally { release(); }
  };
  return db;
}

const config = {
  enabled: true, mode: "real", refreshToken: "seed-refresh", deviceFingerprint: "device", fingerprint: "finger",
  appVersion: "android 5.157.0", language: "en_US", osType: "android", appFlavor: "indriver",
  timeoutMs: 1000, refreshBufferSeconds: 300,
};

function syntheticJwt(exp) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part({ exp })}.signature`;
}

const testRoute = {
  pickup: { latitude: 31.1, longitude: 74.2 },
  destination: { latitude: 31.2, longitude: 74.3 },
  distanceMeters: 4142,
  durationSeconds: 944,
};

function createPricingAdapter({ database, now = () => 1_700_000_000_000, configOverrides = {}, renew, getPricing }) {
  const runtimeConfig = { ...config, ...configOverrides };
  const client = { renew, getPricing };
  const session = createSessionManager({ client, config: runtimeConfig, database, now, logger: { log() {} } });
  return createIndriveAdapter({ config: runtimeConfig, session, client });
}

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

test("valid persisted session reuses access token without renewal", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "persisted-access", refresh_token: "persisted-refresh", access_expires_at: now() + 900_000, status: "READY", updated_at: now() };
  let renewCalls = 0;
  let pricingToken;
  const adapter = createPricingAdapter({ database, now, renew: async () => { renewCalls += 1; }, getPricing: async (token) => { pricingToken = token; return { status: 200, body: { data: [] } }; } });
  await adapter.getQuotes({ route: testRoute, rate: {}, vehicleType: "bike" });
  assert.equal(renewCalls, 0);
  assert.equal(pricingToken, "persisted-access");
});

test("valid JWT with two hours remaining does not renew", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: syntheticJwt(1_700_007_200), refresh_token: "persisted-refresh", access_expires_at: null, status: "READY", updated_at: now() };
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; } } });
  assert.equal(await manager.ensureValidSession(), database.state.row.access_token);
  assert.equal(renewCalls, 0);
  manager.stop();
});

test("valid JWT with thirty minutes remaining does not renew", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: syntheticJwt(1_700_001_800), refresh_token: "persisted-refresh", access_expires_at: null, status: "READY", updated_at: now() };
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; } } });
  await manager.start();
  assert.equal(renewCalls, 0);
  assert.equal(await manager.getStatus(), "READY");
  manager.stop();
});

test("unknown expiry preserves the current access token without a renewal loop", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "opaque-access", refresh_token: "persisted-refresh", access_expires_at: null, status: "READY", updated_at: now() };
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; } } });
  assert.equal(await manager.ensureValidSession(), "opaque-access");
  assert.equal(await manager.getStatus(), "EXPIRY_UNKNOWN");
  assert.equal(renewCalls, 0);
  manager.stop();
});

test("newer configured JWT is preferred over an older persisted JWT", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: syntheticJwt(1_700_001_000), refresh_token: "old-refresh", access_expires_at: null, status: "READY", updated_at: now() };
  const newer = syntheticJwt(1_700_007_200);
  let renewCalls = 0;
  const manager = createSessionManager({ config: { ...config, accessToken: newer, refreshToken: "new-refresh" }, database, now, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; } } });
  assert.equal(await manager.ensureValidSession(), newer);
  assert.equal(renewCalls, 0);
  manager.stop();
});

test("near-expiry persisted session renews once and pricing uses the new access token", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "near-expiry-access", refresh_token: "persisted-refresh", access_expires_at: now() + 299_000, status: "READY", updated_at: now() };
  let renewCalls = 0;
  let pricingToken;
  const adapter = createPricingAdapter({ database, now, renew: async () => { renewCalls += 1; return { status: 200, body: { access_token: "renewed-access", refresh_token: "rotated-refresh", expires_in: 3600 } }; }, getPricing: async (token) => { pricingToken = token; return { status: 200, body: { data: [] } }; } });
  await adapter.getQuotes({ route: testRoute, rate: {}, vehicleType: "bike" });
  assert.equal(renewCalls, 1);
  assert.equal(pricingToken, "renewed-access");
  assert.equal(database.state.row.refresh_token, "rotated-refresh");
});

test("expired persisted session renews exactly once", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "expired-access", refresh_token: "persisted-refresh", access_expires_at: now() - 1, status: "READY", updated_at: now() };
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; return { status: 200, body: { access_token: "renewed-access", expires_in: 3600 } }; } } });
  assert.equal(await manager.ensureValidSession(), "renewed-access");
  assert.equal(renewCalls, 1);
});

test("missing session uses bootstrap refresh credential once and creates a session", async () => {
  const database = createDb();
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, logger: { log() {} }, client: { renew: async (token) => { renewCalls += 1; assert.equal(token, "seed-refresh"); return { status: 200, body: { access_token: "bootstrapped-access", refresh_token: "bootstrapped-refresh", expires_in: 3600 } }; } } });
  assert.equal(await manager.ensureValidSession(), "bootstrapped-access");
  assert.equal(renewCalls, 1);
  assert.equal(database.state.row.status, "READY");
  assert.equal(database.state.row.refresh_token, "bootstrapped-refresh");
});

test("startup reuses a valid persisted session without refreshing", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "startup-access", refresh_token: "startup-refresh", access_expires_at: now() + 900_000, status: "READY", updated_at: now() };
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; } } });
  await manager.start();
  assert.equal(await manager.ensureValidSession(), "startup-access");
  assert.equal(renewCalls, 0);
  manager.stop();
});

test("startup refreshes a near-expiry session and persists rotation", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "old-access", refresh_token: "old-refresh", access_expires_at: now() + 299_000, status: "READY", updated_at: now() };
  let renewedWith;
  const manager = createSessionManager({
    config, database, now, logger: { log() {} },
    client: { renew: async (refreshToken) => { renewedWith = refreshToken; return { status: 200, body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 10800 } }; } },
  });
  await manager.start();
  assert.equal(renewedWith, "old-refresh");
  assert.equal(database.state.row.access_token, "new-access");
  assert.equal(database.state.row.refresh_token, "new-refresh");
  manager.stop();
});

test("rotated credentials survive a session-manager restart", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  const first = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => ({ status: 200, body: { access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 } }) } });
  await first.ensureValidSession();
  first.stop();
  let secondRenewals = 0;
  const second = createSessionManager({ config, database, now, logger: { log() {} }, client: { renew: async () => { secondRenewals += 1; } } });
  assert.equal(await second.ensureValidSession(), "rotated-access");
  assert.equal(database.state.row.refresh_token, "rotated-refresh");
  assert.equal(secondRenewals, 0);
  second.stop();
});

test("database token diagnostics are sanitized and identify PostgreSQL as the source", async () => {
  const database = createDb();
  database.state.row = { provider: "indrive", access_token: "database-access", refresh_token: "database-refresh", access_expires_at: 1_700_001_800_000, status: "READY", rotation_version: 4, last_rotated_at: 1_700_000_100_000, updated_at: 1_700_000_100_000 };
  const manager = createSessionManager({ config, database, now: () => 1_700_000_000_000, logger: { log() {} }, client: {} });
  assert.deepEqual(await manager.getTokenDiagnostics(), {
    tokenPresent: true, refreshTokenPresent: true, accessExpiresAt: 1_700_001_800_000,
    expiryKnown: true, source: "postgresql", rotationVersion: 4, status: "READY",
  });
  assert.doesNotMatch(JSON.stringify(await manager.getTokenDiagnostics()), /database-access|database-refresh/);
});

test("database failure fails safely without using configured credentials", async () => {
  let renewCalls = 0;
  const database = { query: async () => { throw new Error("database unavailable"); } };
  const manager = createSessionManager({ config: { ...config, accessToken: "configured-access", refreshToken: "configured-refresh" }, database, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; } } });
  await assert.rejects(manager.ensureValidSession(), /database unavailable/);
  assert.equal(renewCalls, 0);
});

test("each request resolves the latest database access token", async () => {
  const database = createDb();
  const now = () => 1_700_000_000_000;
  database.state.row = { provider: "indrive", access_token: "database-access-1", refresh_token: "database-refresh", access_expires_at: now() + 7_200_000, status: "READY", updated_at: now() };
  const manager = createSessionManager({ config, database, now, logger: { log() {} }, client: {} });
  assert.equal(await manager.ensureValidSession(), "database-access-1");
  database.state.row.access_token = "database-access-2";
  database.state.row.access_expires_at = now() + 7_200_000;
  assert.equal(await manager.ensureValidSession(), "database-access-2");
});

test("PostgreSQL transaction lock prevents two managers from rotating the same session", async () => {
  const database = createAuthoritativeDb({ provider: "indrive", access_token: "old-access", refresh_token: "old-refresh", access_expires_at: 1_699_999_000_000, status: "READY", updated_at: 1_700_000_000_000 });
  let renewCalls = 0;
  const makeManager = () => createSessionManager({ config, database, now: () => 1_700_000_000_000, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; await new Promise((resolve) => setTimeout(resolve, 3)); return { status: 200, body: { access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 } }; } } });
  const [first, second] = [makeManager(), makeManager()];
  const tokens = await Promise.all([first.ensureValidSession(), second.ensureValidSession()]);
  assert.deepEqual(tokens, ["rotated-access", "rotated-access"]);
  assert.equal(renewCalls, 1);
  assert.equal(database.state.row.rotation_version, 1);
  first.stop(); second.stop();
});

test("a second fare request reuses the session created by the first request", async () => {
  const database = createDb();
  let renewCalls = 0;
  const pricingTokens = [];
  const adapter = createPricingAdapter({ database, renew: async () => { renewCalls += 1; return { status: 200, body: { access_token: "bootstrapped-access", refresh_token: "bootstrapped-refresh", expires_in: 3600 } }; }, getPricing: async (token) => { pricingTokens.push(token); return { status: 200, body: { data: [] } }; } });
  await adapter.getQuotes({ route: testRoute, rate: {}, vehicleType: "bike" });
  await adapter.getQuotes({ route: testRoute, rate: {}, vehicleType: "bike" });
  assert.equal(renewCalls, 1);
  assert.deepEqual(pricingTokens, ["bootstrapped-access", "bootstrapped-access"]);
});

test("renewal failure has no immediate retry loop", async () => {
  const database = createDb();
  let renewCalls = 0;
  const manager = createSessionManager({ config, database, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; return { status: 403, body: { code: "REJECTED" } }; } } });
  await assert.rejects(manager.ensureValidSession(), (error) => error.code === "PROVIDER_AUTH_REQUIRED");
  assert.equal(renewCalls, 1);
  assert.equal(database.state.row.status, "AUTH_REQUIRED");
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
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.headers["X-Device-Fingerprint"], "device");
  assert.equal(request.options.headers["X-Fingerprint"], "finger");
  assert.doesNotMatch(JSON.stringify(request), /live|real-secret|captured/i);
});

test("renewal sends a fresh local request id and safe diagnostics never expose credentials", async () => {
  const requests = [];
  const logs = [];
  const logger = { log: (...args) => logs.push(args) };
  const client = createIndriveClient({ config, logger, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { status: 401, headers: { get: () => "application/json; charset=utf-8" }, text: async () => JSON.stringify({
      code: "INVALID_REFRESH_TOKEN", message: "refresh token rejected", access_token: "secret-access", refresh_token: "secret-refresh",
    }) };
  } });
  await client.renew("secret-refresh");
  await client.renew("secret-refresh");
  const ids = requests.map((request) => request.options.headers["X-Local-Req-Id"]);
  assert.match(ids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(ids[1], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(ids[0], ids[1]);
  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /secret-refresh|secret-access|"device"|"finger"/i);
  assert.match(serializedLogs, /INVALID_REFRESH_TOKEN/);
  assert.match(serializedLogs, /providerErrorMessage.:null/);
  assert.match(serializedLogs, /accessTokenReturned/);
  assert.match(serializedLogs, /refreshTokenReturned/);
});

test("renewal 401 and 403 remain PROVIDER_AUTH_REQUIRED", async () => {
  for (const status of [401, 403]) {
    const manager = createSessionManager({
      config, database: createDb(), logger: { log() {} },
      client: { renew: async () => ({ status, body: { code: "REJECTED" } }) },
    });
    await assert.rejects(manager.ensureValidSession(), (error) => error.code === "PROVIDER_AUTH_REQUIRED");
  }
});

test("pricing payload keeps route values numeric and 401 retries once", async () => {
  const payload = buildPricingPayload({ vehicleType: "bike", pickup: { latitude: 31.1, longitude: 74.2 }, destination: { latitude: 31.2, longitude: 74.3 }, distanceMeters: 4142, durationSeconds: 944 });
  assert.equal(typeof payload.route[0].latitude, "number");
  assert.equal(payload.order_type_id, 2);
  assert.equal(payload.geo.distance_meters, 4142);
  const database = createDb();
  let pricingCalls = 0;
  let renewCalls = 0;
  const session = createSessionManager({ config, database, logger: { log() {} }, client: { renew: async () => { renewCalls += 1; return { status: 200, body: { access_token: "token", expires_in: 3600 } }; } } });
  const adapter = createIndriveAdapter({ config, session, client: {
    renew: async () => ({ status: 200, body: { access_token: "token", expires_in: 3600 } }),
    getPricing: async () => { pricingCalls += 1; return pricingCalls === 1 ? { status: 401, body: {} } : { status: 200, body: { data: [] } }; },
  } });
  const quotes = await adapter.getQuotes({ route: { ...payload, pickup: { latitude: 31.1, longitude: 74.2 }, destination: { latitude: 31.2, longitude: 74.3 } }, rate: { base_fare: 1, per_km_rate: 1, per_min_rate: 1, minimum_fare: 1, surge_multiplier: 1 }, vehicleType: "bike" });
  assert.deepEqual(quotes, []);
  assert.equal(pricingCalls, 2);
  assert.equal(renewCalls, 2);
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
  assert.equal(quote.priceType, "suggested");
  assert.equal(quote.exactFare, null);
  assert.equal(quote.metadata.priceDiagnostics.upstreamPriceField, "autofill_price.value");
  assert.equal(quote.metadata.priceDiagnostics.priceClassification, "suggested");
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
test("normalizes second-based persisted expiry timestamps without changing credentials", async () => {
  const now = 1792360000000;
  const accessToken = "access-token";
  const row = {
    provider: "indrive",
    access_token: accessToken,
    refresh_token: "refresh-token",
    access_expires_at: Math.floor((now + 3600000) / 1000),
    last_rotated_at: Math.floor((now - 3600000) / 1000),
    rotation_version: 2,
    status: "READY",
  };
  const database = { query: async () => ({ rows: [row] }) };
  const manager = createSessionManager({ config: { mode: "real", enabled: true, refreshBufferSeconds: 300 }, database, now: () => now });
  const session = await manager.load();
  assert.equal(session.accessToken, accessToken);
  assert.equal(session.accessExpiresAt, now + 3600000);
  assert.equal(session.lastRotatedAt, now - 3600000);
  assert.equal(manager.hasUsableAccess(session), true);
});

test("preserves millisecond persisted expiry timestamps and refresh-window semantics", async () => {
  const now = 1792360000000;
  const row = {
    provider: "indrive",
    access_token: "access-token",
    refresh_token: "refresh-token",
    access_expires_at: now + 120000,
    last_rotated_at: now - 120000,
    rotation_version: 2,
    status: "READY",
  };
  const database = { query: async () => ({ rows: [row] }) };
  const manager = createSessionManager({ config: { mode: "real", enabled: true, refreshBufferSeconds: 300 }, database, now: () => now });
  const session = await manager.load();
  assert.equal(session.accessExpiresAt, now + 120000);
  assert.equal(manager.hasUsableAccess(session), false);
});
