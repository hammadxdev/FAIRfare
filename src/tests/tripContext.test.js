const test = require("node:test");
const assert = require("node:assert/strict");
const { buildConversationTripContext, detectIntent, detectVehiclePreference } = require("../services/tripContext.service");

const resolver = async ({ message }) => ({
  status: "RESOLVED",
  extracted: { pickup: message.match(/from (.+) to /i)?.[1], destination: message.match(/ to (.+)$/i)?.[1] },
  pickup: { name: "Gulberg 3", city: "Lahore", county: "Lahore District", lat: 31.5, lng: 74.3 },
  destination: { name: "Lahore Garrison University", city: "Lahore", county: "Lahore District", lat: 31.46, lng: 74.44 },
  city: "Lahore",
  cityMismatch: false,
  route: { distanceMeters: 15000, durationSeconds: 1100 },
});

test("follow-up vehicle questions reuse the previous server-resolved trip", async () => {
  const result = await buildConversationTripContext({
    message: "Bike pe kitna hoga?",
    recentMessages: [{ role: "USER", content: "Gulberg 3 se LGU jana hai" }],
    tripResolver: resolver,
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.source, "conversation_history");
  assert.equal(result.vehiclePreference, "bike");
  assert.equal(result.extracted.pickup, "Gulberg 3");
  assert.equal(result.extracted.destination, "LGU");
});

test("partial pickup and destination changes preserve the other endpoint", async () => {
  const destinationChange = await buildConversationTripContext({ message: "Destination Liberty Market kar do", recentMessages: [{ role: "USER", content: "Gulberg 3 se LGU jana hai" }], tripResolver: resolver });
  assert.equal(destinationChange.extracted.pickup, "Gulberg 3");
  assert.equal(destinationChange.extracted.destination, "Liberty Market");
  const pickupChange = await buildConversationTripContext({ message: "Pickup DHA Phase 6 kar do", recentMessages: [{ role: "USER", content: "Gulberg 3 se LGU jana hai" }], tripResolver: resolver });
  assert.equal(pickupChange.extracted.pickup, "DHA Phase 6");
  assert.equal(pickupChange.extracted.destination, "LGU");
});

test("natural correction phrases preserve the unchanged endpoint", async () => {
  const destinationChange = await buildConversationTripContext({ message: "No just the Punjab Mall", recentMessages: [{ role: "USER", content: "I wanna go from LGU to Punjab Small Society" }], tripResolver: resolver });
  assert.equal(destinationChange.extracted.pickup, "LGU");
  assert.equal(destinationChange.extracted.destination, "Punjab Mall");
  const pickupChange = await buildConversationTripContext({ message: "Actually from LGU", recentMessages: [{ role: "USER", content: "I wanna go from DHA Phase 6 to Punjab Mall" }], tripResolver: resolver });
  assert.equal(pickupChange.extracted.pickup, "LGU");
  assert.equal(pickupChange.extracted.destination, "Punjab Mall");
});

test("a new conversation does not inherit a previous conversation trip", async () => {
  const result = await buildConversationTripContext({ message: "Bike pe kitna hoga?", recentMessages: [], tripResolver: resolver });
  assert.equal(result.status, "NO_TRIP");
  assert.equal(result.vehiclePreference, "bike");
});

test("intent and vehicle detection cover Roman Urdu and English follow-ups", () => {
  assert.equal(detectIntent("Sab se sasta konsa hai?"), "fare_comparison");
  assert.equal(detectIntent("Barish ho to?"), "safety_weather");
  assert.equal(detectVehiclePreference("What about a rickshaw?"), "rickshaw");
  assert.equal(detectVehiclePreference("Bike pe kitna hoga?"), "bike");
});
