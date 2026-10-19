const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGroundedComparison,
  deriveFacts,
  deterministicSummary,
  requestedVehicle,
  validateReplyAgainstGrounding,
} = require("../services/ai/fareComparisonGrounding.service");

function comparison() {
  return {
    comparisonId: "cmp-grounded",
    pickup: { name: "DHA Phase 6" },
    dropoff: { name: "LGU" },
    distanceKm: 18.8,
    durationMin: 25,
    results: [
      { provider: { id: "provider-uuid-indrive", displayName: "inDrive" }, dataSource: "REAL", quotes: [
        { categoryId: "33", categoryName: "Mini", fare: 830, priceType: "suggested", isNegotiable: true, currency: "PKR", source: "live", isAvailable: true },
        { categoryId: "2", categoryName: "Moto", fare: 259, priceType: "suggested", isNegotiable: true, currency: "PKR", source: "live", isAvailable: true },
      ] },
      { provider: { code: "yango", displayName: "Yango" }, dataSource: "REAL", quotes: [
        { categoryId: "econom", categoryName: "Economy", fare: 439, exactFare: 439, displayFare: 430, startingFare: 209, priceType: "FIXED_ROUTE_QUOTE", quoteSemantics: "provider_exact_route_quote", currency: "PKR", source: "live", isAvailable: true },
        { categoryId: "comfortplus", categoryName: "Comfort", displayFare: 550, startingFare: 230, priceType: "STARTING_PRICE_ONLY", currency: "PKR", source: "live", isAvailable: false, availabilityReason: { code: "EXACT_ROUTE_FARE_UNAVAILABLE" } },
      ] },
      { provider: { id: "bykea-uuid", displayName: "Bykea" }, status: "unavailable", quotes: [] },
    ],
  };
}

test("grounding expands UUID-backed provider results and preserves fare semantics", () => {
  const grounded = buildGroundedComparison(comparison());
  assert.deepEqual(grounded.providers.map((item) => item.provider), ["inDrive", "Yango", "Bykea"]);
  assert.equal(grounded.options.find((item) => item.categoryId === "econom").exactFare, 439);
  assert.equal(grounded.options.find((item) => item.categoryId === "econom").displayFare, 430);
  assert.equal(grounded.options.find((item) => item.categoryId === "33").priceType, "suggested");
  assert.equal(grounded.options.find((item) => item.categoryId === "33").exactFare, null);
});

test("vehicle intent ranks car and bike independently", () => {
  const grounded = buildGroundedComparison(comparison());
  assert.equal(requestedVehicle("sabse sasti car batao"), "car");
  assert.equal(requestedVehicle("cheapest bike"), "bike");
  assert.equal(deriveFacts(grounded, "sabse sasti car batao").cheapest.provider, "Yango");
  assert.equal(deriveFacts(grounded, "cheapest bike").cheapest.provider, "inDrive");
});

test("fallback is complete, labels suggested fares, and explains unavailable providers", () => {
  const grounded = buildGroundedComparison(comparison());
  const reply = deterministicSummary(grounded, "show all fares", "english");
  assert.match(reply, /inDrive:.*PKR 830.*suggested\/negotiable/);
  assert.match(reply, /Yango:.*PKR 439.*exact/);
  assert.match(reply, /Bykea: unavailable/);
  assert.match(reply, /Cheapest comparable option/);
});

test("reply validation rejects currency values not present in grounded data", () => {
  const grounded = buildGroundedComparison(comparison());
  assert.equal(validateReplyAgainstGrounding("Yango is PKR 439.", grounded), true);
  assert.equal(validateReplyAgainstGrounding("Yango is PKR 999.", grounded), false);
});

test("stale and simulated quotes are not eligible", () => {
  const data = comparison();
  data.results[0].quotes[0].dataSource = "SIMULATED";
  data.results[1].quotes[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  const grounded = buildGroundedComparison(data);
  assert.equal(grounded.options.find((item) => item.categoryId === "33").availability, "unavailable");
  assert.equal(grounded.options.find((item) => item.categoryId === "econom").availability, "unavailable");
});
