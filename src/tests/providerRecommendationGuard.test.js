const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalProviderId,
  providerDisplayName,
} = require("../providers/provider.registry");
const guard = require("../services/providerRecommendationGuard.service");

test("canonical provider IDs retain legacy IDs and public names", () => {
  assert.equal(canonicalProviderId("inDrive"), "indrive");
  assert.equal(canonicalProviderId("Yango"), "quickride");
  assert.equal(canonicalProviderId("Bykea"), "urbancab");
  assert.equal(providerDisplayName("quickride"), "Yango");
  assert.equal(providerDisplayName("urbancab"), "Bykea");
});

test("unsupported provider recommendation is replaced with a supported-only response", () => {
  const result = guard.enforce({
    message: "Which ride should I take?",
    text: "Use Uber because it is the best option.",
    responseLanguage: "english",
  });
  assert.equal(result.violated, true);
  assert.deepEqual(result.unsupportedProviders, ["Uber"]);
  assert.match(result.text, /inDrive/);
  assert.match(result.text, /Yango/);
  assert.match(result.text, /Bykea/);
  assert.doesNotMatch(result.text, /Use Uber/);
});

test("explicit unsupported-provider question is answered as a boundary, not a recommendation", () => {
  const result = guard.enforce({
    message: "Should I take Uber or Careem?",
    text: "Fair Fare does not compare or recommend Uber or Careem.",
    responseLanguage: "english",
  });
  assert.equal(result.violated, false);
});

test("comparison output canonicalizes provider labels and drops unknown providers", () => {
  const result = guard.enforce({
    message: "Which is cheapest?",
    text: "QuickRide is cheapest.",
    comparison: {
      rides: [
        { providerId: "quickride", provider: "QuickRide", fare: 250 },
        { providerId: "urbancab", provider: "UrbanCab", fare: 300 },
        { providerId: "unknown", provider: "UnknownCo", fare: 100 },
      ],
    },
    responseLanguage: "english",
  });
  assert.equal(result.violated, false);
  assert.deepEqual(result.comparison.rides.map((ride) => ride.provider), ["Yango", "Bykea"]);
  assert.match(result.text, /Yango/);
  assert.doesNotMatch(result.text, /QuickRide|UrbanCab|UnknownCo/);
});

test("Roman Urdu unsupported-provider fallback remains bounded", () => {
  const result = guard.enforce({
    message: "Mujhe koi sasti ride recommend karo",
    text: "Careem le lo, yeh sasti hai.",
    responseLanguage: "roman_urdu",
  });
  assert.equal(result.violated, true);
  assert.match(result.text, /inDrive/);
  assert.match(result.text, /Yango/);
  assert.match(result.text, /Bykea/);
  assert.doesNotMatch(result.text, /Careem le lo/);
});

test("generic ride-hailing recommendations are rejected", () => {
  const result = guard.enforce({
    message: "I have a tight budget",
    text: "Use any generic ride-hailing service for a cheap trip.",
    responseLanguage: "english",
  });
  assert.equal(result.violated, true);
});
