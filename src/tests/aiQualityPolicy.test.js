const test = require("node:test");
const assert = require("node:assert/strict");
const { responsePolicy, safeConditionReply } = require("../services/qualityAwareAssistant.service");

test("quality policy preserves Roman Urdu and blocks unsupported current claims", () => {
  const policy = responsePolicy("Barish mein bike lena safe hai?");
  assert.equal(policy.language, "roman_urdu");
  assert.equal(policy.maxSentences, 4);
  assert.equal(policy.noUnverifiedCurrentClaims, true);
  assert.equal(policy.doNotAssumeCity, true);
  assert.equal(policy.doNotInventLiveTrafficWeatherEvents, true);
});

test("quality policy keeps English inputs in English", () => {
  assert.equal(responsePolicy("Can you guarantee the fare?").language, "english");
});

test("condition guard removes unsupported live-city claims", () => {
  assert.match(safeConditionReply("How is Friday prayer-time travel usually?", "roman_urdu", false), /live traffic/i);
  assert.match(safeConditionReply("There is a protest and possible road closure.", "english", false), /verified live source/i);
  assert.match(safeConditionReply("There is a major event tonight.", "english", false), /verified live demand/i);
  assert.equal(safeConditionReply("What if it rains?", "english", { hasAuthoritativeContext: true }), null);
  assert.match(safeConditionReply("What if it rains?", "english", { conversationTrip: { pickup: "North Nazimabad", destination: "Gulshan e Hameed Phase 2" } }), /exact delay/);
});
