const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../services/ai/toolRegistry");
const { executeToolCall } = require("../services/ai/toolExecutor.service");

test.afterEach(() => registry.resetToolDependenciesForTests());

test("comparison lookup uses authenticated server context only", async () => {
  let received;
  registry.setToolDependenciesForTests({ getPersistedComparisonForUser: async (id, userId) => { received = { id, userId }; return null; } });
  const result = await executeToolCall({ name: "get_latest_comparison", arguments: { comparisonId: "comparison-1", includeHistorical: true } }, { userId: "owner", deadlineAt: Date.now() + 1000 });
  assert.equal(result.ok, true);
  assert.deepEqual(received, { id: "comparison-1", userId: "owner" });
});

test("knowledge tool is unavailable before Phase 3", async () => {
  const result = await executeToolCall({ name: "search_fairride_knowledge", arguments: { query: "fare policy" } }, { userId: "owner", deadlineAt: Date.now() + 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TOOL_DISABLED");
});
