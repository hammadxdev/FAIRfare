const test = require("node:test");
const assert = require("node:assert/strict");
const { requestBudgetMs, applyComparisonCompleteness, settledToolFallbackReply } = require("../services/ai/chatOrchestrator.service");

test("AI request budget defaults safely and stays within interactive bounds", () => {
  assert.equal(requestBudgetMs(undefined), 120000);
  assert.equal(requestBudgetMs("not-a-number"), 120000);
  assert.equal(requestBudgetMs("135000"), 120000);
  assert.equal(requestBudgetMs("90000"), 90000);
  assert.equal(requestBudgetMs("20"), 30000);
});

test("partial provider results are disclosed and never called cheapest overall", () => {
  const results = [{
    ok: true,
    name: "compare_live_fares",
    result: {
      status: "OK",
      quotes: [{ provider: "inDrive", fare: 420 }],
      diagnostics: { comparisonCompleteness: "partial" },
    },
  }];
  const reply = applyComparisonCompleteness("inDrive is the cheapest overall at PKR 420.", results, "english");
  assert.match(reply, /partial comparison/i);
  assert.match(reply, /lowest among the returned quotes/i);
  assert.doesNotMatch(reply, /cheapest overall/i);
});

test("complete comparisons are not rewritten", () => {
  const results = [{ ok: true, name: "compare_live_fares", result: { status: "OK", quotes: [], diagnostics: { comparisonCompleteness: "complete" } } }];
  assert.equal(applyComparisonCompleteness("Yango is cheapest.", results), "Yango is cheapest.");
});

test("partial comparison disclosure follows Roman Urdu response language", () => {
  const results = [{ ok: true, name: "compare_live_fares", result: { status: "OK", quotes: [{ provider: "inDrive" }], diagnostics: { comparisonCompleteness: "partial" } } }];
  const reply = applyComparisonCompleteness("inDrive overall cheapest hai.", results, "roman_urdu");
  assert.match(reply, /Yeh partial comparison hai/);
  assert.match(reply, /return hone wale quotes mein sab se kam/);
});

test("settled fare and route results survive a final model outage", () => {
  const reply = settledToolFallbackReply({
    resolvedTrip: { route: { distanceMeters: 19078, durationSeconds: 1419 } },
    toolResults: [{ name: "compare_live_fares", ok: true, result: { status: "OK", quotes: [{ provider: "Yango", currency: "PKR", fare: 510 }] } }],
  }, "english");
  assert.match(reply, /19\.1 km/);
  assert.match(reply, /Yango PKR 510/);
});
