const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../services/ai/modelRegistry");
const llm = require("../services/ai/llmClient");

test("AI registry contains explicit backend candidates and no secrets", () => {
  assert.equal(registry.MODELS.length, 5);
  assert.equal(registry.isAllowlisted("google/gemma-4-31b-it:free"), true);
  assert.equal(registry.isAllowlisted("not-a-real-model"), false);
  assert.equal(Object.values(registry.MODELS).some((model) => Object.keys(model).some((key) => /key|secret|token/i.test(key))), false);
});

test("invalid configured default and fallbacks are rejected", () => {
  assert.throws(() => registry.validateConfiguredModels({ AI_MODEL: "not-allowlisted" }), /not allowlisted/);
  assert.throws(() => registry.validateConfiguredModels({ AI_MODEL: registry.MODELS[0].id, AI_MODEL_FALLBACK_ENABLED: "true", AI_MODEL_FALLBACKS: "bad-model" }), /not allowlisted/);
});

test("default selection is deterministic and fallback is opt-in and bounded", () => {
  assert.equal(registry.configuredModel({}).toString(), "inclusionai/ling-3.0-flash-fin:free");
  assert.deepEqual(registry.parseFallbacks({ AI_MODEL_FALLBACKS: "a,b", AI_MODEL_FALLBACK_ENABLED: "false" }), []);
  assert.deepEqual(registry.parseFallbacks({ AI_MODEL_FALLBACKS: "a,b,a", AI_MODEL_FALLBACK_ENABLED: "true" }), ["a", "b"]);
  assert.equal(llm.isFallbackEligible("LLM_AUTH_ERROR"), false);
  assert.equal(llm.isFallbackEligible("LLM_RATE_LIMIT"), true);
  assert.equal(llm.MAX_FALLBACK_ATTEMPTS, 3);
});
