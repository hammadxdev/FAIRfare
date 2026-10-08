const test = require("node:test");
const assert = require("node:assert/strict");
const { retrieveFairFareKnowledge } = require("../services/ai/fairFareKnowledge.service");

test("knowledge retrieval is bounded and excludes unrelated entries", () => {
  const entries = [
    { topic: "ETA", question: "What is ETA?", answer: "Fair Fare does not currently have live driver pickup times. You can check availability in the provider's app.", keywords: "eta pickup" },
    { topic: "Weather", question: "Why can fares change?", answer: "Weather can affect current estimates.", keywords: "weather fare" },
    { topic: "Secrets", question: "Token", answer: "should not match", keywords: "credentials" },
    { topic: "Product", question: "Safe row", answer: "private", apiKey: "must never be sent" },
    { topic: "Other", question: "Unrelated", answer: "not relevant", keywords: "unrelated" },
  ];
  const result = retrieveFairFareKnowledge("What does ETA mean?", entries);
  assert.deepEqual(result, [{ topic: "ETA", question: "What is ETA?", answer: "Fair Fare does not currently have live driver pickup times. You can check availability in the provider's app." }]);
});

test("knowledge retrieval returns no invented facts when no source is loaded", () => {
  assert.deepEqual(retrieveFairFareKnowledge("How does Fair Fare work?"), []);
});
