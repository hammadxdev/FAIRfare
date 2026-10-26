const test = require("node:test");
const assert = require("node:assert/strict");
const { createIndriveAdapter, buildPricingPayload } = require("../providers/indrive/indrive.adapter");
const { createIndriveClient } = require("../providers/indrive/indrive.client");
const { normalizeAutocompleteResponse, buildAutocompleteRequest } = require("../providers/indrive/indrive.autocomplete");

function token(exp = Math.floor(Date.now() / 1000) + 3600) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part({ exp })}.signature`;
}

function config(overrides = {}) {
  return {
    enabled: true, mode: "real", accessToken: token(), pricingUrl: "https://pricing.example/v6/price",
    autocompleteUrl: "https://geo.example/geo2dev/api/autocomplete", cityId: 5388,
    autocompleteRoutePointType: "to", timeoutMs: 1000, language: "en_US", osType: "android", appFlavor: "indriver", appVersion: "android 5.157.0",
    ...overrides,
  };
}

function persistedSession(access = token()) {
  return {
    ensureValidSession: async () => access,
    markAuthRequired: async () => {},
    markAccessDenied: async () => {},
    getStatus: async () => "READY",
    getTokenDiagnostics: async () => ({ tokenPresent: true, refreshTokenPresent: true, accessExpiresAt: null, expiryKnown: false, source: "postgresql", rotationVersion: 1, status: "READY" }),
  };
}

const route = { pickup: { latitude: 31.4742, longitude: 74.4163 }, destination: { latitude: 31.464, longitude: 74.4426 }, distanceMeters: 4200, durationSeconds: 900 };

test("pricing v6 payload uses dynamic route metrics and configured categories", () => {
  assert.deepEqual(buildPricingPayload({ ...route, vehicleType: "car" }), {
    order_type_ids: [2, 33, 31, 29, 11],
    route: [{ latitude: 31.4742, longitude: 74.4163 }, { latitude: 31.464, longitude: 74.4426 }],
    geo: { distance_meters: 4200, duration_seconds: 900, toll_cost: 0, provider: "", points: [] },
  });
});

test("adapter maps the captured pricing response shape, currency, categories and TTL", async () => {
  let payload;
  const createdAt = new Date(Date.now() - 1_000).toISOString();
  const adapter = createIndriveAdapter({ config: config(), session: persistedSession(), client: {
    getPricing: async (accessToken, body) => { assert.ok(accessToken); payload = body; return { status: 200, body: { currency: { code: "PKR", multiplier: 100 }, created_at: createdAt, ttl: 300, calculations: [
      { order_type_id: 2, price: 16300, autofill_price: 16300, price_min: 14000, price_max: 18500 },
      { order_type_id: 33, price: 45000, autofill_price: 45000, price_min: 45000, price_max: 45000 },
      { order_type_id: 31, price: 30000, autofill_price: 30000 },
      { order_type_id: 29, price: 62000, autofill_price: 62000 },
      { order_type_id: 11, price: 78000, autofill_price: 78000 },
    ] } };
  } } });
  const quotes = await adapter.getQuotes({ route: { ...route }, vehicleType: "car" });
  assert.equal(payload.geo.distance_meters, 4200);
  assert.deepEqual(quotes.map((quote) => [quote.categoryId, quote.fare]), [["2", 163], ["33", 450], ["31", 300], ["29", 620], ["11", 780]]);
  assert.equal(quotes[0].fareMin, 140); assert.equal(quotes[0].fareMax, 185); assert.equal(quotes[0].metadata.providerTtlSeconds, 300); assert.equal(quotes[0].source, "live");
  assert.equal(quotes[0].metadata.providerCreatedAt, createdAt);
  assert.equal(quotes[0].metadata.providerFreshness, "current");
  assert.ok(quotes[0].metadata.backendProcessedAt);
  assert.notEqual(quotes[0].metadata.backendProcessedAt, quotes[0].metadata.providerCreatedAt);
});

test("autocomplete request is URL/form encoded and response.items is normalized", () => {
  const request = buildAutocompleteRequest({ text: "Lahore & Mall", cityId: 5388, orderTypeId: 2, latitude: 31.47, longitude: 74.41 }, config());
  assert.match(request.url, /locale=en_US/); assert.match(request.url, /route_point_type=to/); assert.match(request.body, /text=Lahore\+%26\+Mall/);
  const normalized = normalizeAutocompleteResponse({ response: { items: [{ suggest_id: "s1", address: "Mall Road", description: "Lahore", latitude: "31.47", longitude: "74.41", address_type: "street" }] } });
  assert.deepEqual(normalized.suggestions[0], { suggestId: "s1", placeId: null, address: "Mall Road", description: "Lahore", latitude: 31.47, longitude: 74.41, locality: null, postalCode: null, addressType: "street", raw: undefined });
});

test("missing and expired JWTs fail before provider transport", async () => {
  let calls = 0;
  const client = { getPricing: async () => { calls += 1; }, getAutocomplete: async () => { calls += 1; } };
  const missingSession = { ensureValidSession: async () => { const error = new Error("missing"); error.code = "PROVIDER_AUTH_REQUIRED"; throw error; }, markAuthRequired: async () => {}, markAccessDenied: async () => {} };
  await assert.rejects(createIndriveAdapter({ config: config({ accessToken: "" }), session: missingSession, client }).getQuotes({ route, vehicleType: "car" }), (error) => error.code === "PROVIDER_AUTH_REQUIRED");
  await assert.rejects(createIndriveAdapter({ config: config({ accessToken: token(Math.floor(Date.now() / 1000) - 1) }), session: missingSession, client }).getAutocomplete({ text: "mall", latitude: 31, longitude: 74 }), (error) => error.code === "PROVIDER_AUTH_REQUIRED");
  assert.equal(calls, 0);
});

test("provider auth, bad response, malformed JSON and timeout are sanitized", async () => {
  for (const status of [400, 401, 403]) {
    const adapter = createIndriveAdapter({ config: config(), session: persistedSession(), client: { getPricing: async () => ({ status, body: {} }) } });
    await assert.rejects(adapter.getQuotes({ route, vehicleType: "car" }), (error) => status === 401 ? error.code === "PROVIDER_AUTH_REQUIRED" : status === 403 ? error.code === "PROVIDER_ACCESS_DENIED" : error.code === "PROVIDER_UNAVAILABLE");
  }
  const client = createIndriveClient({ config: config(), fetchImpl: async () => ({ status: 200, text: async () => "not-json" }) });
  await assert.rejects(client.getPricing(token(), buildPricingPayload({ ...route, vehicleType: "car" })), (error) => error.code === "PROVIDER_BAD_RESPONSE");
  const timeoutClient = createIndriveClient({ config: config({ timeoutMs: 1 }), fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  await assert.rejects(timeoutClient.getPricing(token(), buildPricingPayload({ ...route, vehicleType: "car" })), (error) => error.code === "PROVIDER_TIMEOUT");
});
