const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../services/tripAwareAiAssistant.service");
const observations = require("../services/fareObservation.service");
const baseAssistant = require("../services/ai/aiRideAssistant.service");
const conversations = require("../services/ai/conversation.service");
const llmClient = require("../services/ai/llmClient");
const toolRegistry = require("../services/ai/toolRegistry");

const message = "Kal 9 baje DHA Phase 5 Lahore se Allama Iqbal International Airport jana hai. Yango, Bykea aur inDrive ka estimated fare batao aur sasta time bhi.";
const envKeys = ["FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED", "FAIRFARE_AI_FARE_FORECAST_ENABLED", "FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED", "FAIRFARE_AI_TOOL_AGENT_ENABLED", "FAIRFARE_AI_MODEL_TOOLS_ENABLED", "FAIRFARE_AI_MODEL_FIRST_ENABLED", "FAIRFARE_AI_TRIP_PLANNER_ENABLED", "FAIRFARE_AI_NEARBY_HISTORY_ENABLED", "FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED"];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalGrounding = baseAssistant.buildGroundingContext;
const originalRecentMessages = conversations.recentMessages;
const originalCompleteDetailed = llmClient.completeDetailed;
const resolvedTrip = () => ({ status: "RESOLVED", city: "Lahore", pickup: { name: "DHA Phase 5 Lahore", placeId: "p1", lat: 31.45, lng: 74.4 }, destination: { name: "Allama Iqbal International Airport", placeId: "p2", lat: 31.52, lng: 74.4 }, route: { distanceMeters: 18000, durationSeconds: 2400 } });
function enableForecastModelPath() {
  process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED = "true";
  process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED = "true";
  process.env.FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED = "true";
  process.env.FAIRFARE_AI_TRIP_PLANNER_ENABLED = "true";
  process.env.FAIRFARE_AI_TOOL_AGENT_ENABLED = "true";
  process.env.FAIRFARE_AI_MODEL_TOOLS_ENABLED = "true";
  process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED = "false";
  baseAssistant.buildGroundingContext = async () => ({});
  conversations.recentMessages = async () => [];
}
test.afterEach(() => {
  assistant.setTripResolverForTests();
  observations.resetQueryForTests();
  toolRegistry.resetToolDependenciesForTests();
  baseAssistant.buildGroundingContext = originalGrounding;
  conversations.recentMessages = originalRecentMessages;
  llmClient.completeDetailed = originalCompleteDetailed;
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("one-shot planner resolves route and returns isolated provider forecasts without live calls", async () => {
  process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED = "true"; process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED = "true"; process.env.FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED = "true";
  let queryCount = 0;
  assistant.setTripResolverForTests(async () => resolvedTrip());
  observations.setQueryForTests(async (_sql, params) => { queryCount += 1; const providerId = params[0]; assert.equal(params[3], 1); assert.equal(params[4], 3); return { rows: [300, 320, 340, 360, 380].map((fare, index) => ({ provider_id: providerId, normalized_category: "car", provider_category: "car", pickup_zone: "Lahore", destination_zone: "Lahore", fare, currency: "PKR", observed_at: `2026-10-${String(10 + index).padStart(2, "0")}T04:00:00.000Z`, hour_of_day: 1, day_of_week: 3, distance_meters: 18000, duration_seconds: 2400, data_source: "REAL" })) }; });
  const result = await assistant.oneShotFuturePlan({ args: { userId: "user-1", conversationId: "conversation-1" }, plan: { status: "READY", departureAt: "2026-10-20T20:30:00.000Z", vehicleType: "car", city: "Lahore" }, message });
  assert.equal(result.status, "READY"); assert.equal(result.route.verified, true); assert.equal(result.estimates.length, 3); assert.equal(queryCount, 3); assert.equal(result.booking.created, false); assert.ok(result.estimates.every((item) => item.sourceType === "forecast"));
});

test("authenticated future forecast resolves trusted route before genuine model-selected tool execution", async () => {
  enableForecastModelPath();
  process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED = "true";
  let resolverInput; let historyFilters; let modelCalls = 0; let routeCalls = 0; let toolRoundTrip = null;
  assistant.setTripResolverForTests(async (input) => { resolverInput = input; return resolvedTrip(); });
  toolRegistry.setToolDependenciesForTests({ maps: { computeRoute: async () => { routeCalls += 1; return { distanceMeters: 18000, durationSeconds: 2400 }; } }, readHistoricalFareEvidence: async (filters) => { historyFilters = filters; return { evidence: [], reason: "INSUFFICIENT_SAMPLE" }; } });
  llmClient.completeDetailed = async ({ toolDefinitions, toolMessages }) => {
    modelCalls += 1;
    assert.ok(toolDefinitions.some((tool) => tool.name === "forecast_fare"));
    if (modelCalls === 1) return { modelId: "test-model", provider: "test", toolCalls: [{ id: "forecast-1", name: "forecast_fare", arguments: { providerId: "yango", vehicleType: "car", forecastAt: "2026-10-20T20:30:00.000Z" } }] };
    toolRoundTrip = toolMessages.find((item) => item.role === "tool");
    return { modelId: "test-model", provider: "test", text: "Historical evidence is insufficient for a forecast." };
  };

  const result = await assistant.answer({ userId: "user-1", conversationId: "conversation-1", message: "Tomorrow at 9 baje from DHA Phase 5 Lahore to Allama Iqbal International Airport, estimate the fare." });

  assert.equal(resolverInput.semantic.pickup.query, "DHA Phase 5 Lahore");
  assert.equal(resolverInput.semantic.destination.query, "Allama Iqbal International Airport");
  assert.equal(modelCalls, 2);
  assert.equal(result.context.toolCallingMode, "model_selected");
  assert.equal(result.toolExecution[0].name, "forecast_fare");
  assert.equal(result.toolExecution[0].ok, true);
  assert.equal(historyFilters.city, "Lahore");
  assert.equal(historyFilters.distanceMeters, 18000);
  assert.equal(historyFilters.durationSeconds, 2400);
  assert.ok(toolRoundTrip.content.includes("INSUFFICIENT_DATA"));
  assert.equal(routeCalls, 0, "a model-selected calculate_route after trusted resolution must not recompute the route");
});

test("model-selected calculate_route after route resolution reuses the trusted route", async () => {
  enableForecastModelPath();
  process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED = "true";
  let routeCalls = 0; let modelCalls = 0;
  assistant.setTripResolverForTests(async () => resolvedTrip());
  toolRegistry.setToolDependenciesForTests({ maps: { computeRoute: async () => { routeCalls += 1; return { distanceMeters: 18000, durationSeconds: 2400 }; } } });
  llmClient.completeDetailed = async ({ toolDefinitions, context }) => {
    modelCalls += 1;
    const routeTool = toolDefinitions.find((tool) => tool.name === "calculate_route");
    assert.ok(routeTool);
    assert.equal(context.verifiedRoute.route.distanceMeters, 18000);
    if (modelCalls === 1) return { modelId: "test-model", provider: "test", toolCalls: [{ id: "route-1", name: "calculate_route", arguments: { pickup: { lat: 31.45, lng: 74.4, name: "DHA Phase 5 Lahore", placeId: "p1" }, dropoff: { lat: 31.52, lng: 74.4, name: "Allama Iqbal International Airport", placeId: "p2" } } }] };
    return { modelId: "test-model", provider: "test", text: "The verified route is 18 km and 40 minutes." };
  };

  const result = await assistant.answer({ userId: "user-1", conversationId: "conversation-1", message: "What is the route from DHA Phase 5 Lahore to Allama Iqbal International Airport?" });

  assert.equal(modelCalls, 2);
  assert.equal(routeCalls, 0);
  assert.equal(result.context.toolCallingMode, "model_selected");
  assert.equal(result.toolExecution[0].name, "calculate_route");
  assert.equal(result.toolExecution[0].ok, true);
  assert.equal(result.toolExecution[0].reused, true);
});

test("ambiguous future trip asks for clarification without invoking the model tool agent", async () => {
  enableForecastModelPath();
  let modelCalls = 0;
  assistant.setTripResolverForTests(async () => ({ status: "UNRESOLVED", unresolved: "destination", unresolvedReason: "AMBIGUOUS", extracted: { destination: "Airport" } }));
  llmClient.completeDetailed = async () => { modelCalls += 1; return { text: "must not run" }; };

  const result = await assistant.answer({ userId: "user-1", conversationId: "conversation-1", message: "Tomorrow at 9 baje from DHA Phase 5 Lahore to Airport, estimate the fare." });

  assert.equal(modelCalls, 0);
  assert.match(result.reply, /multiple matches|city or area/i);
  assert.equal(result.context.toolCallingMode, "server_deterministic");
});

test("failed future route resolution returns unavailable context without a forecast tool call", async () => {
  enableForecastModelPath();
  let modelCalls = 0; let historyReads = 0;
  assistant.setTripResolverForTests(async () => ({ status: "ROUTE_UNAVAILABLE" }));
  toolRegistry.setToolDependenciesForTests({ readHistoricalFareEvidence: async () => { historyReads += 1; return { evidence: [], reason: "INSUFFICIENT_SAMPLE" }; } });
  llmClient.completeDetailed = async () => { modelCalls += 1; return { text: "must not run" }; };

  const result = await assistant.answer({ userId: "user-1", conversationId: "conversation-1", message: "Tomorrow at 9 baje from DHA Phase 5 Lahore to Allama Iqbal Airport, estimate the fare." });

  assert.equal(modelCalls, 0);
  assert.equal(historyReads, 0);
  assert.equal(result.reply.status, "PARTIAL");
  assert.deepEqual(result.reply.estimates, []);
  assert.match(result.reply.limitations.join(" "), /routing is unavailable/i);
});

test("unresolved required route makes the model tool agent ineligible and falls back deterministically", async () => {
  enableForecastModelPath();
  let modelCalls = 0;
  assistant.setTripResolverForTests(async () => ({ status: "ROUTE_UNAVAILABLE" }));
  llmClient.completeDetailed = async () => { modelCalls += 1; return { text: "must not run" }; };

  const result = await assistant.answer({ userId: "user-1", conversationId: "conversation-1", message: "Tomorrow at 9 baje from DHA Phase 5 Lahore to Allama Iqbal International Airport Lahore, estimate fare." });

  assert.equal(modelCalls, 0);
  assert.equal(result.context.toolCallingMode, "server_deterministic");
  assert.match(result.reply.limitations.join(" "), /routing is unavailable/i);
});

test("eligible nearby history request remains a genuine model-selected tool call", async () => {
  process.env.FAIRFARE_AI_NEARBY_HISTORY_ENABLED = "true";
  process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED = "true";
  process.env.FAIRFARE_AI_MODEL_TOOLS_ENABLED = "true";
  process.env.FAIRFARE_AI_TOOL_AGENT_ENABLED = "true";
  process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED = "false";
  conversations.recentMessages = async () => [];
  baseAssistant.buildGroundingContext = async () => ({});
  let calls = 0;
  let reads = 0;
  toolRegistry.setToolDependenciesForTests({ readNearbyObservationContext: async (filters) => { reads += 1; assert.deepEqual(filters, { latitude: 31.45, longitude: 74.4, category: "car", provider: null }); return { status: "INSUFFICIENT_DATA", sampleCount: 0 }; } });
  llmClient.completeDetailed = async ({ toolDefinitions, toolMessages }) => {
    calls += 1;
    assert.ok(toolDefinitions.some((tool) => tool.name === "get_nearby_observation_context"));
    if (calls === 1) return { modelId: "test-model", provider: "test", toolCalls: [{ id: "nearby-1", name: "get_nearby_observation_context", arguments: { pickup: { lat: 31.45, lng: 74.4 }, category: "car" } }] };
    assert.ok(toolMessages.some((item) => item.role === "tool" && item.tool_call_id === "nearby-1"));
    return { modelId: "test-model", provider: "test", text: "There is not enough nearby historical data." };
  };

  const result = await assistant.answer({ userId: "user-1", conversationId: "conversation-1", message: "What historical ride observations are nearby?" });

  assert.equal(calls, 2);
  assert.equal(reads, 1);
  assert.equal(result.context.toolCallingMode, "model_selected");
  assert.equal(result.toolExecution[0].name, "get_nearby_observation_context");
  assert.equal(result.toolExecution[0].ok, true);
});
