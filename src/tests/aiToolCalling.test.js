const test = require("node:test");
const assert = require("node:assert/strict");
const adapters = require("../services/ai/providerAdapters");
const registry = require("../services/ai/modelRegistry");
const toolRegistry = require("../services/ai/toolRegistry");
const { runBoundedToolAgent } = require("../services/ai/toolExecutor.service");

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
