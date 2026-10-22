const test = require("node:test");
const assert = require("node:assert/strict");
const { extractTripLocations } = require("../services/tripExtraction.service");
const { resolveTripForAssistant } = require("../services/tripResolution.service");
const { routeDecisionResponse } = require("../services/tripAwareAiAssistant.service");
const { DECISIONS } = require("../services/ai/groundingDecision.service");

test("preserves both endpoints for natural fare requests", () => {
  for (const message of ["Compare current car fares from LGU to Saddar", "LGU se Saddar jana hai", "Saddar from LGU"]) {
    const extracted = extractTripLocations(message);
    assert.equal(extracted.pickup, "LGU");
    assert.equal(extracted.destination, "Saddar");
  }
});

test("reports ambiguous destination separately from missing destination", () => {
  const reply = routeDecisionResponse({ trip: { status: "UNRESOLVED", extracted: { pickup: "LGU", destination: "Saddar" }, unresolved: "destination", unresolvedReason: "AMBIGUOUS" }, decision: DECISIONS.LOCATION_UNRESOLVED, message: "Compare fares from LGU to Saddar" }).reply;
  assert.match(reply, /multiple matches/i);
});

test("reports map lookup failure without discarding the named destination", async () => {
  const result = await resolveTripForAssistant({ message: "from LGU to Saddar", geocode: async ({ input }) => input === "LGU" ? [{ name: "LGU", city: "Lahore", county: "Lahore District", lat: 31.46, lng: 74.44 }] : [], route: async () => ({ distanceMeters: 1, durationSeconds: 1 }) });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.extracted.destination, "Saddar");
  assert.equal(result.unresolvedReason, "NOT_FOUND");
  assert.match(routeDecisionResponse({ trip: result, decision: DECISIONS.LOCATION_UNRESOLVED, message: "Compare fares from LGU to Saddar" }).reply, /couldn't verify Saddar/i);
});
