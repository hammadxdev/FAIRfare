const test = require("node:test");
const assert = require("node:assert/strict");
const { DECISIONS, decideGrounding, routeMatchesComparison } = require("../services/ai/groundingDecision.service");
const { extractTripLocations } = require("../services/tripExtraction.service");
const { routeDecisionResponse, setComparisonBuilderForTests, setTripResolverForTests, answer } = require("../services/tripAwareAiAssistant.service");
const { rememberComparison, clearComparisonsForTests } = require("../services/currentComparison.service");

const oldComparison = {
  comparisonId: "old-comparison",
  pickup: { name: "DHA Phase 6", lat: 31.47, lng: 74.41, placeId: "dha-6" },
  dropoff: { name: "LGU", lat: 31.46, lng: 74.44, placeId: "lgu" },
  vehicleType: "bike",
  results: [{ provider: { name: "indrive" }, quotes: [{ categoryId: "bike", categoryName: "Moto", fare: 101, source: "live", dataSource: "REAL", isAvailable: true }] }],
};

test("correction phrases become route endpoint changes", () => {
  assert.deepEqual(extractTripLocations("No just the Punjab Mall"), { pickup: null, destination: "Punjab Mall", pattern: "change_destination" });
  assert.deepEqual(extractTripLocations("Actually from LGU"), { pickup: "LGU", destination: null, pattern: "change_pickup" });
  assert.deepEqual(extractTripLocations("Change destination to DHA Phase 6"), { pickup: null, destination: "DHA Phase 6", pattern: "change_destination" });
});

test("comparison matching requires pickup and destination identity, not similar text", () => {
  const matchingTrip = { pickup: { placeId: "dha-6", lat: 31.47, lng: 74.41 }, destination: { placeId: "lgu", lat: 31.46, lng: 74.44 } };
  const changedTrip = { pickup: { placeId: "lgu", lat: 31.46, lng: 74.44 }, destination: { placeId: "punjab-mall", lat: 31.55, lng: 74.35 } };
  assert.equal(routeMatchesComparison(matchingTrip, oldComparison), true);
  assert.equal(routeMatchesComparison(changedTrip, oldComparison), false);
  assert.equal(decideGrounding({ trip: matchingTrip, comparison: oldComparison }).decision, DECISIONS.MATCHED_COMPARISON);
  assert.equal(decideGrounding({ trip: changedTrip, comparison: oldComparison }).decision, DECISIONS.ROUTE_CHANGED);
});

test("stale matching comparison cannot be reused as current grounding", () => {
  const stale = { ...oldComparison, enrichmentStatus: "stale" };
  const matchingTrip = { pickup: oldComparison.pickup, destination: oldComparison.dropoff };
  assert.equal(decideGrounding({ trip: matchingTrip, comparison: stale }).decision, DECISIONS.FARES_UNAVAILABLE);
});

test("mismatched comparison returns no stale fare summary when new comparison is unavailable", async () => {
  clearComparisonsForTests();
  rememberComparison({ userId: "user-1", comparison: oldComparison });
  setTripResolverForTests(async () => ({
    status: "RESOLVED",
    extracted: { pickup: "LGU", destination: "Punjab Mall" },
    pickup: { name: "Lahore Garrison University", placeId: "lgu", lat: 31.46, lng: 74.44 },
    destination: { name: "Punjab Mall", placeId: "punjab-mall", lat: 31.55, lng: 74.35 },
    route: { distanceMeters: 12000, durationSeconds: 1800 },
  }));
  setComparisonBuilderForTests(async () => { throw Object.assign(new Error("provider unavailable"), { code: "PROVIDER_UNAVAILABLE" }); });
  const result = await answer({ userId: "user-1", message: "I want to go from LGU to Punjab Mall", comparisonId: "old-comparison" });
  assert.equal(result.groundingDecision, DECISIONS.FARES_UNAVAILABLE);
  assert.doesNotMatch(result.reply, /PKR\s*101|Moto|DHA Phase 6|current fare comparison/i);
  assert.match(result.reply, /previous comparison does not apply|purani comparison/i);
  setComparisonBuilderForTests(undefined);
  setTripResolverForTests(undefined);
  clearComparisonsForTests();
});

test("route clarification response is deterministic and contains no prices", () => {
  const result = routeDecisionResponse({ trip: { status: "UNRESOLVED", unresolved: "destination" }, decision: DECISIONS.LOCATION_UNRESOLVED, message: "No just Punjab Mall" });
  assert.equal(result.groundingDecision, DECISIONS.LOCATION_UNRESOLVED);
  assert.doesNotMatch(result.reply, /PKR|Rs\.?\s*\d+|\b\d+\s*minutes?/i);
});
