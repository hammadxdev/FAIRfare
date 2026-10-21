const request = require("supertest");
const fs = require("fs");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
const { extractTripLocations } = require("../services/tripExtraction.service");

const outputLog = console.log;
console.log = (...args) => {
  const first = String(args[0] || "");
  if (!/^\[(HTTP|maps|AI)\]/.test(first)) outputLog(...args);
};

function compactTrip(trip) {
  if (!trip) return null;
  const compactLocation = (location) => location ? { query: location.query, name: location.name, city: location.city, county: location.county, state: location.state, lat: location.lat, lng: location.lng } : null;
  return { status: trip.status, extracted: trip.extracted, pickup: compactLocation(trip.pickup), destination: compactLocation(trip.destination), pickupAmbiguous: trip.pickupAmbiguous, destinationAmbiguous: trip.destinationAmbiguous, city: trip.city, cityMismatch: trip.cityMismatch, route: trip.route ? { unavailable: trip.route.unavailable || false, distanceMeters: trip.route.distanceMeters || null, durationSeconds: trip.route.durationSeconds || null } : null, unresolved: trip.unresolved };
}

const scenarios = [
  [1, "TRIP", "ok so i wanna go from north nazimabad to gulshan e hameed phase 2"],
  [2, "TRIP", "I wanna go from Gulberg III to Lahore Garrison University"],
  [3, "TRIP", "from Liberty Market to Lahore Railway Station"],
  [4, "TRIP", "DHA Phase 6 to Johar Town"],
  [5, "TRIP", "I need to go from Saddar to the airport"],
  [6, "ROMAN_URDU", "Mujhe Gulberg se LGU jana hai."],
  [7, "ROMAN_URDU", "Yaar Bykea sasti paregi ya Yango?"],
  [8, "ROMAN_URDU", "Barish mein bike lena safe hai?"],
  [9, "ROMAN_URDU", "Mujhe railway station se Chungi jana hai."],
  [10, "ROMAN_URDU", "Office timing mein ride mehngi kyun hoti hai?"],
  [11, "FARE_PROVIDER", "Which provider is cheapest for my trip?"],
  [12, "FARE_PROVIDER", "Compare inDrive, Yango, and Bykea."],
  [13, "FARE_PROVIDER", "Is this an actual live fare?"],
  [14, "FARE_PROVIDER", "Can you guarantee the fare?"],
  [15, "FARE_PROVIDER", "Is a driver available right now?"],
  [16, "FOLLOW_UP", "What if it rains?", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [17, "FOLLOW_UP", "What about a bike?", "from Gulberg III to Lahore Garrison University"],
  [18, "FOLLOW_UP", "Which one is cheaper?", "from Liberty Market to Lahore Railway Station"],
  [19, "FOLLOW_UP", "Actually change the destination to Clifton Karachi.", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [20, "FOLLOW_UP", "Actually change the pickup to Clifton Karachi.", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [21, "CONDITIONS", "Is a weekday morning more expensive than Sunday afternoon?"],
  [22, "CONDITIONS", "How is Friday prayer-time travel usually?"],
  [23, "CONDITIONS", "What vehicle is safer in heavy rain or fog?"],
  [24, "CONDITIONS", "There is a protest and possible road closure. What should I do?"],
  [25, "CONDITIONS", "There is a major event tonight. Could demand be higher?"],
  [26, "EDGE", "I need to go from a place called Zorblax to the airport."],
  [27, "EDGE", "Take me from Gulberg to Chungi."],
  [28, "EDGE", "I explicitly want to travel from Karachi to Lahore."],
  [29, "EDGE", "In verified mode with zero approved coverage, should Fair Fare recommend a provider?"],
  [30, "EDGE", "Plan a trip from DHA Phase 6 to Johar Town and tell me what is specific about this route."],
];
const selectedIds = String(process.env.REAL_AI_EVAL_IDS || "").split(",").map((value) => value.trim()).filter(Boolean).map(Number).filter(Number.isInteger);
const selectedScenarios = selectedIds.length ? scenarios.filter(([id]) => selectedIds.includes(id)) : scenarios;

async function post(auth, message, conversationId = null) {
  const started = Date.now();
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message, ...(conversationId ? { conversationId } : {}) });
  const data = response.body?.data || {};
  const context = data.context || null;
  return { httpStatus: response.status, latencyMs: Date.now() - started, reply: data.reply || response.body?.message || response.body?.error || "", modelId: data.modelId || null, provider: data.provider || null, fallbackUsed: Boolean(data.fallbackUsed), status: data.status || null, context: context ? { ...context, trip: compactTrip(context.trip) } : null, conversationId: data.conversation?.id || conversationId || null, extracted: extractTripLocations(message) };
}

async function run() {
  const auth = await createAuthenticatedTestUser(app, "Real AI Evaluation User");
  const results = [];
  for (const [id, category, message, setupMessage] of selectedScenarios) {
    let conversationId = null;
    const setup = [];
    if (setupMessage) {
      const initial = await post(auth, setupMessage);
      conversationId = initial.conversationId;
      setup.push({ message: setupMessage, ...initial });
    }
    const previousMode = process.env.FAIR_FARE_DATASET_MODE;
    if (id === 29) process.env.FAIR_FARE_DATASET_MODE = "verified";
    const result = await post(auth, message, conversationId);
    process.env.FAIR_FARE_DATASET_MODE = previousMode;
    results.push({ scenarioId: id, category, exactUserMessage: message, setup, ...result, geoapifyCalled: Boolean(result.extracted.pickup && result.extracted.destination), authoritativeFareAvailable: Boolean(result.context?.comparisonUsed), tripContext: result.context?.trip || null });
  }
  const evaluation = { config: { realModelEnabled: String(process.env.AI_ASSISTANT_ENABLED).toLowerCase() === "true", primaryProvider: process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || null, groqPrimaryModel: process.env.GROQ_MODEL || null, groqFallbackModel: process.env.GROQ_FALLBACK_MODEL || null, fallbackEnabled: String(process.env.AI_MODEL_FALLBACK_ENABLED).toLowerCase() === "true" }, results };
  fs.writeFileSync(process.env.REAL_AI_EVAL_OUTPUT || "AI_MODEL_EVALUATION_RAW.json", JSON.stringify(evaluation, null, 2));
  console.log(JSON.stringify(evaluation));
}

run().catch((error) => { console.error(JSON.stringify({ error: error.code || error.message })); process.exitCode = 1; });
