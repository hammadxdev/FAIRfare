const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../services/ai/toolRegistry");
const { executeToolCall, executeToolCalls } = require("../services/ai/toolExecutor.service");

test.afterEach(() => registry.resetToolDependenciesForTests());

test("executes an allowlisted tool with server-owned user context", async () => {
  let seenUser;
  registry.setToolDependenciesForTests({ getHistory: async ({ userId }) => { seenUser = userId; return []; } });
  const result = await executeToolCall({ name: "get_latest_comparison", arguments: { comparisonId: null, includeHistorical: true, userId: "attacker" } }, { userId: "user-1", deadlineAt: Date.now() + 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_TOOL_ARGUMENTS");
  assert.equal(seenUser, undefined);
});

test("rejects duplicate and excessive tool calls", async () => {
  const calls = [{ name: "get_provider_status", arguments: { provider: "a" } }, { name: "get_provider_status", arguments: { provider: "b" } }, { name: "get_provider_status", arguments: { provider: "c" } }, { name: "get_provider_status", arguments: { provider: "d" } }];
  registry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => [] } });
  const result = await executeToolCalls(calls, { userId: "user-1", deadlineAt: Date.now() + 1000 });
  assert.equal(result.results[3].error.code, "TOOL_CALL_LIMIT");
  const duplicate = await executeToolCalls([{ name: "get_provider_status", arguments: { provider: "a" } }, { name: "get_provider_status", arguments: { provider: "a" } }], { userId: "user-1", deadlineAt: Date.now() + 1000 });
  assert.equal(duplicate.results[1].error.code, "DUPLICATE_TOOL_CALL");
});

test("enforces live comparison intent and feature flag at execution time", async () => {
  registry.setToolDependenciesForTests({ compareFares: async () => ({ results: [] }) });
  const result = await executeToolCall({ name: "compare_live_fares", arguments: { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null }, explicitComparisonIntent: true } }, { userId: "user-1", explicitComparisonIntent: true, liveComparisonEnabled: false, deadlineAt: Date.now() + 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "LIVE_COMPARISON_DISABLED");
});
