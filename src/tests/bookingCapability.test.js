const test = require("node:test");
const assert = require("node:assert/strict");
const { FAIRFARE_POLICY } = require("../services/ai/fairFarePolicy");

test("FairFare does not claim or mutate a provider booking", () => {
  assert.equal(FAIRFARE_POLICY.bookingMutationsAllowed, false);
});
