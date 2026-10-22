const test = require("node:test");
const assert = require("node:assert/strict");
const { understand } = require("../services/ai/semanticUnderstanding.service");

function client(value, field = "text") {
  return { completeDetailed: async () => ({ [field]: value, modelId: "test", provider: "test" }) };
}

test("accepts valid structured semantic JSON", async () => {
  const result = await understand({ llmClient: client(JSON.stringify({ scope: "in_scope", intent: "route", pickup: { query: "campus" }, destination: { query: "city centre" }, replyLanguage: "english" })), message: "from campus to city centre" });
  assert.equal(result.ok, true);
  assert.equal(result.understanding.destination.query, "city centre");
});

test("diagnoses malformed, fenced, and alternate response fields", async () => {
  const malformed = await understand({ llmClient: client("not json"), message: "hello" });
  assert.equal(malformed.diagnostics.parseIssue, "INVALID_JSON");
  const fenced = await understand({ llmClient: client("```json\n{\"scope\":\"in_scope\",\"intent\":\"general_travel\",\"replyLanguage\":\"english\"}\n```"), message: "hello" });
  assert.equal(fenced.ok, true);
  const alternate = await understand({ llmClient: client(JSON.stringify({ scope: "in_scope", intent: "route", pickup: "A", destination: "B", replyLanguage: "english" }), "content"), message: "from A to B" });
  assert.equal(alternate.ok, true);
  assert.equal(alternate.diagnostics.contentField, "alternate");
});

test("reports invalid semantic enums without treating them as successful", async () => {
  const result = await understand({ llmClient: client(JSON.stringify({ scope: "travel", intent: "ride", pickup: "A", destination: "B" })), message: "from A to B" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.understanding.validationIssues, ["scope", "intent"]);
});
