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

test("comparison-only booking questions without comparison explain the missing context", () => {
  const reply = groundedReply({ text: "generic", message: "Should I book now?", context: { responseLanguage: "english", comparison: null } });
  assert.match(reply, /current route comparison|route and vehicle details/i);
});

test("general cheapest-time question gets a direct answer without route context", () => {
  const reply = groundedReply({ text: "generic", message: "When are rides usually cheapest?", context: { responseLanguage: "english", comparison: null } });
  assert.match(reply, /outside peak demand|peak/i);
  assert.doesNotMatch(reply, /select your pickup.*Compare Fares/i);
});

test("trip planning without comparison gives guidance rather than refusal", () => {
  const reply = groundedReply({ text: "generic", message: "I want to go from Punjab Small Society to Lahore Garrison University.", context: { responseLanguage: "english", comparison: null } });
  assert.match(reply, /budget|comfort|bike|rickshaw|car/i);
  assert.doesNotMatch(reply, /Please select your pickup.*Compare Fares/i);
});

test("Chungi to railway station route planning does not require a fare comparison", () => {
  const reply = groundedReply({ text: "generic", message: "I want to go from Chungi to railway station", context: { responseLanguage: "english", comparison: null } });
  assert.match(reply, /pickup|destination|budget|comfort|bike|rickshaw|car/i);
  assert.doesNotMatch(reply, /Please select your pickup.*Compare Fares/i);
});

test("general vehicle and surge questions do not require a comparison", () => {
  assert.match(groundedReply({ text: "generic", message: "What is surge pricing?", context: { responseLanguage: "english", comparison: null } }), /demand|price/i);
  assert.match(groundedReply({ text: "generic", message: "Which vehicle suits short trips?", context: { responseLanguage: "english", comparison: null } }), /bike|rickshaw|short trips/i);
});

test("bike versus rickshaw and fare questions use current comparison estimates", () => {
  assert.match(groundedReply({ text: "generic", message: "Bike ya rickshaw sasta hai?", context: comparison("roman_urdu") }), /PKR 280/);
  assert.match(groundedReply({ text: "generic", message: "Kitna kiraya hoga?", context: comparison() }), /inDrive PKR 280/);
});

test("exact university route without comparison is actionable and does not invent a fare", () => {
  const reply = groundedReply({ text: "generic", message: "Mujhe Lahore Garrison University jana hai.", context: { responseLanguage: "roman_urdu", comparison: null } });
  assert.match(reply, /pickup|destination|bike|rickshaw|car/i);
  assert.doesNotMatch(reply, /PKR|fare is/);
});

test("general Roman Urdu pricing question is answered without fabricated numbers", () => {
  const reply = groundedReply({ text: "generic", message: "Ride sab se sasti kab hoti hai?", context: { responseLanguage: "roman_urdu", comparison: null } });
  assert.match(reply, /off-peak|rush hour|demand/i);
  assert.doesNotMatch(reply, /PKR\s*\d/);
});

test("follow-up questions are not replaced by the no-comparison setup message", () => {
  const reply = groundedReply({
    text: "At night, demand and availability can vary, so prices may be different.",
    message: "What about at night?",
    context: {
      responseLanguage: "english",
      comparison: null,
      recentConversation: [
        { role: "USER", content: "When are rides usually cheapest?" },
        { role: "ASSISTANT", content: "Rides are often cheaper outside peak demand." },
      ],
    },
  });
  assert.match(reply, /night|demand|availability/i);
  assert.doesNotMatch(reply, /select your pickup.*Compare Fares/i);
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
