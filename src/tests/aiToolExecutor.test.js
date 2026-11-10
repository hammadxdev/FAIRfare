const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../services/ai/toolRegistry");
const { executeToolCall, executeToolCalls } = require("../services/ai/toolExecutor.service");

const oldForecastFlag = process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED;
test.afterEach(() => {
  registry.resetToolDependenciesForTests();
  if (oldForecastFlag === undefined) delete process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED;
  else process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED = oldForecastFlag;
});

test("executes an allowlisted tool with server-owned user context", async () => {
  let seenUser;
  registry.setToolDependenciesForTests({ getHistory: async ({ userId }) => { seenUser = userId; return []; } });
  const result = await executeToolCall({ name: "get_latest_comparison", arguments: { comparisonId: null, includeHistorical: true, userId: "attacker" } }, { userId: "user-1", deadlineAt: Date.now() + 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_TOOL_ARGUMENTS");
  assert.equal(seenUser, undefined);
});

test("rejects duplicate and excessive tool calls", async () => {
  const calls = [{ name: "get_provider_status", arguments: { provider: "a" } }, { name: "get_provider_status", arguments: { provider: "b" } }, { name: "get_provider_status", arguments: { provider: "c" } }, { name: "get_provider_status", arguments: { provider: "d" } }];
  registry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [] } });
  const result = await executeToolCalls(calls, { userId: "user-1", deadlineAt: Date.now() + 1000 });
  assert.equal(result.results[3].error.code, "TOOL_CALL_LIMIT");
  const duplicate = await executeToolCalls([{ name: "get_provider_status", arguments: { provider: "a" } }, { name: "get_provider_status", arguments: { provider: "a" } }], { userId: "user-1", deadlineAt: Date.now() + 1000 });
  assert.equal(duplicate.results[1].error.code, "DUPLICATE_TOOL_CALL");
});

test("enforces live comparison intent and feature flag at execution time", async () => {
  registry.setToolDependenciesForTests({ compareFares: async () => ({ results: [] }) });
  const result = await executeToolCall({ name: "compare_live_fares", arguments: { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null }, explicitComparisonIntent: true } }, { userId: "user-1", explicitComparisonIntent: true, liveComparisonEnabled: false, deadlineAt: Date.now() + 20000 });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "LIVE_COMPARISON_DISABLED");
});

test("one call budget is shared across agent rounds and deadline is passed to model", async () => {
  let round = 0;
  const deadlines = [];
  registry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [] } });
  const llmClient = { completeDetailed: async ({ deadlineAt }) => { deadlines.push(deadlineAt); round += 1; return round <= 3 ? { toolCalls: [{ id: `c-${round}`, name: "get_provider_status", arguments: {} }] } : { text: "No provider status was available." }; } };
  const result = await require("../services/ai/toolExecutor.service").runBoundedToolAgent({ llmClient, message: "Status?", context: {}, serverContext: { userId: "user-1", deadlineAt: Date.now() + 2000 }, tools: registry.listTools() });
  assert.equal(result.handled, true);
  assert.equal(result.toolResults.length, 3);
  assert.equal(round, 4);
  assert.equal(deadlines.every(Number.isFinite), true);
});

test("tool deadline expires before execution", async () => {
  registry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [] } });
  const result = await executeToolCall({ name: "get_provider_status", arguments: {} }, { userId: "user-1", deadlineAt: Date.now() - 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REQUEST_DEADLINE_EXCEEDED");
});

test("native location search prefers the first exact Lahore landmark over looser suggestions", async () => {
  registry.setToolDependenciesForTests({
    maps: {
      fetchAutocomplete: async ({ input }) => input.toLowerCase().includes("garrison")
        ? [
          { name: "Lahore Garrison University", address: "DHA Phase 6, Lahore", city: "Lahore", placeId: "lgu", category: "university", lat: 31.4743, lng: 74.4163 },
          { name: "Lahore University of Management Sciences", address: "DHA, Lahore", city: "Lahore", placeId: "lums", category: "university", lat: 31.4700, lng: 74.4100 },
        ]
        : [
          { name: "UMT", address: "Johar Town, Lahore", city: "Lahore", placeId: "umt", category: "university", lat: 31.4668, lng: 74.3172 },
          { name: "UMT Park", address: "Johar Town, Lahore", city: "Lahore", placeId: "umt-park", category: "park", lat: 31.4670, lng: 74.3180 },
        ],
    },
  });
  const state = { seen: new Set(), calls: 0, liveComparisons: 0 };
  const context = { userId: "user-1", nativeToolAgent: true, deadlineAt: Date.now() + 5000 };
  const origin = await executeToolCall({ name: "search_locations", arguments: { query: "LGU", cityHint: "Lahore" } }, context, state);
  const destination = await executeToolCall({ name: "search_locations", arguments: { query: "UMT", cityHint: "Lahore" } }, context, state);

  assert.equal(origin.result.candidates[0].name, "Lahore Garrison University");
  assert.equal(origin.result.diagnostics.ambiguous, false);
  assert.equal(origin.result.diagnostics.preferredFirstCandidate, true);
  assert.equal(destination.result.candidates[0].name, "UMT");
  assert.equal(destination.result.diagnostics.ambiguous, false);
  assert.equal(destination.result.diagnostics.preferredFirstCandidate, true);
  assert.equal(state.ambiguousLocations.size, 0);
});

test("AI fare tool passes only current REAL quotes and blocks other provenance", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const mkResult = (provider, dataSource, freshness, fare = 250) => ({ provider: { id: provider, name: provider, displayName: provider }, dataSource, source: dataSource === "REAL" ? "live" : "test", isAvailable: true, fare, currency: "PKR", metadata: { providerFreshness: freshness, providerExpiresAt: future }, quotes: [{ service_code: "X", categoryName: "Car" }] });
  registry.setToolDependenciesForTests({ compareFares: async () => ({ comparisonId: "cmp-1", results: [mkResult("yango", "REAL", "current"), mkResult("bykea", "SYNTHETIC_DATASET", "current"), mkResult("indrive", "REAL", "expired"), mkResult("other", "REAL", "current", 0)] }) });
  const tool = registry.getTool("compare_live_fares");
  const result = await tool.execute({ pickup: { lat: 31, lng: 74 }, dropoff: { lat: 32, lng: 75 }, explicitComparisonIntent: true }, { userId: "u1", explicitComparisonIntent: true, liveComparisonEnabled: true });
  assert.equal(result.status, "OK");
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].providerId, "yango");
  assert.equal(result.quotes[0].source, "REAL");
  assert.equal("pickupEtaSeconds" in result.quotes[0], false);
  assert.equal(result.diagnostics.comparisonCompleteness, "partial");
  assert.equal(result.diagnostics.expectedProviderCount, 4);
  assert.equal(result.diagnostics.respondedProviderCount, 4);

  registry.setToolDependenciesForTests({ compareFares: async () => ({ results: [mkResult("indrive", "REAL", "current")] }) });
  const indrive = await registry.getTool("compare_live_fares").execute({ pickup: { lat: 31, lng: 74 }, dropoff: { lat: 32, lng: 75 }, explicitComparisonIntent: true }, { userId: "u1", explicitComparisonIntent: true, liveComparisonEnabled: true });
  assert.equal(indrive.quotes[0].fareSemantics, "Suggested fare — not an offer from an inDrive driver.");

  registry.setToolDependenciesForTests({ compareFares: async () => ({ results: [mkResult("bykea", "SYNTHETIC_DATASET", "current")] }) });
  const unavailable = await registry.getTool("compare_live_fares").execute({ pickup: { lat: 31, lng: 74 }, dropoff: { lat: 32, lng: 75 }, explicitComparisonIntent: true }, { userId: "u1", explicitComparisonIntent: true, liveComparisonEnabled: true });
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.deepEqual(unavailable.quotes, []);
});

test("authorized live quotes use a recent quotedAt timestamp as current freshness evidence", () => {
  const now = Date.now();
  const result = registry.currentRealQuote({
    provider: { name: "quickride", displayName: "Yango" },
    dataSource: "REAL", source: "live", isAvailable: true,
    fare: 510, currency: "PKR",
    quotes: [{ fare: 510, currency: "PKR", source: "live", isAvailable: true, quotedAt: new Date(now - 30_000).toISOString(), categoryName: "Economy" }],
  }, now);
  assert.equal(result.provider, "Yango");
  assert.equal(result.fare, 510);

  const stale = registry.currentRealQuote({
    provider: { name: "quickride", displayName: "Yango" },
    dataSource: "REAL", source: "live", isAvailable: true,
    fare: 510,
    quotes: [{ fare: 510, source: "live", isAvailable: true, quotedAt: new Date(now - 10 * 60_000).toISOString() }],
  }, now);
  assert.equal(stale, null);
});

test("forecast tool reads REAL historical evidence and never labels it a Live Quote", async () => {
  process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED = "true";
  const now = Date.now();
  let received;
  registry.setToolDependenciesForTests({ readHistoricalFareEvidence: async (filters) => {
    received = filters;
    const rows = Array.from({ length: 5 }, (_, index) => ({ providerId: "yango", vehicleCategory: "STANDARD_CAR", city: "Lahore", fare: 300 + index * 20, currency: "PKR", observedAt: new Date(now - (index + 1) * 86_400_000).toISOString(), hourOfDay: 1, dayOfWeek: 3, distanceMeters: 18000, durationSeconds: 2400, sourceType: "historical_observation", dataSource: "REAL" }));
    rows.push({ ...rows[0], fare: 1, dataSource: "SIMULATED" });
    return { status: "OK", evidence: rows };
  } });
  const result = await executeToolCall({ name: "forecast_fare", arguments: { providerId: "yango", vehicleType: "car", forecastAt: "2026-10-20T20:30:00.000Z" } }, {
    userId: "user-1", deadlineAt: Date.now() + 6000,
    resolvedTrip: { status: "RESOLVED", city: "Lahore", route: { distanceMeters: 18000, durationSeconds: 2400 } },
  });
  assert.equal(result.ok, true);
  assert.equal(received.providerId, "yango");
  assert.equal(received.vehicleCategory, "STANDARD_CAR");
  assert.equal(received.city, "Lahore");
  assert.equal(received.hourOfDay, 1);
  assert.equal(received.dayOfWeek, 3);
  assert.equal(received.distanceMeters, 18000);
  assert.equal(received.durationSeconds, 2400);
  assert.equal(received.limit, 100);
  assert.equal(result.result.status, "LIMITED_CALIBRATION");
  assert.equal(result.result.evidenceCount, 5);
  assert.equal(result.result.sourceType, "forecast");
  assert.equal(result.result.quoteType, "HISTORICAL_ESTIMATE_NOT_LIVE_QUOTE");
  assert.notEqual(result.result.sourceType, "live_quote");
  assert.match(result.result.limitations.join(" "), /not Live Quotes/i);
});

test("forecast tool fails closed without trusted route, enough evidence, or database availability", async () => {
  process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED = "true";
  let calls = 0;
  registry.setToolDependenciesForTests({ readHistoricalFareEvidence: async () => { calls += 1; return { status: "OK", evidence: [] }; } });
  const args = { providerId: "yango", vehicleType: "car", forecastAt: "2026-10-20T20:30:00.000Z" };
  const context = { userId: "user-1", deadlineAt: Date.now() + 6000, resolvedTrip: { status: "RESOLVED", city: "Lahore", route: { distanceMeters: 18000, durationSeconds: 2400 } } };
  const missingRoute = await executeToolCall({ name: "forecast_fare", arguments: args }, { ...context, resolvedTrip: null });
  assert.equal(missingRoute.ok, true);
  assert.equal(missingRoute.result.reason, "VERIFIED_ROUTE_CONTEXT_REQUIRED");
  assert.equal(calls, 0);

  const insufficient = await executeToolCall({ name: "forecast_fare", arguments: args }, context);
  assert.equal(insufficient.result.status, "INSUFFICIENT_DATA");
  assert.equal(insufficient.result.sourceType, "unavailable");
  assert.equal(insufficient.result.evidenceCount, 0);

  registry.setToolDependenciesForTests({ readHistoricalFareEvidence: async () => ({ status: "UNAVAILABLE", reason: "QUERY_FAILED" }) });
  const unavailable = await executeToolCall({ name: "forecast_fare", arguments: args }, context);
  assert.equal(unavailable.result.status, "UNAVAILABLE");
  assert.equal(unavailable.result.reason, "QUERY_FAILED");
  assert.equal(unavailable.result.sourceType, "unavailable");
});

test("native compare_live_fares verifies the road route itself and returns distance, duration and provider route", async () => {
  const previous = process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
  process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED = "true";
  try {
    let routedWith;
    let comparedWith;
    registry.setToolDependenciesForTests({
      maps: { computeRoute: async (input) => { routedWith = input; return { distanceMeters: 8980, durationSeconds: 933 }; } },
      compareFares: async (input) => {
        comparedWith = input;
        return { comparisonId: "cmp-1", results: [{ dataSource: "REAL", source: "live", isAvailable: true, fare: 432, provider: { name: "indrive", displayName: "inDrive" }, metadata: { providerFreshness: "current" }, quotes: [{ distanceMeters: 7153, tripDurationSeconds: 962 }] }] };
      },
    });
    const pickup = { lat: 31.4743225, lng: 74.4163742, name: "A", placeId: "p1", city: "Lahore" };
    const dropoff = { lat: 31.4640061, lng: 74.4426299, name: "B", placeId: "p2", city: "Lahore" };
    const state = { seen: new Set(), calls: 0, liveComparisons: 0, locations: new Map([[`${pickup.lat},${pickup.lng}`, pickup], [`${dropoff.lat},${dropoff.lng}`, dropoff]]) };
    const deadlineAt = Date.now() + 50000;
    const result = await executeToolCall(
      { name: "compare_live_fares", arguments: { pickup: { lat: pickup.lat, lng: pickup.lng }, dropoff: { lat: dropoff.lat, lng: dropoff.lng }, vehicleType: "bike", explicitComparisonIntent: true } },
      { userId: "user-1", nativeToolAgent: true, liveComparisonEnabled: true, explicitComparisonIntent: true, requestRunId: "run-1", deadlineAt },
      state,
    );
    assert.equal(result.ok, true);
    assert.equal(result.result.status, "OK");
    assert.deepEqual(routedWith.origin, { lat: pickup.lat, lng: pickup.lng, name: "A", placeId: "p1" });
    assert.equal(comparedWith.route.distanceKm, 8.98);
    assert.equal(comparedWith.route.durationMin, 933 / 60);
    assert.equal(comparedWith.deadlineAt, deadlineAt);
    assert.equal(result.result.route.distanceMeters, 8980);
    assert.equal(result.result.route.durationSeconds, 933);
    assert.equal(result.result.route.sourceType, "verified_road_route");
    assert.deepEqual(result.result.quotes[0].providerRoute, { distanceMeters: 7153, durationSeconds: 962 });
  } finally {
    if (previous === undefined) delete process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
    else process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED = previous;
  }
});
