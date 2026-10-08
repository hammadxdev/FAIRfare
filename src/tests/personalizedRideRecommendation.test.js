const test = require("node:test");
const assert = require("node:assert/strict");
const { rankPersonalizedRides, PRIORITY_WEIGHTS } = require("../services/personalizedRideRecommendation.service");

function ride(provider, fare, vehicleType = "RICKSHAW", etaMin = 10) {
  return {
    provider: { id: provider, name: provider, displayName: provider },
    fare,
    etaMin,
    isAvailable: fare != null,
    quotes: [{ categoryId: vehicleType, categoryName: vehicleType, fare, pickupEtaSeconds: etaMin == null ? null : etaMin * 60 }],
  };
}

function preferences(overrides = {}) {
  return { preferredVehicleType: null, avoidedVehicleTypes: [], typicalBudget: null, ridePriority: "BALANCED", ...overrides };
}

test("preferred vehicle receives a meaningful advantage and factual reason", () => {
  const results = rankPersonalizedRides({
    results: [ride("cheap", 300, "BIKE"), ride("preferred", 400, "RICKSHAW")],
    preferences: preferences({ preferredVehicleType: "RICKSHAW" }),
    requestedVehicleType: "rickshaw",
  });
  assert.equal(results.find((r) => r.provider.id === "preferred").personalization.preferredVehicleMatch, true);
  assert.ok(results.find((r) => r.provider.id === "preferred").personalization.reasons.includes("Matches your preferred vehicle type."));
});

test("avoided vehicle cannot win and remains visible", () => {
  const results = rankPersonalizedRides({ results: [ride("bike", 250, "BIKE"), ride("car", 550, "ECONOMY_CAR")], preferences: preferences({ avoidedVehicleTypes: ["BIKE"], ridePriority: "CHEAPEST" }), requestedVehicleType: "bike" });
  assert.equal(results.length, 2);
  assert.equal(results.find((r) => r.provider.id === "bike").personalization.eligible, false);
  assert.equal(results.find((r) => r.provider.id === "bike").personalization.isTopRecommendation, false);
  assert.equal(results.find((r) => r.provider.id === "car").personalization.isTopRecommendation, true);
});

test("budget metadata and reason use clear positive/negative difference semantics", () => {
  const results = rankPersonalizedRides({ results: [ride("within", 480), ride("over", 700)], preferences: preferences({ typicalBudget: 600 }), requestedVehicleType: "rickshaw" });
  assert.deepEqual(results.map((r) => [r.personalization.withinBudget, r.personalization.budgetDifference]), [[true, 120], [false, -100]]);
  assert.match(results[0].personalization.reasons.join(" "), /600 typical budget/);
  assert.doesNotMatch(results[1].personalization.reasons.join(" "), /budget/);
});

test("CHEAPEST prioritizes fare but never crosses an avoided vehicle", () => {
  const results = rankPersonalizedRides({ results: [ride("cheap", 250, "BIKE"), ride("preferred", 400, "RICKSHAW"), ride("expensive", 550, "ECONOMY_CAR")], preferences: preferences({ ridePriority: "CHEAPEST", avoidedVehicleTypes: ["BIKE"] }), requestedVehicleType: "rickshaw" });
  assert.equal(results.find((r) => r.personalization.isTopRecommendation).provider.id, "preferred");
  assert.ok(PRIORITY_WEIGHTS.CHEAPEST.fare > PRIORITY_WEIGHTS.CHEAPEST.eta);
});

test("FASTEST_PICKUP prioritizes lower ETA", () => {
  const results = rankPersonalizedRides({ results: [ride("fast", 550, "RICKSHAW", 5), ride("cheap", 250, "RICKSHAW", 20)], preferences: preferences({ ridePriority: "FASTEST_PICKUP" }), requestedVehicleType: "rickshaw" });
  assert.equal(results.find((r) => r.personalization.isTopRecommendation).provider.id, "fast");
  assert.ok(results.find((r) => r.provider.id === "fast").personalization.reasons.some((reason) => /faster unverified simulated pickup estimate/.test(reason)));
});

test("BALANCED uses fare, ETA, preference and budget without black-box values", () => {
  const results = rankPersonalizedRides({ results: [ride("balanced", 450, "RICKSHAW", 10), ride("cheap", 400, "BIKE", 30)], preferences: preferences({ preferredVehicleType: "RICKSHAW", typicalBudget: 500 }), requestedVehicleType: "rickshaw" });
  assert.equal(results.find((r) => r.personalization.isTopRecommendation).provider.id, "balanced");
  assert.equal(typeof results[0].personalization.score, "number");
});

test("missing ETA never becomes zero and all missing ETAs are safe", () => {
  const partial = rankPersonalizedRides({ results: [ride("missing", 300, "RICKSHAW", null), ride("known", 500, "RICKSHAW", 12)], preferences: preferences({ ridePriority: "FASTEST_PICKUP" }), requestedVehicleType: "rickshaw" });
  assert.equal(partial.find((r) => r.provider.id === "missing").personalization.reasons.some((reason) => /faster pickup/.test(reason)), false);
  const allMissing = rankPersonalizedRides({ results: [ride("a", 300, "RICKSHAW", null), ride("b", 500, "RICKSHAW", null)], preferences: preferences({ ridePriority: "FASTEST_PICKUP" }), requestedVehicleType: "rickshaw" });
  assert.equal(allMissing.filter((r) => r.personalization.isTopRecommendation).length, 1);
});

test("defaults work, all avoided yields no winner, and invalid fares cannot win", () => {
  const defaults = rankPersonalizedRides({ results: [ride("a", 300), ride("b", 350)], preferences: {}, requestedVehicleType: "rickshaw" });
  assert.equal(defaults.filter((r) => r.personalization.isTopRecommendation).length, 1);
  const none = rankPersonalizedRides({ results: [ride("a", 300, "BIKE"), ride("b", 350, "BIKE")], preferences: preferences({ avoidedVehicleTypes: ["BIKE"] }), requestedVehicleType: "bike" });
  assert.equal(none.filter((r) => r.personalization.isTopRecommendation).length, 0);
  const invalid = rankPersonalizedRides({ results: [ride("invalid", NaN), ride("valid", 500)], preferences: {}, requestedVehicleType: "rickshaw" });
  assert.equal(invalid.find((r) => r.provider.id === "invalid").personalization.eligible, false);
  assert.equal(invalid.find((r) => r.provider.id === "valid").personalization.isTopRecommendation, true);
});

test("tie-breaking is deterministic and exactly one winner is marked", () => {
  const input = [ride("z-provider", 400, "RICKSHAW", 10), ride("a-provider", 400, "RICKSHAW", 10)];
  const first = rankPersonalizedRides({ results: input, preferences: {}, requestedVehicleType: "rickshaw" });
  const second = rankPersonalizedRides({ results: [...input].reverse(), preferences: {}, requestedVehicleType: "rickshaw" });
  assert.equal(first.filter((r) => r.personalization.isTopRecommendation).length, 1);
  assert.equal(second.filter((r) => r.personalization.isTopRecommendation).length, 1);
  assert.equal(first.find((r) => r.personalization.isTopRecommendation).provider.id, "a-provider");
  assert.equal(second.find((r) => r.personalization.isTopRecommendation).provider.id, "a-provider");
});
