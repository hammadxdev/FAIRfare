const test = require("node:test");
const assert = require("node:assert/strict");
const memory = require("../services/ai/conversationMemory.service");

test("conservative summary preserves user references without promoting assistant guesses", () => {
  const summary = memory.conservativeSummary([
    { role: "USER", content: "Service 47 ka fare kitna tha?" },
    { role: "ASSISTANT", content: "Service 47 is definitely a bike and the fare is live." },
    { role: "USER", content: "Why was Yango unavailable?" },
  ]);
  assert.match(summary, /service_identity/);
  assert.match(summary, /47/);
  assert.match(summary, /yango/);
  assert.doesNotMatch(summary, /definitely a bike|fare is live/i);
  assert.match(summary, /must be verified/i);
});

test("summary save records an exact message boundary and rejects stale duplicate versions", async () => {
  const calls = [];
  memory.setQueryForTests(async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO ai_conversation_summaries/i.test(sql)) return { rows: [{ id: "summary-1", summary_version: 1, covered_through_message_id: "message-12" }] };
    return { rows: [] };
  });
  const saved = await memory.saveSummary({ userId: "user-1", conversationId: "conversation-1", messages: [{ role: "USER", content: "Service 47 kya hai?" }], coveredThroughMessageId: "message-12", coveredThroughCreatedAt: "2026-01-01T00:00:00Z", summaryVersion: 1 });
  assert.equal(saved.covered_through_message_id, "message-12");
  assert.match(calls[0].sql, /WHERE EXISTS.*ai_conversations/s);
  assert.match(calls[0].sql, /ON CONFLICT.*DO NOTHING/s);
  memory.resetMemoryDependenciesForTests();
});

test("comparison references require authorized history ownership", async () => {
  memory.setHistoryReaderForTests({ getHistoryById: async (comparisonId, userId) => comparisonId === "owned" && userId === "user-1" ? { id: comparisonId } : null });
  let called = false;
  memory.setQueryForTests(async (sql) => { called = true; return { rows: [{ id: "ref-1", comparison_id: "owned" }] }; });
  const owned = await memory.addComparisonReference({ userId: "user-1", conversationId: "conversation-1", comparisonId: "owned" });
  assert.equal(owned.comparison_id, "owned");
  const denied = await memory.addComparisonReference({ userId: "user-2", conversationId: "conversation-1", comparisonId: "owned" });
  assert.equal(denied.status, "COMPARISON_NOT_FOUND");
  assert.equal(called, true);
  memory.resetMemoryDependenciesForTests();
});

test("memory reads are scoped to user and conversation and exclude expired context", async () => {
  const sqls = [];
  memory.setQueryForTests(async (sql) => {
    sqls.push(sql);
    if (/ai_conversation_context/i.test(sql)) return { rows: [{ conversation_id: "conversation-1", user_id: "user-1" }] };
    if (/ai_conversation_summaries/i.test(sql)) return { rows: [{ summary_text: "summary" }] };
    return { rows: [{ comparison_id: "comparison-1" }] };
  });
  const result = await memory.getMemory({ userId: "user-1", conversationId: "conversation-1" });
  assert.equal(result.context.user_id, "user-1");
  assert.equal(result.summaries.length, 1);
  assert.equal(result.comparisonRefs.length, 1);
  assert.equal(sqls.every((sql) => /user_id=\$2|user_id=\$1/.test(sql)), true);
  assert.ok(sqls[0].includes("expires_at > now()") || sqls[0].includes("expires_at IS NULL"));
  memory.resetMemoryDependenciesForTests();
});

test("context rejects a missing comparison and does not write it", async () => {
  memory.setHistoryReaderForTests({ getHistoryById: async () => null });
  let called = false;
  memory.setQueryForTests(async () => { called = true; return { rows: [] }; });
  const result = await memory.saveContext({ userId: "user-1", conversationId: "conversation-1", currentComparisonId: "missing" });
  assert.equal(result.status, "COMPARISON_NOT_FOUND");
  assert.equal(called, false);
  memory.resetMemoryDependenciesForTests();
});
