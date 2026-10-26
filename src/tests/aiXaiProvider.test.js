const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../services/ai/llmClient");

const saved = { ...process.env };

test.beforeEach(() => {
  Object.assign(process.env, {
    AI_ASSISTANT_ENABLED: "true",
    AI_PRIMARY_PROVIDER: "groq",
    GROQ_API_KEY: "groq-test",
    GROQ_MODEL: "openai/gpt-oss-120b",
    GROQ_FALLBACK_MODEL: "openai/gpt-oss-120b",
    XAI_API_KEY: "xai-test",
    XAI_MODEL: "grok-4.7",
    AI_MODEL_FALLBACK_ENABLED: "true",
    AI_MODEL_FALLBACKS: "grok-4.7",
    AI_TOTAL_REQUEST_TIMEOUT_MS: "5000",
  });
  llm.resetModelHealthForTests();
});

test.afterEach(() => {
  llm.setPostJsonForTests(null);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test("Groq rate limit falls back to xAI with native tools and prior tool transcript", async () => {
  const requests = [];
  llm.setPostJsonForTests(async (url, headers, raw) => {
    const body = JSON.parse(raw);
    requests.push({ url, headers, body });
    if (body.model.startsWith("openai/")) {
      const error = new Error("rate limited");
      error.code = "LLM_RATE_LIMIT";
      error.retryableRateLimit = true;
      error.retryAfterMs = 1;
      throw error;
    }
    return { choices: [{ message: { tool_calls: [{ id: "route-1", type: "function", function: { name: "calculate_route", arguments: JSON.stringify({ pickup: { latitude: 31.5, longitude: 74.3 }, destination: { latitude: 31.51, longitude: 74.31 } }) } }] } }] };
  });

  const result = await llm.completeDetailed({
    message: "Calculate the verified route",
    context: { nativeToolAgent: true },
    toolDefinitions: [{ name: "calculate_route", schema: { type: "object", properties: {}, additionalProperties: false } }],
    toolMessages: [
      { role: "assistant", tool_calls: [{ id: "search-1", type: "function", function: { name: "search_locations", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "search-1", content: JSON.stringify({ verified: true, latitude: 31.5, longitude: 74.3 }) },
    ],
  });

  assert.equal(result.provider, "xai");
  assert.equal(result.toolCalls[0].name, "calculate_route");
  assert.equal(requests[1].url, "https://api.x.ai/v1/chat/completions");
  assert.equal(requests[1].headers.Authorization, "Bearer xai-test");
  assert.equal(requests[1].body.tool_choice, "auto");
  assert.equal(requests[1].body.messages.some((message) => message.role === "tool" && message.tool_call_id === "search-1"), true);
});
