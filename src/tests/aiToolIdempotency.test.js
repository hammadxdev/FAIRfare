const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { executeToolCalls } = require("../services/ai/toolExecutor.service");
const registry = require("../services/ai/toolRegistry");

test.afterEach(() => registry.resetToolDependenciesForTests());

test("migration defines a unique durable request-run key", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/014_ai_tool_execution_context.sql"), "utf8");
  assert.match(sql, /UNIQUE\s*\(user_id, conversation_id, client_message_id\)/i);
  assert.match(sql, /UNCERTAIN/);
});

test("same tool call is suppressed within one execution request", async () => {
  let calls = 0;
  registry.setToolDependenciesForTests({ providers: { getProviderStatus: async () => { calls += 1; return []; } } });
  const result = await executeToolCalls([{ name: "get_provider_status", arguments: {} }, { name: "get_provider_status", arguments: {} }], { userId: "owner", clientMessageId: "message-1", deadlineAt: Date.now() + 1000 });
  assert.equal(calls, 1);
  assert.equal(result.results[1].error.code, "DUPLICATE_TOOL_CALL");
});
