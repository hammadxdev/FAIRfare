const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { query } = require("../config/postgres");
const llm = require("../services/ai/llmClient");
const assistant = require("../services/ai/aiRideAssistant.service");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

const PRIMARY = "inclusionai/ling-3.1-flash";
const FALLBACKS = ["nvidia/nemotron-3.5-lightning:free", "google/gemma-4-31b-it:free"];

function configure() {
  process.env.AI_ASSISTANT_ENABLED = "true";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = PRIMARY;
  process.env.AI_MODEL_FALLBACK_ENABLED = "true";
  process.env.AI_MODEL_FALLBACKS = FALLBACKS.join(",");
  process.env.AI_REQUEST_TIMEOUT_MS = "1000";
}

function providerSuccess(text = "ok") { return { choices: [{ message: { content: text } }] }; }
function providerError(code, statusCode) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }

test.beforeEach(() => { configure(); llm.setPostJsonForTests(null); });
test.afterEach(() => { llm.setPostJsonForTests(null); });

test("primary success makes one provider call", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { calls.push(JSON.parse(body).model); return providerSuccess("primary"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [PRIMARY]);
  assert.equal(result.modelId, PRIMARY);
  assert.equal(result.fallbackUsed, false);
});

test("429 falls back in configured order and reports the successful model", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model === PRIMARY) throw providerError("LLM_RATE_LIMIT", 429); return providerSuccess("fallback"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [PRIMARY, FALLBACKS[0]]);
  assert.equal(result.modelId, FALLBACKS[0]);
  assert.equal(result.fallbackUsed, true);
});

test("404 model failure falls back without retrying the invalid model", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model === PRIMARY) throw providerError("LLM_MODEL_ERROR", 404); return providerSuccess("fallback"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [PRIMARY, FALLBACKS[0]]);
  assert.equal(result.modelId, FALLBACKS[0]);
});

test("malformed provider output can use the next configured model", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { calls.push(JSON.parse(body).model); if (calls.length === 1) return { choices: [] }; return providerSuccess("fallback"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [PRIMARY, FALLBACKS[0]]);
  assert.equal(result.modelId, FALLBACKS[0]);
});

test("multiple recoverable failures reach the next model only once", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (model !== FALLBACKS[1]) throw providerError("LLM_RATE_LIMIT", 429); return providerSuccess("later"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [PRIMARY, FALLBACKS[0], FALLBACKS[1]]);
  assert.equal(result.modelId, FALLBACKS[1]);
});

test("all recoverable failures are bounded to the primary plus two fallbacks", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { calls.push(JSON.parse(body).model); throw providerError("LLM_RATE_LIMIT", 429); });
  await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {} }), { code: "LLM_RATE_LIMIT" });
  assert.deepEqual(calls, [PRIMARY, ...FALLBACKS]);
});

test("an invalid primary is skipped when a configured fallback is valid", async () => {
  process.env.AI_MODEL = "removed/model";
  process.env.AI_MODEL_FALLBACKS = FALLBACKS.join(",");
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { calls.push(JSON.parse(body).model); return providerSuccess("fallback"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [FALLBACKS[0]]);
  assert.equal(result.modelId, FALLBACKS[0]);
});

test("401 and 403 stop without fallback", async () => {
  for (const statusCode of [401, 403]) {
    const calls = [];
    llm.setPostJsonForTests(async (_url, _headers, body) => { calls.push(JSON.parse(body).model); throw providerError("LLM_AUTH_ERROR", statusCode); });
    await assert.rejects(() => llm.completeDetailed({ message: "hello", context: {} }), { code: "LLM_AUTH_ERROR" });
    assert.deepEqual(calls, [PRIMARY]);
  }
});

test("timeout and network errors can fall back", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { calls.push(JSON.parse(body).model); if (calls.length === 1) throw providerError("LLM_TIMEOUT"); return providerSuccess("network fallback"); });
  const result = await llm.completeDetailed({ message: "hello", context: {} });
  assert.deepEqual(calls, [PRIMARY, FALLBACKS[0]]);
  assert.equal(result.modelId, FALLBACKS[0]);
});

test("successful fallback persists one user and one assistant with its model", async () => {
  const auth = await createAuthenticatedTestUser(app, "Fallback Persistence");
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, body) => { const model = JSON.parse(body).model; calls.push(model); if (calls.length === 1) throw providerError("LLM_RATE_LIMIT", 429); return providerSuccess("fallback reply"); });
  assistant.setLlmClientForTests(llm);
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message: "Which ride?" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [PRIMARY, FALLBACKS[0]]);
  const id = response.body.data.conversation.id;
  const rows = (await query("SELECT role, model_id FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC", [id])).rows;
  assert.deepEqual(rows, [{ role: "USER", model_id: null }, { role: "ASSISTANT", model_id: FALLBACKS[0] }]);
});

test("validation failure does not invoke the model", async () => {
  const auth = await createAuthenticatedTestUser(app, "Fallback Validation");
  let calls = 0;
  assistant.setLlmClientForTests({ completeDetailed: async () => { calls += 1; return { text: "unexpected", modelId: PRIMARY }; } });
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message: " " });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
