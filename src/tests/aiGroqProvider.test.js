const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../services/ai/llmClient");
const { understand } = require("../services/ai/semanticUnderstanding.service");

const OPENROUTER_FALLBACK = "nvidia/nemotron-3.5-lightning:free";
let savedEnv;

function configure() {
  process.env.AI_ASSISTANT_ENABLED = "true";
  process.env.AI_PRIMARY_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.GROQ_MODEL = "openai/gpt-oss-120b";
  process.env.GROQ_FALLBACK_MODEL = "openai/gpt-oss-20b";
  process.env.AI_API_KEY = "test-openrouter-key";
  delete process.env.OPENROUTER_API_KEY;
  process.env.AI_MODEL = "inclusionai/ling-3.1-flash";
  process.env.AI_MODEL_FALLBACK_ENABLED = "true";
  process.env.AI_MODEL_FALLBACKS = OPENROUTER_FALLBACK;
  process.env.AI_MAX_MODEL_ATTEMPTS = "4";
  process.env.AI_REQUEST_TIMEOUT_MS = "1000";
  process.env.AI_TOTAL_REQUEST_TIMEOUT_MS = "5000";
  process.env.GROQ_REASONING_EFFORT = "low";
}

function success(text = "Yes — book now.") { return { choices: [{ message: { content: text } }] }; }
function failure(code, statusCode, retryAfterMs) { const error = new Error(code); error.code = code; error.statusCode = statusCode; if (retryAfterMs != null) error.retryAfterMs = retryAfterMs; return error; }

test.beforeEach(() => { savedEnv = { ...process.env }; configure(); llm.resetModelHealthForTests(); llm.setPostJsonForTests(null); });
test.afterEach(() => {
  llm.setPostJsonForTests(null); llm.resetModelHealthForTests();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

for (const code of ["LLM_RATE_LIMIT", "LLM_MALFORMED_RESPONSE"]) {
  test(`Groq-only ${code} exhausts only Groq candidates then fails closed on cooldown`, async () => {
    process.env.AI_MODEL_FALLBACK_ENABLED = "true";
    llm.resetModelHealthForTests();
    const calls = [];
    llm.setPostJsonForTests(async (url, _headers, body) => {
      calls.push({ hostname: new URL(url).hostname, model: JSON.parse(body).model });
      if (code === "LLM_MALFORMED_RESPONSE") return { choices: [] };
      throw failure(code, code === "LLM_RATE_LIMIT" ? 429 : undefined, 60000);
    });
    const args = { message: "hello", context: {}, providerOnly: "groq" };
    await assert.rejects(() => llm.completeDetailed(args), { code });
    assert.deepEqual(calls.map((item) => item.model), code === "LLM_RATE_LIMIT" ? ["openai/gpt-oss-120b"] : ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    assert.equal(calls.every((item) => item.hostname === "api.groq.com"), true);
    if (code === "LLM_RATE_LIMIT") {
    assert.equal(llm.healthSnapshotForTests().length, 1);
    } else {
      await assert.rejects(() => llm.completeDetailed(args), { code: "LLM_MODEL_ERROR" });
      assert.equal(calls.length, 2);
    }
  });
}

test("Groq-only missing key or ineligible provider makes zero requests", async () => {
  let calls = 0;
  llm.setPostJsonForTests(async () => { calls++; return success(); });
  delete process.env.GROQ_API_KEY;
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {}, providerOnly: "groq" }), { code: "LLM_MODEL_ERROR" });
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.AI_PRIMARY_PROVIDER = "openrouter";
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {}, providerOnly: "groq" }), { code: "LLM_MODEL_ERROR" });
  assert.equal(calls, 0);
});

test("metadata-free Groq 429 fails closed without a secondary attempt", async () => {
  llm.setPostJsonForTests(async (url, _headers, body) => {
    assert.equal(new URL(url).hostname, "api.groq.com");
    if (JSON.parse(body).model === "openai/gpt-oss-120b") throw failure("LLM_RATE_LIMIT", 429);
    return success("must not be called");
  });
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {}, providerOnly: "groq" }), { code: "LLM_RATE_LIMIT" });
});

test("Groq HTTP parsing, 429 and timeout paths are fully mocked", async () => {
  const https = require("node:https");
  const { EventEmitter } = require("node:events");
  const original = https.request;
  try {
    for (const [kind, expected] of [["json", "LLM_MALFORMED_RESPONSE"], ["rate", "LLM_RATE_LIMIT"], ["timeout", "LLM_TIMEOUT"]]) {
      llm.resetModelHealthForTests();
      const hosts = [];
      https.request = (options, callback) => {
        hosts.push(options.hostname);
        const request = new EventEmitter();
        let timeout;
        request.setTimeout = (_ms, handler) => { timeout = handler; };
        request.write = () => {};
        request.destroy = () => {};
        request.end = () => queueMicrotask(() => {
          if (kind === "timeout") return timeout();
          const response = new EventEmitter();
          response.statusCode = kind === "rate" ? 429 : 200;
          response.headers = { "retry-after": "60" }; response.setEncoding = () => {};
          callback(response); response.emit("data", kind === "json" ? "not JSON" : '{"error":{"message":"Rate limited"}}'); response.emit("end");
        });
        return request;
      };
      await assert.rejects(() => llm.completeDetailed({ message: "hi", context: {}, providerOnly: "groq" }), { code: expected });
      assert.deepEqual(hosts, kind === "rate" ? ["api.groq.com"] : ["api.groq.com", "api.groq.com"]);
    }
  } finally { https.request = original; }
});

test("Groq required-tool rejection preserves sanitized provider diagnostics", async () => {
  const errorBody = JSON.stringify({ error: { type: "invalid_request_error", code: "tool_choice_required", message: "Tool choice required was specified, but the model did not call a tool. Bearer secret-must-not-leak" } });
  const error = llm.providerFailure(400, errorBody, {});
  assert.equal(error.code, "LLM_TOOL_CHOICE_ERROR");
  assert.equal(error.statusCode, 400);
  assert.equal(error.providerFailureCategory, "tool_choice_rejected");
  assert.equal(error.providerErrorCode, "tool_choice_required");
  assert.match(error.providerMessage, /\[REDACTED\]/);
  assert.doesNotMatch(error.providerMessage, /secret-must-not-leak/);
});

test("Groq required-tool rejection retries once with auto and exposes recovery", async () => {
  const choices = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => {
    const request = JSON.parse(body);
    choices.push(request.tool_choice);
    if (request.tool_choice === "required") throw llm.providerFailure(400, JSON.stringify({ error: { type: "invalid_request_error", code: "tool_choice_required", message: "Tool choice required was specified, but the model did not call a tool" } }));
    return { choices: [{ message: { tool_calls: [{ id: "call-1", type: "function", function: { name: "search_locations", arguments: "{}" } }] } }] };
  });
  const result = await llm.completeDetailed({ message: "route", context: { nativeToolAgent: true }, providerOnly: "groq", toolChoice: "required", toolDefinitions: [{ name: "search_locations", schema: { type: "object", properties: {}, additionalProperties: false } }] });
  assert.deepEqual(choices, ["required", "auto"]);
  assert.equal(result.toolCalls[0].name, "search_locations");
  assert.equal(result.toolRequestDiagnostics.requiredRecovery, "auto_after_required_rejection");
  assert.equal(result.toolRequestDiagnostics.requiredRejection.httpStatus, 400);
});

test("Groq GPT-OSS 120B is primary with hidden low reasoning and bounded output", async () => {
  let call;
  llm.setPostJsonForTests(async (_url, headers, body) => { call = { headers, body: JSON.parse(body) }; return success(); });
  const result = await llm.completeDetailed({ message: "Should I book now?", context: { comparison: { rides: [{ provider: "Yango", fare: 200 }] }, recentConversation: [] } });
  assert.equal(result.provider, "groq");
  assert.equal(result.modelId, "openai/gpt-oss-120b");
  assert.equal(result.text, "Yes — book now.");
  assert.equal(call.body.reasoning_effort, "low");
  assert.equal(call.body.reasoning_format, "hidden");
  assert.equal(call.body.max_completion_tokens, 450);
  assert.equal(call.headers.Authorization, "Bearer test-groq-key");
  assert.equal(JSON.stringify(call.body).includes("test-groq-key"), false);
});

test("confirmed Groq GPT-OSS 120B receives registered tool schemas and auto choice", async () => {
  let requestBody;
  llm.setPostJsonForTests(async (_url, _headers, body) => { requestBody = JSON.parse(body); return success(); });
  await llm.completeDetailed({ message: "Find a route", context: {}, toolDefinitions: [{ name: "calculate_route", description: "Use verified routing", schema: { type: "object", properties: {}, additionalProperties: false } }] });
  assert.equal(requestBody.tools[0].function.name, "calculate_route");
  assert.equal(requestBody.tools[0].function.parameters.additionalProperties, false);
  assert.equal(requestBody.tool_choice, "auto");
});

test("verified route requests use required native tool choice", async () => {
  let requestBody;
  llm.setPostJsonForTests(async (_url, _headers, body) => { requestBody = JSON.parse(body); return success("clarify"); });
  const result = await llm.completeDetailed({ message: "me jana hy kal lgu sy thokar or phir waha sy bahria kia hissab hy kiraye ka", context: { nativeToolAgent: true }, toolChoice: "required", toolDefinitions: [
    { name: "search_locations", description: "Search", schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "calculate_route", description: "Route", schema: { type: "object", properties: {}, additionalProperties: false } },
  ] });
  assert.equal(requestBody.tool_choice, "required");
  assert.deepEqual(result.toolRequestDiagnostics.toolNames, ["search_locations", "calculate_route"]);
  assert.equal(result.toolRequestDiagnostics.toolChoice, "required");
});

test("unsupported required tool choice is downgraded safely to auto", async () => {
  let requestBody;
  process.env.GROQ_MODEL = "openai/gpt-oss-120b";
  llm.setPostJsonForTests(async (_url, _headers, body) => { requestBody = JSON.parse(body); return success(); });
  process.env.GROQ_REQUIRED_TOOL_CHOICE_ENABLED = "false";
  await llm.completeDetailed({ message: "route", context: { nativeToolAgent: true }, toolChoice: "required", toolDefinitions: [{ name: "search_locations", schema: { type: "object" } }] });
  assert.equal(requestBody.tool_choice, "auto");
});

test("Groq parses model-selected tool_calls; unsupported Groq model receives no tools", async () => {
  let requestBody;
  llm.setPostJsonForTests(async (_url, _headers, body) => { requestBody = JSON.parse(body); return { choices: [{ message: { tool_calls: [{ id: "call-1", type: "function", function: { name: "get_provider_status", arguments: "{}" } }] } }] }; });
  const tool = await llm.completeDetailed({ message: "Check Bykea", context: {}, toolDefinitions: [{ name: "get_provider_status", schema: { type: "object", properties: {}, additionalProperties: false } }] });
  assert.equal(requestBody.tool_choice, "auto");
  assert.deepEqual(tool.toolCalls, [{ id: "call-1", name: "get_provider_status", arguments: "{}" }]);

  process.env.GROQ_MODEL = "unsupported/model";
  llm.resetModelHealthForTests();
  llm.setPostJsonForTests(async (_url, _headers, body) => { requestBody = JSON.parse(body); return success(); });
  await llm.completeDetailed({ message: "hello", context: {}, toolDefinitions: [{ name: "get_provider_status", schema: { type: "object" } }] });
  assert.equal(requestBody.tools, undefined);
});

test("Groq semantic JSON response accepts valid JSON and diagnoses malformed or empty content", async () => {
  const validJson = JSON.stringify({ scope: "in_scope", intent: "route", pickup: { query: "Alpha" }, destination: { query: "Beta" }, replyLanguage: "english", confidence: 0.9 });
  const requestBodies = [];
  process.env.AI_MODEL_FALLBACK_ENABLED = "false";
  llm.setPostJsonForTests(async (_url, _headers, body) => {
    requestBodies.push(JSON.parse(body));
    return success("not valid json");
  });

  const malformed = await understand({ llmClient: llm, message: "from Alpha to Beta" });
  llm.setPostJsonForTests(async () => success(""));
  const empty = await understand({ llmClient: llm, message: "from Alpha to Beta" });
  const emptyParser = await understand({ llmClient: { completeDetailed: async () => ({ text: "" }) }, message: "from Alpha to Beta" });
  const valid = await understand({ llmClient: { completeDetailed: async () => ({ text: validJson, modelId: "mock-groq", provider: "groq" }) }, message: "from Alpha to Beta" });

  assert.equal(requestBodies.every((body) => body.response_format?.type === "json_object"), true);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics.parseIssue, "INVALID_JSON");
  assert.deepEqual(malformed.diagnostics.validationIssues, ["INVALID_OBJECT"]);
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "LLM_MALFORMED_RESPONSE");
  assert.equal(emptyParser.diagnostics.parseIssue, "EMPTY_MODEL_CONTENT");
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.understanding.pickup, { query: "Alpha", cityHint: null });
});

test("OPENROUTER_API_KEY is preferred over the legacy AI_API_KEY alias", () => {
  process.env.OPENROUTER_API_KEY = "canonical-openrouter-key";
  assert.equal(llm.config().openRouterApiKey, "canonical-openrouter-key");
});

test("legacy AI_API_KEY still configures OpenRouter when canonical key is absent", () => {
  assert.equal(llm.config().openRouterApiKey, "test-openrouter-key");
});

test("Groq 429 with Retry-After longer than the deadline fails closed", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model === "openai/gpt-oss-120b") throw failure("LLM_RATE_LIMIT", 429, 60000); return success("Yango is cheapest."); });
  await assert.rejects(() => llm.completeDetailed({ message: "Which is cheapest?", context: {} }), { code: "LLM_RATE_LIMIT" });
  assert.deepEqual(calls, ["openai/gpt-oss-120b"]);
  assert.equal(llm.healthSnapshotForTests().find((item) => item.model === "openai/gpt-oss-120b").until > Date.now() + 59000, true);
});

test("Groq 429 with a short Retry-After can use one bounded secondary", async () => {
  const calls = [];
  process.env.AI_TOTAL_REQUEST_TIMEOUT_MS = "5000";
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model === "openai/gpt-oss-120b") throw failure("LLM_RATE_LIMIT", 429, 100); return success("bounded fallback"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  assert.equal(result.text, "bounded fallback");
});

for (const [label, message, code] of [
  ["tokens-per-minute", "tokens per minute limit exceeded", "tokens_per_minute"],
  ["requests-per-minute", "requests per minute limit exceeded", "requests_per_minute"],
  ["quota exhaustion", "quota exhausted", "quota_exhausted"],
]) test(`classifies Groq ${label} exhaustion safely`, () => {
  const error = llm.providerFailure(429, JSON.stringify({ error: { code: "rate_limit_exceeded", message } }), {});
  assert.equal(error.code, "LLM_RATE_LIMIT");
  assert.equal(error.rateLimitKind, code);
  assert.equal(error.retryableRateLimit, code !== "quota_exhausted");
});

test("Groq timeout, malformed output, and credential errors follow existing contracts", async () => {
  llm.setPostJsonForTests(async () => { throw failure("LLM_TIMEOUT"); });
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {} }), { code: "LLM_TIMEOUT" });
  llm.resetModelHealthForTests();
  llm.setPostJsonForTests(async () => ({ choices: [] }));
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {} }), { code: "LLM_MALFORMED_RESPONSE" });
  llm.resetModelHealthForTests();
  llm.setPostJsonForTests(async () => { throw failure("LLM_AUTH_ERROR", 401); });
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {} }), { code: "LLM_AUTH_ERROR" });
});

test("Groq failure reaches OpenRouter, and total failure remains retryable/unavailable", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model !== OPENROUTER_FALLBACK) throw failure("LLM_NETWORK_ERROR"); return success("Fair Fare compares current ride options."); });
  const fallback = await llm.completeDetailed({ message: "What does Fair Fare do?", context: {} });
  assert.equal(fallback.provider, "openrouter");
  assert.equal(fallback.modelId, OPENROUTER_FALLBACK);
  assert.deepEqual(calls, ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "inclusionai/ling-3.1-flash", OPENROUTER_FALLBACK]);

  llm.resetModelHealthForTests();
  llm.setPostJsonForTests(async () => { throw failure("LLM_RATE_LIMIT", 429); });
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {} }), { code: "LLM_RATE_LIMIT" });
});
