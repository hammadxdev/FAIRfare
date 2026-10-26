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
  const result = await executeToolCall({ name: "compare_live_fares", arguments: { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null }, explicitComparisonIntent: true } }, { userId: "user-1", explicitComparisonIntent: true, liveComparisonEnabled: false, deadlineAt: Date.now() + 1000 });
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

  registry.setToolDependenciesForTests({ compareFares: async () => ({ results: [mkResult("indrive", "REAL", "current")] }) });
  const indrive = await registry.getTool("compare_live_fares").execute({ pickup: { lat: 31, lng: 74 }, dropoff: { lat: 32, lng: 75 }, explicitComparisonIntent: true }, { userId: "u1", explicitComparisonIntent: true, liveComparisonEnabled: true });
  assert.equal(indrive.quotes[0].fareSemantics, "Suggested fare — not an offer from an inDrive driver.");

  registry.setToolDependenciesForTests({ compareFares: async () => ({ results: [mkResult("bykea", "SYNTHETIC_DATASET", "current")] }) });
  const unavailable = await registry.getTool("compare_live_fares").execute({ pickup: { lat: 31, lng: 74 }, dropoff: { lat: 32, lng: 75 }, explicitComparisonIntent: true }, { userId: "u1", explicitComparisonIntent: true, liveComparisonEnabled: true });
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.deepEqual(unavailable.quotes, []);
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
