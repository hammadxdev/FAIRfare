const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createBykeaProvider } = require("../providers/bykea.provider");
const { getConfig } = require("../providers/bykea/bykea.constants");
const { buildFareRequest, buildFareQuery, buildFareUrl, createBykeaHttpTransport, mandatoryHeaders, summarizeBykeaRequest } = require("../providers/bykea/bykea.client");
const { normalizeBykeaFareResponse, summarizeBykeaResponse } = require("../providers/bykea/bykea.mapper");
const { createBykeaRequestContract } = require("../providers/bykea/bykea.request-contract");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/bykeaFareEstimates.responses.json"), "utf8"));
const route = {
  pickup: { latitude: 31.4742, longitude: 74.4163 },
  destination: { latitude: 31.5204, longitude: 74.3587 },
};

function config(overrides = {}) {
  return getConfig({
    BYKEA_MODE: "authorized_live",
    BYKEA_AUTHORIZED_LIVE: "true",
    BYKEA_API_BASE_URL: "https://partner.example.invalid",
    BYKEA_FARE_ENDPOINT: "/talos/api/v3/users/estimation/fare",
    BYKEA_DEVICE_ID: "test-device-id",
    BYKEA_APP_USER_ID: "test-user-id",
    BYKEA_APP_USER_TOKEN: "unit-test-token",
    BYKEA_APP_VERSION: "test-version",
    BYKEA_APP_LANGUAGE: "en",
    BYKEA_APP_USER_TYPE: "passenger",
    BYKEA_HEADER_LATITUDE: "31.5000",
    BYKEA_HEADER_LONGITUDE: "74.3500",
    BYKEA_HEADER_ALTITUDE: "220",
    BYKEA_USER_AGENT: "Bykea-Test/1.0",
    BYKEA_SERVICE_CODES: "23,70,44,45,48",
    BYKEA_REQUEST_TYPE: "APP",
    BYKEA_VEHICLE_TYPE: "all",
    BYKEA_CURRENCY: "PKR",
    BYKEA_CURRENCY_MULTIPLIER: "1",
    BYKEA_REQUEST_TIMEOUT_MS: "1000",
    ...overrides,
  });
}

function contract(parseResponse = (body) => body) {
  return {
    path: "/documented-fare-path",
    buildHeaders({ appUserToken }) { return { "X-Test-Authorized-Token": appUserToken }; },
    parseResponse,
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test("builds dynamic s/e coordinates for every trip", () => {
  assert.deepEqual(buildFareRequest(route), {
    s_lat: 31.4742,
    s_lng: 74.4163,
    e_lat: 31.5204,
    e_lng: 74.3587,
  });
  assert.notDeepEqual(buildFareRequest({ pickup: { lat: 24.86, lng: 67.01 }, destination: { lat: 33.69, lng: 73.04 } }), buildFareRequest(route));
  assert.throws(() => buildFareRequest({ pickup: { lat: 91, lng: 67 }, destination: route.destination }), /valid range/);
});

test("missing Bykea configuration fails closed without exposing credentials", () => {
  const runtime = getConfig({ BYKEA_MODE: "authorized_live", BYKEA_AUTHORIZED_LIVE: "true", BYKEA_API_BASE_URL: "https://partner.example.invalid" });
  assert.equal(runtime.mode, "unavailable");
  assert.match(runtime.configError, /mandatory header settings|APP_USER_TOKEN/);
  assert.equal(runtime.appUserToken, "");
});

test("disabled live integration does not call transport", async () => {
  let calls = 0;
  const provider = createBykeaProvider({ config: getConfig({ BYKEA_MODE: "authorized_live", BYKEA_AUTHORIZED_LIVE: "false" }), mode: "unavailable", transport: { async getFareEstimates() { calls += 1; } } });
  const result = await provider.getFareEstimates({ ...route, rideType: "bike" });
  assert.equal(result.status, "unavailable");
  assert.equal(result.error.code, "LIVE_INTEGRATION_NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("normal provider construction uses the same authorized request contract as the diagnostic", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return response(fixtures.sanitizedData);
  };
  try {
    const runtime = config();
    const provider = createBykeaProvider({ config: runtime, mode: "authorized-live" });
    assert.equal(provider.liveTransportEnabled, true);
    const result = await provider.getFareEstimates({ ...route });
    assert.equal(result.status, "available");
    assert.equal(result.estimates.length, 5);
    assert.equal(new URL(request.url).searchParams.get("v_type"), "all");
    assert.equal(request.options.headers["X-App-User-Type"], "passenger");
    assert.equal(createBykeaRequestContract(runtime).method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes multiple vehicle categories, fare range, currency, and ETA", async () => {
  const transport = { async getFareEstimates() { return fixtures.availableMultiple; } };
  const provider = createBykeaProvider({ config: config(), mode: "authorized-live", transport });
  const result = await provider.getFareEstimates({ ...route });
  assert.equal(result.status, "available");
  assert.deepEqual(result.estimates.map((item) => item.categoryId), ["motorbike", "rickshaw"]);
  assert.equal(result.estimates[0].fare, 220);
  assert.equal(result.estimates[0].fareMin, 200);
  assert.equal(result.estimates[0].fareMax, 240);
  assert.equal(result.estimates[0].pickupEtaSeconds, 360);
});

test("builds the documented GET query from dynamic coordinates and static service configuration", () => {
  const runtime = config();
  assert.deepEqual(buildFareQuery({ pickup: route.pickup, destination: route.destination, config: runtime }), {
    s_lat: 31.4742,
    s_lng: 74.4163,
    e_lat: 31.5204,
    e_lng: 74.3587,
    device_id: "test-device-id",
    type: "APP",
    v_type: "all",
    service_codes: "[23,70,44,45,48]",
  });
  const url = buildFareUrl({ pickup: route.pickup, destination: route.destination, config: runtime });
  assert.equal(url.pathname, "/talos/api/v3/users/estimation/fare");
  assert.equal(url.searchParams.get("s_lat"), "31.4742");
  assert.equal(url.searchParams.get("e_lng"), "74.3587");
  assert.equal(url.searchParams.get("service_codes"), "[23,70,44,45,48]");
  assert.deepEqual(JSON.parse(url.searchParams.get("service_codes")), [23, 70, 44, 45, 48]);
});

test("accepts an explicitly empty vehicle type and preserves v_type=", () => {
  const runtime = config({ BYKEA_VEHICLE_TYPE: "" });
  assert.equal(runtime.vehicleType, "");
  assert.equal(runtime.endpointContractConfigured, true);
  const query = buildFareQuery({ pickup: route.pickup, destination: route.destination, config: runtime });
  assert.equal(query.v_type, "");
  const url = buildFareUrl({ pickup: route.pickup, destination: route.destination, config: runtime });
  assert.equal(url.searchParams.has("v_type"), true);
  assert.equal(url.searchParams.get("v_type"), "");
});

test("continues to accept a non-empty vehicle type and fails closed when it is undefined", () => {
  const configured = config({ BYKEA_VEHICLE_TYPE: "bike" });
  assert.equal(buildFareQuery({ pickup: route.pickup, destination: route.destination, config: configured }).v_type, "bike");
  const missing = config();
  delete missing.vehicleType;
  missing.endpointContractConfigured = false;
  assert.throws(() => buildFareQuery({ pickup: route.pickup, destination: route.destination, config: missing }), /vehicle type/);
  assert.equal(createBykeaHttpTransport({ config: missing, requestContract: contract(), requestImpl: async () => { throw new Error("must not send"); } }), null);
});

test("constructs only test-authorized headers and never exposes secrets in the response", async () => {
  let request;
  const transport = createBykeaHttpTransport({
    config: config(),
    requestContract: {
      ...contract((body) => body),
      buildHeaders({ appUserToken, deviceId, appUserId }) {
        return { Authorization: `Bearer ${appUserToken}`, "X-Test-Device": deviceId, "X-Test-User": appUserId };
      },
    },
    requestImpl: async (url, options) => { request = { url, options }; return response(fixtures.sanitizedData); },
  });
  const result = await transport.getFareEstimates({ ...route });
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer unit-test-token");
  assert.equal(new URL(request.url).searchParams.get("device_id"), "test-device-id");
  assert.doesNotMatch(JSON.stringify(result), /unit-test-token|test-device-id/);
});

test("includes all six configured mandatory headers and keeps device location separate from trip coordinates", async () => {
  let request;
  const transport = createBykeaHttpTransport({
    config: config(),
    requestContract: {
      ...contract(),
      buildHeaders() { return { Authorization: "test-auth", "X-Existing-Required": "preserved" }; },
    },
    requestImpl: async (url, options) => { request = { url, options }; return response(fixtures.sanitizedData); },
  });
  await transport.getFareEstimates({ pickup: route.pickup, destination: route.destination });
  assert.deepEqual(
    Object.fromEntries(Object.entries(request.options.headers).filter(([name]) => name.startsWith("X-") || name === "Authorization")),
    {
      Authorization: "test-auth",
      "X-Existing-Required": "preserved",
      "X-App-User-Type": "passenger",
      "X-Loc-Latitude": "31.5000",
      "X-Loc-Longitude": "74.3500",
      "X-Loc-Altitude": "220",
      "X-App-Language": "en",
      "X-User-Agent": "Bykea-Test/1.0",
    },
  );
  const query = new URL(request.url).searchParams;
  assert.equal(query.get("s_lat"), "31.4742");
  assert.equal(query.get("s_lng"), "74.4163");
  assert.notEqual(query.get("s_lat"), request.options.headers["X-Loc-Latitude"]);
});

test("summarizes the request contract without exposing sensitive values", () => {
  const runtime = config({ BYKEA_VEHICLE_TYPE: "" });
  const url = buildFareUrl({ pickup: route.pickup, destination: route.destination, config: runtime });
  const summary = summarizeBykeaRequest(url, { method: "GET", headers: {
    "X-App-User-Id": "test-user-id",
    "X-App-User-Token": "unit-test-token",
    "X-App-User-Type": "passenger",
    "X-App-Language": "en",
    "X-App-Version": "test-version",
    "X-Loc-Latitude": "31.5000",
    "X-Loc-Longitude": "74.3500",
    "X-Loc-Altitude": "220",
    "X-User-Agent": "Bykea-Test/1.0",
    "User-Agent": "okhttp/4.12.0",
  } });
  assert.equal(summary.method, "GET");
  assert.equal(summary.endpointPath, "/talos/api/v3/users/estimation/fare");
  assert.equal(summary.query.vTypePresent, true);
  assert.equal(summary.query.vTypeEmpty, true);
  assert.equal(summary.query.serviceCodesIsJsonArray, true);
  assert.deepEqual(summary.query.serviceCodesItemTypes, ["number", "number", "number", "number", "number"]);
  assert.equal(summary.headersPresent["X-User-Agent"], true);
  assert.equal(summary.headersPresent["User-Agent"], true);
  assert.equal(summary.headersPresent["X-Amzn-Trace-Id"], false);
  assert.equal(summary.headersPresent["Accept-Encoding"], false);
  assert.equal(summary.authenticationFieldsPopulated, true);
  assert.doesNotMatch(JSON.stringify(summary), /test-user-id|unit-test-token|31\.5000|74\.3500/);
});

test("rejects missing or invalid mandatory device-location configuration before sending", async () => {
  for (const [field, value, pattern] of [
    ["headerLatitude", "", /latitude/],
    ["headerLongitude", "181", /longitude/],
    ["headerAltitude", "not-a-number", /altitude/i],
    ["userAgent", "", /USER_AGENT/],
  ]) {
    const runtime = { ...config(), [field]: value, mandatoryHeadersConfigured: false, endpointContractConfigured: false };
    assert.throws(() => mandatoryHeaders(runtime), pattern);
    assert.equal(createBykeaHttpTransport({ config: runtime, requestContract: contract(), requestImpl: async () => { throw new Error("must not send"); } }), null);
  }
});

test("removes case-insensitive duplicate mandatory headers while preserving authentication headers", async () => {
  let request;
  const transport = createBykeaHttpTransport({
    config: config(),
    requestContract: {
      ...contract(),
      buildHeaders() { return { authorization: "test-auth", "x-app-language": "wrong", "X-Custom": "kept" }; },
    },
    requestImpl: async (_url, options) => { request = options; return response(fixtures.sanitizedData); },
  });
  await transport.getFareEstimates({ ...route });
  const names = Object.keys(request.headers).map((name) => name.toLowerCase());
  assert.equal(names.filter((name) => name === "x-app-language").length, 1);
  assert.equal(request.headers["X-App-Language"], "en");
  assert.equal(request.headers.authorization, "test-auth");
  assert.equal(request.headers["X-Custom"], "kept");
});

test("normalizes Bykea mstr estimates by service code without inventing category names", () => {
  const result = normalizeBykeaFareResponse(fixtures.sanitizedData);
  assert.equal(result.status, "available");
  assert.deepEqual(result.estimates.map((item) => [item.service_code, item.fare]), [[23, 196], [70, 336], [44, 742], [45, 643], [48, 1125]]);
  assert.deepEqual(result.estimates.map((item) => item.displayFare), ["Est: 196 PKR", "Est: 336 PKR", "Est: 742 PKR", "Est: 643 PKR", "Est: 1125 PKR"]);
  assert.deepEqual(result.estimates.map((item) => item.currency_code), ["PKR", "PKR", "PKR", "PKR", "PKR"]);
  assert.deepEqual(result.estimates.map((item) => item.categoryName), [null, null, null, null, null]);
  assert.equal(result.estimates[0].fare, result.estimates.slice().sort((a, b) => a.fare - b.fare)[0].fare);
});

test("skips unsuccessful or malformed Bykea mstr entries independently", () => {
  const result = normalizeBykeaFareResponse({ data: [
    { success: true, service_code: 23, currency_code: "PKR", mstr: "Est: 196 PKR", data: 9999 },
    { success: false, service_code: 70, currency_code: "PKR", mstr: "Est: 336 PKR" },
    { success: true, service_code: 44, currency_code: "PKR", mstr: "not a fare", data: 742 },
    { success: true, service_code: 45, currency_code: "PKR" },
  ] });
  assert.deepEqual(result.estimates.map((item) => item.service_code), [23]);
});

test("summarizes response shape without exposing fare text or sensitive values", () => {
  assert.deepEqual(summarizeBykeaResponse({ success: true, code: 200, data: fixtures.sanitizedData.data }), {
    stage: "data_array_inspected",
    topLevelKeys: ["code", "data", "success"],
    success: true,
    code: 200,
    dataIsArray: true,
    dataEntryCount: 5,
    entriesWithServiceCode: 5,
    entriesWithMstr: 5,
    validEstimateEntries: 5,
    applicationError: null,
  });
  assert.deepEqual(summarizeBykeaResponse({ success: true, code: 200, estimates: fixtures.sanitizedData.data }), {
    stage: "missing_data_array",
    topLevelKeys: ["code", "estimates", "success"],
    success: true,
    code: 200,
    dataIsArray: false,
    dataEntryCount: 0,
    entriesWithServiceCode: 0,
    entriesWithMstr: 0,
    validEstimateEntries: 0,
    applicationError: null,
  });
});

test("classifies an HTTP 200 application rejection before fare normalization", async () => {
  const sensitive = "token=unit-test-token device=test-device-id user=test-user-id lat=31.4742 lng=74.4163";
  const raw = { success: false, code: 400, error: sensitive, message: sensitive };
  const provider = createBykeaProvider({ config: config(), mode: "authorized-live", transport: { async getFareEstimates() { return raw; } } });
  const result = await provider.getFareEstimates({ ...route });
  assert.equal(result.status, "provider_error");
  assert.equal(result.error.code, "PROVIDER_API_REJECTED");
  assert.doesNotMatch(JSON.stringify(result), /unit-test-token|test-device-id|31\.4742|74\.4163/);
  assert.equal(normalizeBykeaFareResponse(raw).error.diagnostics.messageLength, sensitive.length);
  assert.equal(summarizeBykeaResponse(raw).applicationError.rawMessageIncluded, false);
});

test("maps explicit no-driver and busy provider states without guessing", async () => {
  for (const fixture of [fixtures.noDrivers, fixtures.busy]) {
    const provider = createBykeaProvider({ config: config(), mode: "authorized-live", transport: { async getFareEstimates() { return fixture; } } });
    const result = await provider.getFareEstimates({ ...route });
    assert.equal(result.status, fixture.status);
    assert.deepEqual(result.estimates, []);
  }
});

test("maps authentication rejection to AUTH_REQUIRED", async () => {
  const transport = createBykeaHttpTransport({ config: config(), requestContract: contract(), requestImpl: async () => response({}, 401) });
  const provider = createBykeaProvider({ config: config(), mode: "authorized-live", transport });
  const result = await provider.getFareEstimates({ ...route });
  assert.equal(result.status, "auth_required");
  assert.equal(result.error.code, "PROVIDER_AUTH_REQUIRED");
});

test("maps access denial and timeout without retrying", async () => {
  let calls = 0;
  const denied = createBykeaHttpTransport({ config: config(), requestContract: contract(), requestImpl: async () => { calls += 1; return response({}, 403); } });
  const provider = createBykeaProvider({ config: config(), mode: "authorized-live", transport: denied });
  const deniedResult = await provider.getFareEstimates({ ...route });
  assert.equal(deniedResult.status, "access_denied");
  assert.equal(calls, 1);

  const timeout = createBykeaHttpTransport({
    config: config(),
    requestContract: contract(),
    requestImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  const timeoutResult = await createBykeaProvider({ config: config(), mode: "authorized-live", transport: timeout }).getFareEstimates({ ...route });
  assert.equal(timeoutResult.status, "timeout");
});

test("maps rate limiting and network failure without mislabeling availability", async () => {
  const limited = createBykeaHttpTransport({ config: config(), requestContract: contract(), requestImpl: async () => response({}, 429) });
  const limitedResult = await createBykeaProvider({ config: config(), mode: "authorized-live", transport: limited }).getFareEstimates({ ...route });
  assert.equal(limitedResult.status, "rate_limited");
  assert.equal(limitedResult.error.code, "PROVIDER_RATE_LIMITED");

  const network = createBykeaHttpTransport({ config: config(), requestContract: contract(), requestImpl: async () => { throw new Error("network down"); } });
  const networkResult = await createBykeaProvider({ config: config(), mode: "authorized-live", transport: network }).getFareEstimates({ ...route });
  assert.equal(networkResult.status, "unavailable");
  assert.equal(networkResult.error.code, "PROVIDER_UNAVAILABLE");
});

test("rejects malformed JSON as a provider response error", async () => {
  const transport = createBykeaHttpTransport({ config: config(), requestContract: contract(), requestImpl: async () => ({ ok: true, status: 200, async json() { throw new Error("invalid json"); } }) });
  const result = await createBykeaProvider({ config: config(), mode: "authorized-live", transport }).getFareEstimates({ ...route });
  assert.equal(result.status, "provider_error");
  assert.equal(result.error.code, "PROVIDER_BAD_RESPONSE");
});

test("rejects malformed provider response without creating a quote", async () => {
  const provider = createBykeaProvider({ config: config(), mode: "authorized-live", transport: { async getFareEstimates() { return fixtures.malformed; } } });
  const result = await provider.getFareEstimates({ ...route });
  assert.equal(result.status, "provider_error");
  assert.deepEqual(result.estimates, []);
});

test("provider failure remains isolated from a successful provider result", async () => {
  const failing = createBykeaProvider({ config: config(), mode: "authorized-live", transport: { async getFareEstimates() { throw Object.assign(new Error("denied"), { code: "PROVIDER_ACCESS_DENIED" }); } } });
  const succeeding = createBykeaProvider({ config: config(), mode: "authorized-live", transport: { async getFareEstimates() { return fixtures.availableMultiple; } } });
  const settled = await Promise.allSettled([failing.getFareEstimates({ ...route }), succeeding.getFareEstimates({ ...route })]);
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[0].value.status, "access_denied");
  assert.equal(settled[1].value.status, "available");
});

test("transport diagnostics never include the API key or request body", async () => {
  const logs = [];
  const transport = createBykeaHttpTransport({ config: config(), requestContract: contract(), logger: (event) => logs.push(event), requestImpl: async () => response(fixtures.availableMultiple) });
  await transport.getFareEstimates({ ...route });
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /unit-test-key|s_lat|s_lng|e_lat|e_lng/);
  assert.match(serialized, /fare_estimate/);
});
