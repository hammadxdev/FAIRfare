const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../services/tripAwareAiAssistant.service");

test("semantic fallback response does not reference a block-scoped variable", async () => {
  const previous = process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED;
  process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED = "false";
  assistant.setTripResolverForTests(async () => ({ status: "UNRESOLVED", extracted: { pickup: "Campus", destination: "City Centre" }, unresolved: "destination" }));
  try {
    const result = await assistant.answer({ message: "from campus to city centre", userId: null, conversationId: null });
    assert.equal(result.available, true);
    assert.match(result.reply, /destination/i);
    assert.equal(result.context.semanticUnderstanding, null);
  } finally {
    assistant.setTripResolverForTests();
    if (previous === undefined) delete process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED;
    else process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED = previous;
  }
});
