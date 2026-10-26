const isolation = require("./helpers/aiIsolation.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const express = require("express");
const conversations = require("../services/ai/conversation.service");
const llm = require("../services/ai/llmClient");
const registry = require("../services/ai/toolRegistry");
const { signAccessToken } = require("../config/auth");
const router = require("../routes/tripAwareAi.routes");
const app = express();
app.use(express.json());
app.use("/api/ai", router);
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
const original = { ...conversations };
const savedEnv = { ...process.env };
let messages, run, requests;
// Real Express route/middleware/controller dispatch without a listening socket.
function post(body, authenticated = true) {
  return new Promise((resolve, reject) => {
    const req = new http.IncomingMessage(new net.Socket());
    req.method = "POST"; req.url = "/api/ai/chat"; req.push(JSON.stringify(body)); req.push(null);
    req.headers = authenticated ? { authorization: `Bearer ${signAccessToken({ id: "synthetic-user", name: "Synthetic" })}`, "content-type": "application/json", "content-length": Buffer.byteLength(JSON.stringify(body)) } : {};
    const res = new http.ServerResponse(req);
    res.json = (value) => { resolve({ status: res.statusCode, body: value }); return res; };
    app.handle(req, res, reject);
  });
}
test.beforeEach(() => {
  Object.assign(process.env, { AI_ASSISTANT_ENABLED: "true", AI_PRIMARY_PROVIDER: "groq", GROQ_API_KEY: "synthetic", GROQ_MODEL: "openai/gpt-oss-120b", AI_MODEL_FALLBACK_ENABLED: "false", FAIRFARE_AI_TOOL_AGENT_ENABLED: "true", FAIRFARE_AI_MODEL_TOOLS_ENABLED: "true", FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED: "true", FAIRFARE_AI_MEMORY_ENABLED: "false", FAIRFARE_AI_LIVE_COMPARISON_ENABLED: "false" });
  messages = []; run = null; requests = 0; llm.resetModelHealthForTests();
  isolation.setQuery(async (sql) => {
    if (sql.includes("INSERT INTO api_rate_limits")) return { rows: [{ request_count: 1, retry_after: 60 }] };
    assert.match(sql, /FROM users WHERE id/);
    return { rows: [{ id: "synthetic-user", name: "Synthetic", email: "synthetic@example.invalid", email_verified_at: "2026-01-01" }] };
  });
  Object.assign(conversations, {
    findByClientMessageId: async () => run ? { id: "conversation" } : null,
    ensure: async (user) => { assert.equal(user, "synthetic-user"); return { id: "conversation" }; },
    claimRequestRun: async () => run ? { ...run, claimOwner: false } : (run = { id: "run", status: "PENDING", claimOwner: true }),
    completeRequestRun: async (user, id, result) => { assert.equal(user, "synthetic-user"); assert.equal(id, "run"); run = { ...run, ...result, response_json: result.response }; },
    addMessage: async (_user, _id, role, content, modelId) => { messages.push({ role, content, modelId }); return { id: messages.length }; },
    titleFirstMessage: async () => {}, recentMessages: async () => messages,
    get: async () => ({ id: "conversation", title: "Chat", messages: [...messages] }),
  });
  llm.setPostJsonForTests(async () => { requests++; return { choices: [{ message: { content: "A car has more luggage space." } }] }; });
});
test.afterEach(() => {
  Object.assign(conversations, original); llm.setPostJsonForTests(null); llm.resetModelHealthForTests(); registry.resetToolDependenciesForTests(); isolation.setQuery();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
test("JWT-authenticated chat preserves envelope, persistence and completed replay", async () => {
  const body = { message: "Which vehicle suits luggage?", clientMessageId: "message-1" };
  const first = await post(body);
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.success, true);
  assert.equal(first.body.data.reply, "A car has more luggage space.");
  assert.equal(first.body.data.provider, "groq"); assert.equal(first.body.data.conversation.messages.length, 2);
  assert.equal(run.status, "COMPLETED");
  const replay = await post(body);
  assert.equal(replay.status, 200); assert.equal(requests, 1); assert.equal(messages.length, 2);
  assert.equal(replay.body.data.reply, first.body.data.reply);
});
test("missing JWT rejects before persistence and model", async () => {
  const result = await post({ message: "hi" }, false);
  assert.equal(result.status, 401); assert.equal(requests, 0); assert.equal(messages.length, 0);
});
test("pending and uncertain requests cannot re-execute tools", async () => {
  for (const status of ["PENDING", "UNCERTAIN"]) {
    run = { id: "run", status };
    const result = await post({ message: "Compare fares", clientMessageId: "same" });
    assert.equal(result.status, 409); assert.equal(requests, 0);
  }
});
test("assistant persistence failure marks run failed and does not claim success", async () => {
  conversations.addMessage = async (_user, _id, role) => { if (role === "ASSISTANT") throw new Error("Synthetic persistence failure"); return { id: 1 }; };
  const result = await post({ message: "Luggage advice", clientMessageId: "failure" });
  assert.equal(result.status, 500); assert.equal(run.status, "FAILED");
});
test("full endpoint executes the selected tool and returns its result to Groq", async () => {
  registry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [{ id: "bykea", enabled: false, status: "UNAVAILABLE" }] } });
  llm.setPostJsonForTests(async (_url, _headers, body) => {
    requests++;
    if (requests === 1) return { choices: [{ message: { tool_calls: [{ id: "status-id", type: "function", function: { name: "get_provider_status", arguments: "{}" } }] } }] };
    const tool = JSON.parse(body).messages.find((m) => m.role === "tool");
    assert.equal(tool.tool_call_id, "status-id"); assert.match(tool.content, /UNAVAILABLE/);
    return { choices: [{ message: { content: "The Bykea integration is unavailable; this does not confirm driver availability." } }] };
  });
  const result = await post({ message: "Check provider status", clientMessageId: "tools" });
  assert.equal(result.status, 200); assert.equal(requests, 2);
  assert.deepEqual(result.body.data.context.diagnostics.modelSelectedTools, ["get_provider_status"]);
  assert.deepEqual(result.body.data.context.diagnostics.toolsActuallyExecuted, ["get_provider_status"]);
  assert.equal(run.toolExecution.results[0].toolCallId, "status-id");
});

test("active endpoint executes arbitrary multi-stop native search and ordered route legs with grounded approximate metadata", async () => {
  const points = {
    "origin place": { name: "Origin Place", placeId: "origin", lat: 31.50, lng: 74.30, resultType: "amenity", city: "Lahore" },
    "middle area": { name: "Middle Area", placeId: "middle", lat: 31.51, lng: 74.31, resultType: "suburb", city: "Lahore" },
    "final landmark": { name: "Final Landmark", placeId: "final", lat: 31.52, lng: 74.32, resultType: "amenity", city: "Lahore" },
  };
  const legs = [];
  registry.setToolDependenciesForTests({
    maps: {
      fetchAutocomplete: async ({ input }) => [{ ...points[input] }],
      computeRoute: async ({ origin, destination }) => { legs.push(`${origin.name}->${destination.name}`); return { distanceMeters: 1000, durationSeconds: 120 }; },
    },
  });
  llm.setPostJsonForTests(async (_url, _headers, body) => {
    requests++;
    if (requests === 1) return { choices: [{ message: { tool_calls: [
      ...["origin place", "middle area", "final landmark"].map((query, index) => ({ id: `search-${index}`, type: "function", function: { name: "search_locations", arguments: JSON.stringify({ query }) } })),
      { id: "route-1", type: "function", function: { name: "calculate_route", arguments: JSON.stringify({ pickup: { name: "Origin Place", placeId: "origin", lat: 31.50, lng: 74.30 }, dropoff: { name: "Middle Area", placeId: "middle", lat: 31.51, lng: 74.31 } }) } },
      { id: "route-2", type: "function", function: { name: "calculate_route", arguments: JSON.stringify({ pickup: { name: "Middle Area", placeId: "middle", lat: 31.51, lng: 74.31 }, dropoff: { name: "Final Landmark", placeId: "final", lat: 31.52, lng: 74.32 } }) } },
    ] } }] };
    return { choices: [{ message: { content: "The approximate map-based route is 2 km and about 4 minutes; the middle stop is an approximate representative area point." } }] };
  });
  const result = await post({ message: "origin place to middle area then final landmark", clientMessageId: "multi-stop" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(legs, ["Origin Place->Middle Area", "Middle Area->Final Landmark"], JSON.stringify(result.body.data.toolExecution));
  assert.match(result.body.data.reply, /approximate map-based route/i);
  assert.match(result.body.data.reply, /representative area point/i);
  const searchResult = result.body.data.toolExecution.results.find((item) => item.name === "search_locations");
  assert.equal(searchResult.result.candidates[0].approximate, false);
  assert.equal(result.body.data.context.diagnostics.modelSelectedTools.filter((name) => name === "calculate_route").length, 2);
});
test("request-run SQL has seven matching bound values", async () => {
  Object.assign(conversations, original);
  isolation.setQuery(async (sql, values) => {
    assert.match(sql, /WHERE id=\$6 AND user_id=\$7/); assert.equal(values.length, 7);
    assert.equal(values[5], "run"); assert.equal(values[6], "synthetic-user");
    return { rows: [{ status: "COMPLETED" }] };
  });
  assert.equal((await conversations.completeRequestRun("synthetic-user", "run", { response: { reply: "hello" } })).status, "COMPLETED");
});
