const test = require("node:test");
const assert = require("node:assert/strict");
const { getConfig, getTestConfig } = require("../providers/yango/yango.constants");
const { buildRouteStatsPayload } = require("../providers/yango/yango.payload");
const { normalizeRouteStatsResponse, numericPrice } = require("../providers/yango/yango.mapper");
const { createYangoRouteStatsClient, inspectAccessToken, jwtExpired, inspectErrorBody } = require("../providers/yango/yango.client");
const { createYangoProvider } = require("../providers/yango.provider");
const documentedResponse = require("./fixtures/yangoRouteStats.response.json");
const finalPriceResponse = require("./fixtures/yangoRouteStats.finalPrice.sanitized.json");

const trip = {
  pickup: { lat: 31.4742, lng: 74.4163 },
  destination: { latitude: 31.5204, longitude: 74.3587 },
};

function token(exp = Math.floor(Date.now() / 1000) + 600) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.signature`;
}

test("RouteStats payload preserves dynamic coordinates in longitude/latitude order", () => {
  const payload = buildRouteStatsPayload({ ...trip, zoneName: "lahore", selectedClass: "econom", paymentType: "cash" });
  assert.deepEqual(payload, {
    zone_name: "lahore",
    selected_class: "econom",
    route: [[74.4163, 31.4742], [74.3587, 31.5204]],
    tariff_requirements: [
      { class: "econom" },
      { class: "business" },
      { class: "comfortplus" },
      { class: "moto" },
    ],
    payment: { type: "cash" },
    supported_verticals: ["taxi"],
    state: {
      fields: [
        { type: "a", entrance: "", position: [74.4163, 31.4742] },
        { type: "b", entrance: "", position: [74.3587, 31.5204] },
      ],
    },
  });
  assert.equal("id" in payload, false);
  assert.equal("location" in payload.state, false);
  assert.equal("precise_location_available" in payload.state, false);
  assert.equal("supported" in payload, false);
  assert.equal("supported_features" in payload, false);
});

test("RouteStats payload adds only supplied pickup and destination labels", () => {
  const payload = buildRouteStatsPayload({
    pickup: { name: "Pickup label", lat: trip.pickup.lat, lng: trip.pickup.lng },
    destination: { name: "Destination label", ...trip.destination },
    zoneName: "lahore",
    selectedClass: "econom",
  });
  assert.deepEqual(payload.state.fields, [
    { type: "a", title: "Pickup label", entrance: "", position: [74.4163, 31.4742] },
    { type: "b", title: "Destination label", entrance: "", position: [74.3587, 31.5204] },
  ]);
  assert.equal("log" in payload.state.fields[0], false);
  assert.equal("location" in payload.state, false);
  assert.equal("precise_location_available" in payload.state, false);
});

test("RouteStats payload preserves explicitly supplied multiclass and supported values", () => {
  const multiclassOptions = { class: ["econom"], verticals: ["taxi"], selected: true };
  const supported = [{ type: "requirements_v2" }];
  const payload = buildRouteStatsPayload({
    ...trip,
    zoneName: "lahore",
    selectedClass: "econom",
    multiclassOptions,
    supported,
    tariffRequirements: [{ class: "econom" }],
    supportedVerticalTypes: ["custom_group"],
    supportedVerticals: ["transport"],
    state: { fields: [] },
    summaryContext: { custom: true },
    supportedFeatures: [{ type: "custom_feature" }],
    sizeHint: 99,
    skipEstimatedWaiting: true,
    useTollRoads: true,
  });
  assert.deepEqual(payload.multiclass_options, multiclassOptions);
  assert.deepEqual(payload.supported, supported);
  assert.deepEqual(payload.tariff_requirements, [{ class: "econom" }]);
  assert.deepEqual(payload.supported_vertical_types, ["custom_group"]);
  assert.deepEqual(payload.supported_verticals, ["transport"]);
  assert.deepEqual(payload.state, { fields: [] });
  assert.deepEqual(payload.summary_context, { custom: true });
  assert.deepEqual(payload.supported_features, [{ type: "custom_feature" }]);
  assert.equal(payload.size_hint, 99);
  assert.equal(payload.skip_estimated_waiting, true);
  assert.equal(payload.use_toll_roads, true);
});

test("RouteStats payload rejects invalid, identical, and unsupported-zone inputs", () => {
  assert.throws(() => buildRouteStatsPayload({ pickup: { lat: 91, lng: 74 }, destination: trip.destination, zoneName: "lahore", selectedClass: "econom" }), { code: "INVALID_COORDINATES" });
  assert.throws(() => buildRouteStatsPayload({ pickup: trip.pickup, destination: trip.pickup, zoneName: "lahore", selectedClass: "econom" }), { code: "IDENTICAL_COORDINATES" });
  assert.throws(() => buildRouteStatsPayload({ ...trip, selectedClass: "econom" }), { code: "ZONE_REQUIRED" });
  assert.throws(() => buildRouteStatsPayload({ ...trip, zoneName: "karachi", supportedZones: ["lahore"], selectedClass: "econom" }), { code: "UNSUPPORTED_ZONE" });
});

test("Yango configuration fails closed and does not expose credentials in diagnostics", () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "secret", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  assert.equal(config.mode, "authorized-live");
  assert.equal(config.authorizationConfigured, true);
  assert.equal(JSON.stringify({ ...config, accessToken: undefined }), JSON.stringify({ ...config, accessToken: undefined }));
  const disabled = getConfig({ YANGO_ENABLED: "false", YANGO_AUTHORIZED_ACCESS_TOKEN: "secret", YANGO_AUTHORIZED_CLIENT_ID: "client" });
  assert.equal(disabled.mode, "unavailable");
});

test("RouteStats mapper extracts numeric tariffs, qualifiers, and skips hidden offers", () => {
  const mapped = normalizeRouteStatsResponse({ tariffs: [
    { id: "econom", name: "Econom", price: { amount: 345, currency: "PKR", qualifier: "from" } },
    { id: "hidden", name: "Hidden", price: { amount: 999, currency: "PKR" }, hidden: true },
    { id: "template", name: "Template", price: "from $SIGN$345 $CURRENCY$" },
  ] });
  assert.equal(mapped.status, "available");
  assert.deepEqual(mapped.estimates[0], { categoryId: "econom", categoryName: "Econom", providerServiceName: "Econom", serviceTier: "unknown", features: [], vehicleCategory: "unknown", fare: 345, currency: "PKR", priceQualifier: "from", priceText: null, isAvailable: true, hidden: false });
  assert.equal(mapped.estimates.length, 1);
  assert.equal(numericPrice("from $SIGN$345 $CURRENCY$"), null);
});

test("starting-price-only service_levels fail closed for exact route quotes", () => {
  const mapped = normalizeRouteStatsResponse({
    currency_rules: { code: "PKR", text: "Rs.", template: "{price}" },
    service_levels: [
      { class: "moto", name: "Bike", price: "Rs. 89", cars: ["Honda CD 70"], is_hidden: false, paid_options: { value: 1.31, alert_properties: { text: "High demand" } } },
      { class: "econom", name: "Economy", price: "from Rs. 289", cars: [{ name: "Toyota Corolla" }], is_hidden: false },
      { class: "comfortplus", name: "Comfort", price: "Rs. 230", is_hidden: true },
      { class: "business", name: "Economy A/C", price: "Rs. 257", available: false },
      { class: "mystery", name: "Unknown class", price: "Rs. 310", is_hidden: false },
    ],
  });

  assert.equal(mapped.status, "provider_error");
  assert.deepEqual(mapped.estimates, []);
  assert.deepEqual(mapped.passengerEstimates.map((item) => item.categoryId), ["moto", "econom", "business", "mystery"]);
  assert.deepEqual(mapped.passengerEstimates.map((item) => item.fare), [null, null, null, null]);
  assert.deepEqual(mapped.passengerEstimates.map((item) => item.startingFare), [null, null, null, null]);
});

test("documented service_levels reject display-only price templates as exact quotes", () => {
  const template = normalizeRouteStatsResponse({
    currency_rules: { code: "PKR" },
    service_levels: [
      { class: "template", name: "Template", price: "$SIGN$345 $CURRENCY$" },
      { name: "Missing class", price: "Rs. 100" },
      { class: "invalid", name: "Invalid", price: "Rs. 10-20" },
    ],
  });
  assert.equal(template.status, "provider_error");
  assert.deepEqual(template.estimates, []);
  assert.equal(template.passengerEstimates[0].displayFare, 345);
  assert.equal(template.passengerEstimates[0].fare, null);

  const missingCurrency = normalizeRouteStatsResponse({
    service_levels: [{ class: "econom", name: "Economy", price: "Rs. 289" }],
  });
  assert.equal(missingCurrency.status, "provider_error");
  assert.equal(missingCurrency.currency, null);
});

test("documented service_levels handle empty and malformed structures conservatively", () => {
  const empty = normalizeRouteStatsResponse({ currency_rules: { code: "PKR" }, service_levels: [] });
  assert.equal(empty.status, "provider_error");
  assert.deepEqual(empty.estimates, []);

  const malformed = normalizeRouteStatsResponse({ currency_rules: { code: "PKR" }, service_levels: "not-an-array" });
  assert.equal(malformed.status, "provider_error");
  assert.deepEqual(malformed.estimates, []);
});

test("older RouteStats fixture preserves starting prices but fails closed for exact quotes", () => {
  const mapped = normalizeRouteStatsResponse(documentedResponse);
  assert.equal(mapped.status, "provider_error");
  assert.equal(mapped.currency, "PKR");
  assert.equal(mapped.passengerEstimates.find((item) => item.categoryId === "econom").startingFare, null);
  assert.equal(mapped.passengerEstimates.find((item) => item.categoryId === "econom").fare, null);
  assert.equal(mapped.deliveryEstimates.length, 1);
  assert.equal(mapped.deliveryEstimates[0].categoryId, "courier");
  assert.equal(mapped.passengerEstimates.some((item) => item.fare === 2178), false, "hidden tariff is excluded");
});

test("new final-price fixture preserves exact, display, starting, ETA, route, currency, and availability fields", () => {
  const mapped = normalizeRouteStatsResponse(finalPriceResponse);
  assert.equal(mapped.status, "available");
  assert.equal(mapped.currency, "PKR");
  assert.deepEqual(mapped.routeMetadata, { distance: "4.8 km", time: "16 min" });

  const byClass = Object.fromEntries(mapped.estimates.map((item) => [item.categoryId, item]));
  for (const [categoryId, exactFare, displayFare] of [["econom", 439, 430], ["business", 492, 490], ["comfortplus", 559, 550], ["moto", 161, 160], ["tuktuk", 324, 320]]) {
    assert.equal(byClass[categoryId].fare, exactFare);
    assert.equal(byClass[categoryId].exactFare, exactFare);
    assert.equal(byClass[categoryId].displayFare, displayFare);
    assert.equal(byClass[categoryId].isAvailable, true);
  }
  assert.equal(byClass.econom.startingFare, 209);
  assert.equal(byClass.econom.pickupEtaSeconds, 420);
  assert.equal(byClass.econom.fareType, "FIXED_ROUTE_QUOTE");
  assert.equal(byClass.econom.surgeMultiplier, 1.1);

  assert.equal(byClass.test_tariff_project_category.fare, null, "unavailable fare is not bookable");
  assert.equal(byClass.test_tariff_project_category.exactFare, 273, "provider exact fare is retained");
  assert.equal(byClass.test_tariff_project_category.displayFare, 270);
  assert.equal(byClass.test_tariff_project_category.isAvailable, false);
  assert.equal(byClass.test_tariff_project_category.availabilityReason.code, "no_free_cars_nearby");
  assert.equal(mapped.estimates.some((item) => item.categoryId === "comfort"), false);
  assert.equal(mapped.estimates.some((item) => item.categoryId === "courier"), false);
  assert.equal(mapped.estimates.some((item) => item.categoryId === "cargo"), false);
  assert.equal(mapped.deliveryEstimates.some((item) => item.categoryId === "courier"), true);
});

test("final-price conflicts, malformed prices, and wrong currency fail closed", () => {
  const conflict = normalizeRouteStatsResponse({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", price: "Rs. 430", max_price_as_decimal: "439", prices: { raw: { final_price: "440" } }, details_tariff: [{ type: "price", value: "from Rs. 209" }] }] });
  assert.equal(conflict.status, "provider_error");
  assert.equal(conflict.passengerEstimates[0].availabilityReason.code, "CONTRADICTORY_FINAL_PRICE");
  assert.equal(conflict.passengerEstimates[0].fare, null);

  const malformed = normalizeRouteStatsResponse({ currency_rules: { code: "PKR" }, service_levels: [
    { class: "missing", price: "Rs. 100" },
    { class: "negative", price: "Rs. 100", prices: { raw: { final_price: "-1" } } },
    { class: "bad", price: "Rs. 100", prices: { raw: { final_price: "nope" } } },
  ] });
  assert.equal(malformed.status, "provider_error");
  assert.equal(malformed.passengerEstimates.every((item) => item.fare === null), true);
  assert.equal(normalizeRouteStatsResponse({ currency_rules: { code: "USD" }, service_levels: [{ class: "econom", price: "Rs. 100", prices: { raw: { final_price: "100" } } }] }).status, "provider_error");
});

test("authorized Yango quote normalization keeps exact/display/starting and unavailable semantics", async () => {
  const provider = createYangoProvider({
    mode: "authorized-live",
    transport: { async getFareEstimates() { return normalizeRouteStatsResponse(finalPriceResponse); } },
  });
  const response = await provider.getQuotes({ route: { pickup: trip.pickup, destination: trip.destination } });
  const economy = response.find((item) => item.categoryId === "econom");
  const rickshawPlus = response.find((item) => item.categoryId === "test_tariff_project_category");
  assert.equal(economy.fare, 439);
  assert.equal(economy.displayFare, 430);
  assert.equal(economy.startingFare, 209);
  assert.equal(economy.fareType, "FIXED_ROUTE_QUOTE");
  assert.equal(economy.pickupEtaSeconds, 420);
  assert.deepEqual(economy.metadata.routeMetadata, { distance: "4.8 km", time: "16 min" });
  assert.equal(rickshawPlus.fare, null);
  assert.equal(rickshawPlus.exactFare, 273);
  assert.equal(rickshawPlus.isAvailable, false);
  assert.equal(rickshawPlus.availabilityReason.code, "no_free_cars_nearby");
});

test("missing credentials, expired JWT, auth failure, timeout, and malformed JSON are structured errors", async () => {
  const missing = createYangoRouteStatsClient({ config: getConfig({ YANGO_ENABLED: "true" }) });
  await assert.rejects(() => missing.getFareEstimates(trip), { code: "PROVIDER_AUTH_REQUIRED" });
  assert.equal(jwtExpired(token(Math.floor(Date.now() / 1000) - 1)), true);

  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: token(), YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true", YANGO_REQUEST_TIMEOUT_MS: "10" });
  const authClient = createYangoRouteStatsClient({ config, fetchImpl: async () => ({ status: 401, ok: false, text: async () => "{}" }) });
  await assert.rejects(() => authClient.getFareEstimates(trip), { code: "PROVIDER_AUTH_ERROR" });
  const timeoutClient = createYangoRouteStatsClient({ config, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); })) });
  await assert.rejects(() => timeoutClient.getFareEstimates(trip), { code: "PROVIDER_TIMEOUT" });
  const malformedClient = createYangoRouteStatsClient({ config, fetchImpl: async () => ({ status: 200, ok: true, text: async () => "not-json" }) });
  await assert.rejects(() => malformedClient.getFareEstimates(trip), { code: "PROVIDER_BAD_RESPONSE" });
});

test("zero valid tariffs preserve successful upstream diagnostics", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: token(), YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  let requestCount = 0;
  const client = createYangoRouteStatsClient({
    config,
    fetchImpl: async () => {
      requestCount += 1;
      return { status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [] }) };
    },
  });

  await assert.rejects(() => client.getFareEstimates(trip), (error) => {
    assert.equal(error.code, "PROVIDER_NO_VALID_TARIFFS");
    assert.deepEqual(error.yangoDiagnostics, {
      provider: "yango",
      upstreamStatus: 200,
      errorCategory: "NO_VALID_TARIFFS",
      requestReachedUpstream: true,
    });
    return true;
  });
  assert.equal(requestCount, 1);
});

test("Yango HTTP and transport failures produce only safe diagnostics", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: token(), YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const cases = [
    [401, "PROVIDER_AUTH_ERROR", "AUTH_ERROR"],
    [403, "PROVIDER_AUTH_ERROR", "FORBIDDEN"],
    [429, "PROVIDER_ERROR", "RATE_LIMITED"],
    [400, "PROVIDER_ERROR", "BAD_REQUEST"],
    [502, "PROVIDER_ERROR", "UPSTREAM_ERROR"],
  ];
  for (const [status, code, category] of cases) {
    const client = createYangoRouteStatsClient({ config, fetchImpl: async () => ({ status, ok: false, text: async () => "sensitive upstream body" }) });
    await assert.rejects(() => client.getFareEstimates(trip), (error) => {
      assert.equal(error.code, code);
      assert.deepEqual(error.yangoDiagnostics, { provider: "yango", upstreamStatus: status, errorCategory: category, requestReachedUpstream: true });
      assert.equal(String(error).includes("sensitive upstream body"), false);
      return true;
    });
  }

  const malformed = createYangoRouteStatsClient({ config, fetchImpl: async () => ({ status: 200, ok: true, text: async () => "not-json" }) });
  await assert.rejects(() => malformed.getFareEstimates(trip), (error) => {
    assert.equal(error.code, "PROVIDER_BAD_RESPONSE");
    assert.deepEqual(error.yangoDiagnostics, { provider: "yango", upstreamStatus: 200, errorCategory: "INVALID_RESPONSE", requestReachedUpstream: true });
    return true;
  });

  const network = createYangoRouteStatsClient({ config, fetchImpl: async () => { throw Object.assign(new Error("private transport detail"), { code: "ENOTFOUND" }); } });
  await assert.rejects(() => network.getFareEstimates(trip), (error) => {
    assert.equal(error.code, "ENOTFOUND");
    assert.deepEqual(error.yangoDiagnostics, { provider: "yango", upstreamStatus: null, errorCategory: "NETWORK_ERROR", requestReachedUpstream: "unknown" });
    assert.equal(String(error).includes("private transport detail"), false);
    return true;
  });
});

test("development-only HTTP body diagnostics expose shape without sensitive values", async () => {
  assert.deepEqual(inspectErrorBody(""), { bodyKind: "empty", structuredCodeFieldPresent: false });
  assert.deepEqual(inspectErrorBody("plain provider text with a private address"), { bodyKind: "text", structuredCodeFieldPresent: false });
  assert.deepEqual(inspectErrorBody("{\"code\":\"PRIVATE_CODE\",\"message\":\"PRIVATE_ADDRESS\"}"), { bodyKind: "json", structuredCodeFieldPresent: true });
  assert.deepEqual(inspectErrorBody("{\"code\":"), { bodyKind: "invalid_json", structuredCodeFieldPresent: false });

  let diagnostic;
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: token(), YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const client = createYangoRouteStatsClient({
    config,
    diagnosticsEnabled: true,
    onDiagnostic: (value) => { diagnostic = value; },
    fetchImpl: async () => ({ status: 400, ok: false, text: async () => "{\"errorCode\":\"PRIVATE_CODE\",\"message\":\"PRIVATE_ADDRESS\",\"token\":\"PRIVATE_TOKEN\"}" }),
  });
  await assert.rejects(() => client.getFareEstimates(trip), (error) => {
    assert.equal(error.code, "PROVIDER_ERROR");
    assert.equal(error.message, "Yango RouteStats request failed.");
    assert.equal(String(error).includes("PRIVATE_ADDRESS"), false);
    return true;
  });
  assert.deepEqual(diagnostic, { upstreamStatus: 400, bodyKind: "json", structuredCodeFieldPresent: true });
  assert.deepEqual(Object.keys(diagnostic).sort(), ["bodyKind", "structuredCodeFieldPresent", "upstreamStatus"]);

  let disabledCalled = false;
  const disabled = createYangoRouteStatsClient({
    config,
    diagnosticsEnabled: false,
    onDiagnostic: () => { disabledCalled = true; },
    fetchImpl: async () => ({ status: 400, ok: false, text: async () => "{\"code\":\"PRIVATE_CODE\"}" }),
  });
  await assert.rejects(() => disabled.getFareEstimates(trip), { code: "PROVIDER_ERROR" });
  assert.equal(disabledCalled, false);
});

test("opaque access tokens are sent through the confirmed server authentication headers", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "opaque-test-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  let request;
  const client = createYangoRouteStatsClient({
    config,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", name: "Economy", prices: { raw: { final_price: "345" } }, price: "Rs. 345" }] }) };
    },
  });

  const response = await client.getFareEstimates(trip);
  assert.equal(response.status, "available");
  assert.equal(request.options.headers.Authorization, "Bearer opaque-test-token");
  assert.equal(request.options.headers["X-Oauth-Token"], "opaque-test-token");
  assert.equal(request.options.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(request.url, "https://tc.taxi.yango.tech/3.0/routestats");
  assert.equal(request.options.headers["X-Client-ID"], undefined);
  assert.equal(request.options.headers["X-Mob-Id"], undefined);
  assert.equal(request.options.headers["X-Yataxi-Userid"], undefined);
  assert.equal(request.options.headers["X-Location"], undefined);
  const requestBody = JSON.parse(request.options.body);
  assert.deepEqual(requestBody.tariff_requirements, [
    { class: "econom" },
    { class: "business" },
    { class: "comfortplus" },
    { class: "moto" },
  ]);
  assert.deepEqual(requestBody.supported_verticals, ["taxi"]);
  assert.equal("id" in requestBody, false);
  assert.equal("location" in requestBody.state, false);
  assert.equal("precise_location_available" in requestBody.state, false);
  assert.equal(Object.keys(request.options.headers).some((name) => /session|device|cookie|appmetrica|userid/i.test(name)), false);
});

test("opt-in Yango test context maps only approved synthetic headers and query parameters", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "synthetic-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const testContext = getTestConfig({
    YANGO_TEST_REQUEST_ENABLED: "true",
    YANGO_TEST_USER_ID: "synthetic-user",
    YANGO_TEST_MOBILE_ID: "synthetic-mobile",
    YANGO_TEST_LOCATION: "31.5000;74.3000",
    YANGO_TEST_MOBCF: "synthetic-mobcf",
    YANGO_TEST_MOBPR: "synthetic-mobpr",
  });
  let request;
  const client = createYangoRouteStatsClient({
    config,
    testContext,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", prices: { raw: { final_price: "345" } }, price: "Rs. 345" }] }) };
    },
  });
  await client.getFareEstimates(trip);
  const parsedUrl = new URL(request.url);
  assert.equal(parsedUrl.searchParams.get("mobcf"), "synthetic-mobcf");
  assert.equal(parsedUrl.searchParams.get("mobpr"), "synthetic-mobpr");
  assert.equal(request.options.headers["X-Yataxi-Userid"], "synthetic-user");
  assert.equal(request.options.headers["X-Mob-Id"], "synthetic-mobile");
  assert.equal(request.options.headers["X-Location"], "31.5;74.3");
  assert.equal(request.options.headers["X-Yataxi-Last-Zone-Names"], "lahore");
  assert.equal(request.options.headers.Authorization, "Bearer synthetic-token");
  assert.equal(request.options.headers["X-Oauth-Token"], "synthetic-token");
  assert.equal(request.body.id, "synthetic-user");
  assert.deepEqual(request.body.state.location, [74.3, 31.5]);
  assert.equal(request.body.state.precise_location_available, true);
});

test("FairFare vehicle types are normalized to valid Yango selected classes", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZATION_VERIFIED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "synthetic-token", YANGO_AUTHORIZED_CLIENT_ID: "client" });
  const selectedClasses = [];
  const client = createYangoRouteStatsClient({
    config,
    fetchImpl: async (_url, options) => {
      selectedClasses.push(JSON.parse(options.body).selected_class);
      return { status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", prices: { raw: { final_price: "345" } } }] }) };
    },
  });
  await client.getFareEstimates({ ...trip, rideType: "car" });
  await client.getFareEstimates({ ...trip, rideType: "bike" });
  assert.deepEqual(selectedClasses, ["econom", "moto"]);
});

test("test context remains disabled unless explicitly enabled", async () => {
  assert.deepEqual(getTestConfig({ YANGO_TEST_USER_ID: "synthetic-user" }), {
    enabled: false,
    userId: "synthetic-user",
    mobileId: "",
    location: "",
    mobcf: "",
    mobpr: "",
    hasOngoingOrders: false,
    ongoingOrdersStatuses: "none",
    perfClass: "medium",
    acceptLanguage: "en-US",
    vpnActive: "0",
  });
});

test("opt-in test context adds only approved static headers and keeps identity mappings distinct", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "synthetic-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const testContext = getTestConfig({
    YANGO_TEST_REQUEST_ENABLED: "true",
    YANGO_TEST_USER_ID: "synthetic-user",
    YANGO_TEST_MOBILE_ID: "synthetic-mobile",
    YANGO_TEST_LOCATION: "31.5000;74.3000",
  });
  let request;
  const client = createYangoRouteStatsClient({
    config,
    testContext,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", prices: { raw: { final_price: "345" } } }] }) };
    },
  });
  await client.getFareEstimates(trip);
  assert.equal(request.options.headers["X-Yataxi-Userid"], "synthetic-user");
  assert.equal(request.options.headers["X-Mob-Id"], "synthetic-mobile");
  assert.notEqual(request.options.headers["X-Yataxi-Userid"], request.options.headers["X-Mob-Id"]);
  assert.equal(request.options.headers["X-Yataxi-Has-Ongoing-Orders"], "false");
  assert.equal(request.options.headers["X-Yataxi-Ongoing-Orders-Statuses"], "none");
  assert.equal(request.options.headers["X-Perf-Class"], "medium");
  assert.equal(request.options.headers["Accept-Language"], "en-US");
  assert.equal(request.options.headers["X-Vpn-Active"], "0");
  assert.equal(request.options.headers.Host, undefined);
  assert.equal(Object.keys(request.options.headers).some((name) => /session|cookie|appmetrica|device|user-agent/i.test(name)), false);
});

test("test context does not emit malformed optional headers when values are absent", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "synthetic-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const client = createYangoRouteStatsClient({
    config,
    testContext: getTestConfig({ YANGO_TEST_REQUEST_ENABLED: "true" }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["X-Yataxi-Userid"], undefined);
      assert.equal(options.headers["X-Mob-Id"], undefined);
      assert.equal(options.headers["X-Location"], undefined);
      assert.ok(Object.values(options.headers).every((value) => typeof value === "string" && value.length > 0));
      return { status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", prices: { raw: { final_price: "345" } } }] }) };
    },
  });
  await client.getFareEstimates(trip);
});

test("configured test context reaches the transport only when explicitly enabled", () => {
  const disabled = getConfig({
    YANGO_ENABLED: "true",
    YANGO_AUTHORIZATION_VERIFIED: "true",
    YANGO_AUTHORIZED_ACCESS_TOKEN: "synthetic-token",
    YANGO_AUTHORIZED_CLIENT_ID: "client",
    YANGO_TEST_REQUEST_ENABLED: "false",
    YANGO_TEST_USER_ID: "synthetic-user",
  });
  assert.equal(disabled.testContext.enabled, false);

  const enabled = getConfig({
    YANGO_ENABLED: "true",
    YANGO_AUTHORIZATION_VERIFIED: "true",
    YANGO_AUTHORIZED_ACCESS_TOKEN: "synthetic-token",
    YANGO_AUTHORIZED_CLIENT_ID: "client",
    YANGO_TEST_REQUEST_ENABLED: "true",
    YANGO_TEST_USER_ID: "synthetic-user",
  });
  assert.equal(enabled.testContext.enabled, true);
});

test("unverified Yango authorization remains blocked before transport", async () => {
  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "opaque-test-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "false" });
  const client = createYangoRouteStatsClient({ config, fetchImpl: async () => { throw new Error("network must not be called"); } });
  await assert.rejects(() => client.getFareEstimates(trip), { code: "PROVIDER_AUTH_REQUIRED" });
});

test("disabled Yango remains blocked before transport", async () => {
  const config = getConfig({ YANGO_ENABLED: "false", YANGO_AUTHORIZED_ACCESS_TOKEN: "opaque-test-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const client = createYangoRouteStatsClient({ config, fetchImpl: async () => { throw new Error("network must not be called"); } });
  await assert.rejects(() => client.getFareEstimates(trip), { code: "PROVIDER_AUTH_REQUIRED" });
});

test("token inspection distinguishes JWT expiry from opaque-token expiration uncertainty", async () => {
  const valid = token();
  assert.deepEqual(inspectAccessToken(valid).kind, "jwt");
  assert.equal(inspectAccessToken(valid).expiration, "known");
  assert.deepEqual(inspectAccessToken("opaque-bearer-token"), { kind: "opaque", expiration: "unknown", expired: false });

  const config = getConfig({ YANGO_ENABLED: "true", YANGO_AUTHORIZED_ACCESS_TOKEN: "opaque-bearer-token", YANGO_AUTHORIZED_CLIENT_ID: "client", YANGO_AUTHORIZATION_VERIFIED: "true" });
  const client = createYangoRouteStatsClient({
    config,
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", prices: { raw: { final_price: "345" } } }] }) }),
  });
  const response = await client.getFareEstimates(trip);
  assert.equal(response.status, "available");
});

test("injected Yango transport remains isolated and normalizable without enabling production Yango", async () => {
  const provider = createYangoProvider({ mode: "authorized-live", transport: { async getFareEstimates() { return { status: "available", currency: "PKR", estimates: [{ rideType: "econom", categoryName: "Econom", fare: 345 }] }; } } });
  const response = await provider.getFareEstimates(trip);
  assert.equal(response.source, "live");
  assert.equal(response.estimates[0].fare, 345);
  assert.equal(require("../providers/yango.provider").liveTransportEnabled, false);
});
