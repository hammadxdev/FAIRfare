const test = require("node:test");
const assert = require("node:assert/strict");
const { groundedReply } = require("../services/ai/llmClient");

function comparison(responseLanguage = "english") {
  return {
    responseLanguage,
    comparison: {
      route: { pickup: "Punjab Small Industries", dropoff: "Lahore Garrison", distanceKm: 12.4, durationMin: 34 },
      rides: [
        { provider: "inDrive", vehicleType: "BIKE", fare: 280, currency: "PKR", availability: "available" },
        { provider: "QuickRide", vehicleType: "RICKSHAW", fare: 360, currency: "PKR", availability: "available" },
        { provider: "UrbanCab", vehicleType: "STANDARD_CAR", fare: 620, currency: "PKR", availability: "available" },
      ],
      derivedFacts: { cheapest: { provider: "inDrive", fare: 280, currency: "PKR" }, bookWaitStatus: "BOOK_NOW" },
    },
  };
}

test("booking question with comparison stays grounded in advisory facts", () => {
  const reply = groundedReply({ text: "generic", message: "Should I book now?", context: comparison() });
  assert.match(reply, /Booking now looks reasonable/);
  assert.match(reply, /does not guarantee a future fare/);
});

test("booking and fare questions without comparison guide the user to Home", () => {
  const reply = groundedReply({ text: "generic", message: "Should I book now?", context: { responseLanguage: "english", comparison: null } });
  assert.match(reply, /select your pickup.*drop-off.*Compare Fares/i);
});

test("bike versus rickshaw and fare questions use current comparison estimates", () => {
  assert.match(groundedReply({ text: "generic", message: "Bike ya rickshaw sasta hai?", context: comparison("roman_urdu") }), /PKR 280/);
  assert.match(groundedReply({ text: "generic", message: "Kitna kiraya hoga?", context: comparison() }), /inDrive PKR 280/);
});

test("exact university route without comparison is actionable and does not invent a fare", () => {
  const reply = groundedReply({ text: "generic", message: "Mujhe Lahore Garrison University jana hai.", context: { responseLanguage: "roman_urdu", comparison: null } });
  assert.match(reply, /pickup.*drop-off.*Compare Fares/i);
  assert.doesNotMatch(reply, /PKR|fare is/);
});

test("ambiguous Lahore Garrison destination requires clarification", () => {
  const reply = groundedReply({ text: "generic", message: "Punjab Small Industries se Lahore Garrison jana hai.", context: { responseLanguage: "roman_urdu", comparison: null } });
  assert.match(reply, /University.*Club|Exact destination/i);
});

test("stale or missing comparison never becomes a live booking claim", () => {
  const reply = groundedReply({ text: "generic", message: "Which provider has live availability?", context: { responseLanguage: "english", comparison: null } });
  assert.match(reply, /live driver pickup times|provider app/i);
});

test("fare-only history snapshot does not fabricate a booking recommendation", () => {
  const reply = groundedReply({ text: "generic", message: "Should I book now?", context: {
    responseLanguage: "english",
    comparison: { freshness: "history_snapshot", rides: [{ provider: "inDrive", fare: 280, currency: "PKR", availability: "available" }], derivedFacts: { cheapest: { provider: "inDrive", fare: 280, currency: "PKR" }, bookWaitStatus: null } },
  } });
  assert.match(reply, /no valid booking recommendation signal|Fresh comparison/i);
  assert.doesNotMatch(reply, /Booking now looks reasonable|Waiting may be worth considering/);
});
