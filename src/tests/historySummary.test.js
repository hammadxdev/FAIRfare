const test = require("node:test");
const assert = require("node:assert/strict");
const { historySummary } = require("../services/history.service");

test("history summary keeps list fields and removes heavyweight quote details", () => {
  const item = {
    id: "comparison-1",
    pickup: { label: "LGU" },
    quotes: [{
      provider: "Yango",
      providerId: "quickride",
      providerDisplayName: "Yango",
      category: "Economy",
      fare: 720,
      currency: "PKR",
      availability: "available",
      sourceType: "actual_provider",
      quoteFreshness: "fresh",
      serviceMetadata: { large: "payload" },
      prediction: { fare: 700 },
      recommendation: { rank: 1 },
    }],
  };

  const summary = historySummary(item);
  assert.equal(summary.id, "comparison-1");
  assert.equal(summary.pickup.label, "LGU");
  assert.deepEqual(summary.quotes, [{
    provider: "Yango",
    providerId: "quickride",
    providerDisplayName: "Yango",
    category: "Economy",
    fare: 720,
    currency: "PKR",
    availability: "available",
    sourceType: "actual_provider",
    quoteFreshness: "fresh",
  }]);
  assert.equal("serviceMetadata" in summary.quotes[0], false);
});
