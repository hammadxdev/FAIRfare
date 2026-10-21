const test = require("node:test");
const assert = require("node:assert/strict");
const memory = require("../services/ai/conversationMemory.service");
const { parseServiceQuestion } = require("../services/ai/serviceIdentityResolver.service");

test("follow-up reference resolution prefers explicit then current context then latest authorized reference", async () => {
  const authorized = new Set(["current", "latest"]);
  memory.setHistoryReaderForTests({ getHistoryById: async (comparisonId) => authorized.has(comparisonId) ? { id: comparisonId } : null });
  const current = await memory.resolveComparisonReference({ userId: "user-1", memory: { context: { current_comparison_id: "current" }, comparisonRefs: [{ comparison_id: "latest" }] } });
  assert.equal(current, "current");
  const explicit = await memory.resolveComparisonReference({ userId: "user-1", explicitComparisonId: "latest", memory: { context: { current_comparison_id: "current" } } });
  assert.equal(explicit, "latest");
  const denied = await memory.resolveComparisonReference({ userId: "user-2", explicitComparisonId: "other", memory: { context: { current_comparison_id: "current" } } });
  assert.equal(denied, null);
  memory.resetMemoryDependenciesForTests();
});

test("summary memory supports follow-ups beyond the twelve-message recent window", async () => {
  const oldMessages = Array.from({ length: 13 }, (_, index) => ({ role: "USER", content: `Older question ${index}` }));
  oldMessages[4] = { role: "USER", content: "What was service 47?" };
  const summary = memory.conservativeSummary(oldMessages);
  assert.match(summary, /47/);
  assert.match(summary, /service_identity/);
  memory.setHistoryReaderForTests({ getHistoryById: async (comparisonId) => comparisonId === "comparison-1" ? { id: comparisonId } : null });
  const selected = await memory.resolveComparisonReference({ userId: "user-1", memory: { summaries: [{ summary_text: summary }], comparisonRefs: [{ comparison_id: "comparison-1" }] } });
  assert.equal(selected, "comparison-1");
  memory.resetMemoryDependenciesForTests();
});

test("summary text is never treated as proof of a service identity", () => {
  const parsed = parseServiceQuestion("Iska fare kitna tha?", [{ role: "SYSTEM_MEMORY", content: "Referenced service 47; identity must be verified from an authorized comparison." }]);
  assert.equal(parsed.serviceCode, "47");
  assert.equal(parsed.isFollowUp, true);
});

test("ambiguous references remain unresolved instead of choosing an arbitrary comparison", async () => {
  memory.setHistoryReaderForTests({ getHistoryById: async (comparisonId) => ({ id: comparisonId }) });
  const selected = await memory.resolveComparisonReference({ userId: "user-1", memory: { comparisonRefs: [{ comparison_id: "first" }, { comparison_id: "second" }] } });
  assert.equal(selected, null);
  memory.resetMemoryDependenciesForTests();
});
