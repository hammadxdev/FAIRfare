const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const adapters = require("../services/ai/providerAdapters");
const registry = require("../services/ai/modelRegistry");
const toolRegistry = require("../services/ai/toolRegistry");
const { runBoundedToolAgent } = require("../services/ai/toolExecutor.service");
const tripAware = require("../services/tripAwareAiAssistant.service");
const llmClient = require("../services/ai/llmClient");
const conversations = require("../services/ai/conversation.service");
const baseAssistant = require("../services/ai/aiRideAssistant.service");
const { buildTraceDiagnostics } = require("../controllers/tripAwareAi.controller");

const modelToolEnv = ["AI_ASSISTANT_ENABLED", "AI_PRIMARY_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "GROQ_FALLBACK_MODEL", "AI_MODEL_FALLBACK_ENABLED", "AI_MODEL_FALLBACKS", "AI_MAX_MODEL_ATTEMPTS", "AI_REQUEST_TIMEOUT_MS", "AI_TOTAL_REQUEST_TIMEOUT_MS", "FAIRFARE_AI_MODEL_FIRST_ENABLED", "FAIRFARE_AI_TOOL_AGENT_ENABLED", "FAIRFARE_AI_MODEL_TOOLS_ENABLED"];
const originalModelToolEnv = Object.fromEntries(modelToolEnv.map((key) => [key, process.env[key]]));
const originalRecentMessages = conversations.recentMessages;
const originalGroundingContext = baseAssistant.buildGroundingContext;

test.afterEach(() => {
  llmClient.setPostJsonForTests(null);
  conversations.recentMessages = originalRecentMessages;
  baseAssistant.buildGroundingContext = originalGroundingContext;
  baseAssistant.setLlmClientForTests(llmClient);
  toolRegistry.resetToolDependenciesForTests();
  tripAware.setTripResolverForTests();
  for (const [key, value] of Object.entries(originalModelToolEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("unverified model candidates do not receive tool schemas", () => {
  const body = adapters.requestBody({ model: "unverified", supportsTools: false }, { systemInstructions: "x", message: "hi", context: {}, history: [], toolDefinitions: [{ name: "x", schema: { type: "object" } }] });
  assert.equal(body.tools, undefined);
  assert.equal(registry.MODELS.every((model) => model.supportsTools === false), true);
});

test("bounded agent executes mocked tool calls and returns final text", async () => {
  let round = 0;
  toolRegistry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [{ id: "bykea", status: "UNAVAILABLE", enabled: false }] } });
  const llmClient = { completeDetailed: async () => ++round === 1 ? { toolCalls: [{ id: "call-1", name: "get_provider_status", arguments: {} }] } : { text: "Bykea is unavailable in this comparison.", modelId: "mock", provider: "mock" } };
  const result = await runBoundedToolAgent({ llmClient, message: "Why is Bykea unavailable?", context: {}, serverContext: { userId: "user-1", deadlineAt: Date.now() + 1000 }, tools: toolRegistry.listTools() });
  assert.equal(result.handled, true);
  assert.equal(result.result.text, "Bykea is unavailable in this comparison.");
  toolRegistry.resetToolDependenciesForTests();
});

test("tool result is sent back to the model before its final response", async () => {
  let round = 0;
  const seenToolMessages = [];
  toolRegistry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [{ id: "bykea", status: "UNAVAILABLE", enabled: false }] } });
  const llmClient = { completeDetailed: async ({ toolMessages }) => {
    round += 1;
    if (round === 1) return { toolCalls: [{ id: "status-1", name: "get_provider_status", arguments: {} }] };
    seenToolMessages.push(...toolMessages.filter((item) => item.role === "tool"));
    return { text: "Bykea reports unavailable.", modelId: "openai/gpt-oss-120b", provider: "groq" };
  } };
  const result = await runBoundedToolAgent({ llmClient, message: "Check Bykea", context: {}, serverContext: { userId: "user-1", deadlineAt: Date.now() + 1000 }, tools: toolRegistry.listTools() });
  assert.equal(round, 2);
  assert.equal(seenToolMessages[0].tool_call_id, "status-1");
  assert.match(seenToolMessages[0].content, /UNAVAILABLE/);
  assert.equal(result.result.text, "Bykea reports unavailable.");
});

test("native multi-stop route fits three searches, two legs, and a final answer", async () => {
  const points = {
    Alpha: { name: "Alpha", placeId: "a", lat: 31.1, lng: 74.1, city: "Lahore" },
    Bravo: { name: "Bravo", placeId: "b", lat: 31.2, lng: 74.2, city: "Lahore" },
    Charlie: { name: "Charlie", placeId: "c", lat: 31.3, lng: 74.3, city: "Lahore" },
  };
  toolRegistry.setToolDependenciesForTests({ maps: {
    fetchAutocomplete: async ({ input }) => [points[input]],
    computeRoute: async ({ origin, destination }) => ({ distanceMeters: 1000, durationSeconds: 120, compareFaresEligible: true, origin, destination }),
  } });
  try {
    let requests = 0;
    const llmClientMock = { completeDetailed: async () => {
      requests += 1;
      if (requests === 1) return { provider: "groq", toolCalls: ["Alpha", "Bravo", "Charlie"].map((query, i) => ({ id: `search-${i}`, name: "search_locations", arguments: JSON.stringify({ query, cityHint: null }) })) };
      if (requests === 2) return { provider: "groq", toolCalls: [
        { id: "route-1", name: "calculate_route", arguments: JSON.stringify({ pickup: { lat: points.Alpha.lat, lng: points.Alpha.lng, name: points.Alpha.name, placeId: points.Alpha.placeId }, dropoff: { lat: points.Bravo.lat, lng: points.Bravo.lng, name: points.Bravo.name, placeId: points.Bravo.placeId } }) },
        { id: "route-2", name: "calculate_route", arguments: JSON.stringify({ pickup: { lat: points.Bravo.lat, lng: points.Bravo.lng, name: points.Bravo.name, placeId: points.Bravo.placeId }, dropoff: { lat: points.Charlie.lat, lng: points.Charlie.lng, name: points.Charlie.name, placeId: points.Charlie.placeId } }) },
      ] };
      return { provider: "groq", text: "Verified route ready.", toolRequestDiagnostics: { toolChoice: "required" } };
    } };
    const result = await runBoundedToolAgent({
      llmClient: llmClientMock, message: "Alpha then Bravo then Charlie", context: { nativeToolAgent: true },
      serverContext: { userId: "user-1", nativeToolAgent: true, deadlineAt: Date.now() + 5000 },
      tools: toolRegistry.listTools().filter((tool) => ["search_locations", "calculate_route"].includes(tool.name)),
      providerOnly: "groq", toolChoice: "required",
    });
    assert.equal(result.result.text, "Verified route ready.");
    assert.equal(requests, 3);
    assert.equal(result.toolResults.length, 5);
    assert.deepEqual(result.modelSelectedTools, ["search_locations", "search_locations", "search_locations", "calculate_route", "calculate_route"]);
    assert.equal(result.resolvedTrip?.legs?.length, 2, JSON.stringify(result.toolResults));
  } finally { toolRegistry.resetToolDependenciesForTests(); }
});

test("eligible model tool agent runs before deterministic keyword tool dispatch", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/tripAwareAiAssistant.service.js"), "utf8");
  assert.ok(source.indexOf("if (canRunModelTools)") < source.indexOf("const toolPath = await deterministicToolPath"));
  assert.match(source, /toolCallingMode: "model_selected"/);
  assert.match(source, /toolCallingMode: "server_deterministic"/);
});

test("native tool selection routes without a preliminary semantic request", async () => {
  Object.assign(process.env, { AI_ASSISTANT_ENABLED: "true", AI_PRIMARY_PROVIDER: "groq", GROQ_API_KEY: "mock-key", GROQ_MODEL: "openai/gpt-oss-120b", AI_MODEL_FALLBACK_ENABLED: "false", AI_MAX_MODEL_ATTEMPTS: "1", AI_REQUEST_TIMEOUT_MS: "1000", AI_TOTAL_REQUEST_TIMEOUT_MS: "3000", FAIRFARE_AI_MODEL_FIRST_ENABLED: "true", FAIRFARE_AI_TOOL_AGENT_ENABLED: "true", FAIRFARE_AI_MODEL_TOOLS_ENABLED: "true", FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED: "true" });
  let requests = 0;
  const requestBodies = [];
  const mockedResponse = (message) => ({ choices: [{ message }] });
  llmClient.setPostJsonForTests(async (_url, _headers, body) => {
    requests += 1;
    requestBodies.push(JSON.parse(body));
    if (requests === 1) return mockedResponse({ tool_calls: [{ id: "mock-call", type: "function", function: { name: "get_provider_status", arguments: "{}" } }] });
    return mockedResponse({ content: "Provider status checked." });
  });
  conversations.recentMessages = async () => [];
  baseAssistant.buildGroundingContext = async () => ({});
  tripAware.setTripResolverForTests(async () => ({ status: "RESOLVED", pickup: { name: "Alpha", lat: 1, lng: 2, placeId: "alpha" }, destination: { name: "Beta", lat: 3, lng: 4, placeId: "beta" }, route: { distanceMeters: 1000, durationSeconds: 120 }, extracted: { pickup: "Alpha", destination: "Beta" } }));
  toolRegistry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [{ id: "mock-provider", status: "AVAILABLE", enabled: true }] } });

  const result = await tripAware.answer({ userId: "mock-user", conversationId: "mock-conversation", message: "from Alpha to Beta" });

  assert.equal(requests, 2);
  assert.equal(result.context.semanticUnderstandingDiagnostics.attempted, false);
  assert.equal(result.context.toolCallingMode, "model_selected");
  assert.equal(requestBodies[0].tools.some((tool) => tool.function.name === "get_provider_status"), true);
  assert.equal(requestBodies[1].messages.some((item) => item.role === "tool" && item.tool_call_id === "mock-call"), true);
  const trace = buildTraceDiagnostics(result, "mock-request");
  assert.equal(trace.serverSelectedIntent, null);
  assert.deepEqual(trace.modelSelectedTools, trace.toolsActuallyExecuted);
  assert.deepEqual(trace.toolsActuallyExecuted, ["get_provider_status"]);
});

test("Groq response without tool_calls reports no model-selected tool", async () => {
  Object.assign(process.env, { AI_ASSISTANT_ENABLED: "true", AI_PRIMARY_PROVIDER: "groq", GROQ_API_KEY: "mock-key", GROQ_MODEL: "openai/gpt-oss-120b", AI_MODEL_FALLBACK_ENABLED: "false", AI_MAX_MODEL_ATTEMPTS: "1", AI_REQUEST_TIMEOUT_MS: "1000", AI_TOTAL_REQUEST_TIMEOUT_MS: "3000", FAIRFARE_AI_MODEL_FIRST_ENABLED: "true", FAIRFARE_AI_TOOL_AGENT_ENABLED: "true", FAIRFARE_AI_MODEL_TOOLS_ENABLED: "true", FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED: "true" });
  let requests = 0;
  llmClient.setPostJsonForTests(async () => {
    requests += 1;
    return { choices: [{ message: { content: requests === 1 ? "not json" : "No function was selected." } }] };
  });
  conversations.recentMessages = async () => [];
  baseAssistant.buildGroundingContext = async () => ({});
  tripAware.setTripResolverForTests(async () => ({ status: "RESOLVED", pickup: { name: "Alpha", lat: 1, lng: 2, placeId: "alpha" }, destination: { name: "Beta", lat: 3, lng: 4, placeId: "beta" }, route: { distanceMeters: 1000, durationSeconds: 120 }, extracted: { pickup: "Alpha", destination: "Beta" } }));
  const result = await tripAware.answer({ userId: "mock-user", conversationId: "mock-conversation", message: "from Alpha to Beta" });
  const trace = buildTraceDiagnostics(result, "mock-request");
  assert.equal(requests, 1);
  assert.equal(trace.toolCallingMode, "model_selected");
  assert.equal(trace.serverSelectedIntent, null);
  assert.deepEqual(trace.modelSelectedTools, []);
  assert.equal(trace.toolsActuallyExecuted.length, 0);
  assert.equal(trace.noToolExecutionReason, null);
});

test("clear Fair Fare app help skips semantic and tool-agent calls", async () => {
  Object.assign(process.env, { AI_ASSISTANT_ENABLED: "true", AI_PRIMARY_PROVIDER: "groq", GROQ_API_KEY: "mock-key", GROQ_MODEL: "openai/gpt-oss-120b", AI_MODEL_FALLBACK_ENABLED: "false", AI_MAX_MODEL_ATTEMPTS: "1", FAIRFARE_AI_MODEL_FIRST_ENABLED: "true", FAIRFARE_AI_TOOL_AGENT_ENABLED: "true", FAIRFARE_AI_MODEL_TOOLS_ENABLED: "true" });
  let requests = 0;
  llmClient.setPostJsonForTests(async () => { requests += 1; return { choices: [{ message: { content: "Open the app menu to find ride features." } }] }; });
  conversations.recentMessages = async () => [];
  baseAssistant.buildGroundingContext = async () => ({ recentConversation: [], history: [], preferences: {} });

  const result = await tripAware.answer({ userId: "mock-user", conversationId: "mock-conversation", message: "How do I use the Fair Fare app?" });

  assert.equal(requests, 1);
  assert.equal(result.reply, "Open the app menu to find ride features.");
  assert.equal(result.context.semanticUnderstandingDiagnostics.attempted, false);
});

test("contextless booking decision asks for trip details without a model recommendation", async () => {
  Object.assign(process.env, { AI_ASSISTANT_ENABLED: "true", AI_PRIMARY_PROVIDER: "groq", GROQ_API_KEY: "mock-key", GROQ_MODEL: "openai/gpt-oss-120b", FAIRFARE_AI_MODEL_FIRST_ENABLED: "true", FAIRFARE_AI_TOOL_AGENT_ENABLED: "true", FAIRFARE_AI_MODEL_TOOLS_ENABLED: "true" });
  let requests = 0;
  llmClient.setPostJsonForTests(async () => { requests += 1; return { choices: [{ message: { content: "Book now." } }] }; });
  conversations.recentMessages = async () => [];

  const result = await tripAware.answer({ userId: "mock-user", conversationId: "mock-conversation", message: "Should I book now?" });

  assert.equal(requests, 1);
  assert.match(result.reply, /pickup, destination, and current ride options/i);
  assert.doesNotMatch(result.reply, /book now|fare|available/i);
});

test("booking decision with verified conversation trip stays trip-aware", async () => {
  Object.assign(process.env, { AI_ASSISTANT_ENABLED: "true", AI_PRIMARY_PROVIDER: "groq", GROQ_API_KEY: "mock-key", GROQ_MODEL: "openai/gpt-oss-120b", AI_MODEL_FALLBACK_ENABLED: "false", AI_MAX_MODEL_ATTEMPTS: "1", FAIRFARE_AI_MODEL_FIRST_ENABLED: "true", FAIRFARE_AI_TOOL_AGENT_ENABLED: "true", FAIRFARE_AI_MODEL_TOOLS_ENABLED: "true", FAIRFARE_AI_LIVE_COMPARISON_ENABLED: "false" });
  let requests = 0;
  llmClient.setPostJsonForTests(async () => { requests += 1; return { choices: [{ message: { content: "For Alpha to Beta, I need current ride options before advising you." } }] }; });
  conversations.recentMessages = async () => [{ role: "USER", content: "from Alpha to Beta" }];
  tripAware.setTripResolverForTests(async () => ({ status: "RESOLVED", pickup: { name: "Alpha", lat: 1, lng: 2 }, destination: { name: "Beta", lat: 3, lng: 4 }, route: { distanceMeters: 1200, durationSeconds: 180 } }));

  const result = await tripAware.answer({ userId: "mock-user", conversationId: "mock-conversation", message: "Should I book now?" });

  assert.equal(requests, 1);
  assert.equal(result.context.toolCallingMode, "model_selected");
  assert.match(result.reply, /Alpha to Beta/);
  assert.doesNotMatch(result.reply, /book now|fare is|driver is available/i);
});

test("fare tool response guard uses only verified quotes and returns unavailable without them", () => {
  const unavailable = tripAware.liveFareToolReply({ results: [{ name: "compare_live_fares", ok: true, result: { status: "UNAVAILABLE", quotes: [] } }] }, "Compare fares");
  assert.match(unavailable, /No current verified provider fare/);
  assert.doesNotMatch(unavailable, /PKR\s*\d/);
  const current = tripAware.liveFareToolReply({ results: [{ name: "compare_live_fares", ok: true, result: { status: "OK", quotes: [{ provider: "Yango", fare: 345, currency: "PKR", source: "REAL", freshness: "current" }, { provider: "inDrive", fare: 350, currency: "PKR", source: "REAL", freshness: "current", fareSemantics: "Suggested fare — not an offer from an inDrive driver." }] } }] }, "Compare fares");
  assert.match(current, /Yango: 345 PKR/);
  assert.match(current, /Suggested fare — not an offer from an inDrive driver\./);
});
