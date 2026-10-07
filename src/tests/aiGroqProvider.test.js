const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../services/ai/llmClient");

const OPENROUTER_FALLBACK = "nvidia/nemotron-3.5-lightning:free";

function configure() {
  process.env.AI_ASSISTANT_ENABLED = "true";
  process.env.AI_PRIMARY_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.GROQ_MODEL = "openai/gpt-oss-120b";
  process.env.GROQ_FALLBACK_MODEL = "openai/gpt-oss-20b";
  process.env.AI_API_KEY = "test-openrouter-key";
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

test.beforeEach(() => { configure(); llm.resetModelHealthForTests(); llm.setPostJsonForTests(null); });
test.afterEach(() => { llm.setPostJsonForTests(null); });

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

test("Groq 429 uses Retry-After cooldown and then the Groq secondary", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model === "openai/gpt-oss-120b") throw failure("LLM_RATE_LIMIT", 429, 60000); return success("Yango is cheapest."); });
  const result = await llm.completeDetailed({ message: "Which is cheapest?", context: {} });
  assert.deepEqual(calls, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  assert.equal(result.text, "Yango is cheapest.");
  assert.equal(llm.healthSnapshotForTests().find((item) => item.model === "openai/gpt-oss-120b").until > Date.now() + 59000, true);
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
