const request = require("supertest");
const fs = require("fs");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
const { extractTripLocations } = require("../services/tripExtraction.service");

const scenarios = [
  [1, "TRIP", "ok so i wanna go from north nazimabad to gulshan e hameed phase 2"],
  [2, "TRIP", "I wanna go from Gulberg III to Lahore Garrison University"],
  [3, "TRIP", "Gulberg III to Liberty Market"],
  [4, "TRIP", "DHA Phase 6 to Johar Town"],
  [5, "TRIP", "I need to go from Saddar to the airport"],
  [6, "TRIP", "Gulberg 3 se LGU jana hai"],
  [7, "TRIP", "Railway Station se Liberty jana hai"],
  [8, "TRIP", "pickup is DHA Phase 6 and drop is Johar Town"],
  [9, "TRIP", "I want to go to LGU from Gulberg III"],
  [10, "TRIP", "I explicitly want to travel from Karachi to Lahore"],
  [11, "FOLLOW_UP", "What if it rains?", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [12, "FOLLOW_UP", "Bike pe kitna hoga?", "Gulberg 3 se LGU jana hai"],
  [13, "FOLLOW_UP", "Sab se sasta konsa hai?", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [14, "FOLLOW_UP", "Destination Liberty Market kar do", "from Gulberg 3 to LGU"],
  [15, "FOLLOW_UP", "Pickup DHA Phase 6 kar do", "from Gulberg 3 to LGU"],
  [16, "FOLLOW_UP", "Aur Yango?", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [17, "FOLLOW_UP", "Should I book now or wait?", "from North Nazimabad to Gulshan e Hameed Phase 2"],
  [18, "FOLLOW_UP", "What if there is heavy fog?", "from Gulberg 3 to LGU"],
  [19, "FOLLOW_UP", "What about a rickshaw?", "from Gulberg 3 to LGU"],
  [20, "FOLLOW_UP", "How long is the route?", "from Gulberg 3 to LGU"],
  [21, "FARE_PROVIDER", "Which provider is cheapest for my trip?"],
  [22, "FARE_PROVIDER", "Compare inDrive, Yango, and Bykea."],
  [23, "FARE_PROVIDER", "Is this an actual live fare?"],
  [24, "FARE_PROVIDER", "Can you guarantee the fare?"],
  [25, "FARE_PROVIDER", "Is a driver available right now?"],
  [26, "FARE_PROVIDER", "Why can fares differ between providers?"],
  [27, "FARE_PROVIDER", "Is it reasonable to book now?"],
  [28, "FARE_PROVIDER", "What does expected fare mean?"],
  [29, "LANGUAGE", "Yaar Bykea sasti paregi ya Yango?"],
  [30, "LANGUAGE", "What vehicle is safer in heavy rain?"],
  [31, "LANGUAGE", "Mujhe bike pe Gulberg se LGU jana hai"],
  [32, "LANGUAGE", "Barish ho to bike lena safe hai?"],
  [33, "LANGUAGE", "Bike ka fare kitna hoga?"],
  [34, "LANGUAGE", "Which ride sasti hai for this route?"],
  [35, "SAFETY", "I need to go from a place called Zorblax to the airport."],
  [36, "SAFETY", "Take me from Gulberg to Chungi."],
  [37, "SAFETY", "I explicitly want to travel from Karachi to Lahore."],
  [38, "SAFETY", "In verified mode with zero approved coverage, should Fair Fare recommend a provider?"],
  [39, "SAFETY", "There is a protest and possible road closure. What should I do?"],
  [40, "SAFETY", "Plan a trip from Clifton Karachi to Liberty Market Lahore and tell me what is specific about this route."],
];

function compactTrip(trip) {
  if (!trip) return null;
  const compactLocation = (location) => location ? { query: location.query, name: location.name, city: location.city, county: location.county, approximate: location.approximate, resultType: location.resultType } : null;
  return { status: trip.status, extracted: trip.extracted, pickup: compactLocation(trip.pickup), destination: compactLocation(trip.destination), city: trip.city, cityMismatch: trip.cityMismatch, route: trip.route ? { unavailable: trip.route.unavailable || false, distanceMeters: trip.route.distanceMeters || null, durationSeconds: trip.route.durationSeconds || null } : null, unresolved: trip.unresolved, vehiclePreference: trip.vehiclePreference, intent: trip.intent };
}

async function post(auth, message, conversationId = null) {
  const started = Date.now();
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message, ...(conversationId ? { conversationId } : {}) });
  const data = response.body?.data || {};
  return { httpStatus: response.status, latencyMs: Date.now() - started, message, reply: data.reply || response.body?.message || response.body?.error || "", modelId: data.modelId || null, provider: data.provider || null, fallbackUsed: Boolean(data.fallbackUsed), status: data.status || null, context: data.context ? { ...data.context, trip: compactTrip(data.context.trip) } : null, conversationId: data.conversation?.id || conversationId || null, extracted: extractTripLocations(message) };
}

async function run() {
  const auth = await createAuthenticatedTestUser(app, "Fair Fare V3 Evaluation User");
  const results = [];
  const selectedIds = String(process.env.REAL_AI_V3_IDS || "").split(",").map((value) => value.trim()).filter(Boolean).map(Number).filter(Number.isInteger);
  const selectedScenarios = selectedIds.length ? scenarios.filter(([scenarioId]) => selectedIds.includes(scenarioId)) : scenarios;
  for (const [scenarioId, category, message, setupMessage] of selectedScenarios) {
    let conversationId = null;
    const setup = [];
    if (setupMessage) {
      const initial = await post(auth, setupMessage);
      conversationId = initial.conversationId;
      setup.push(initial);
    }
    const result = await post(auth, message, conversationId);
    results.push({ scenarioId, category, exactUserMessage: message, setup, ...result, tripContext: result.context?.trip || null, authoritativeFareAvailable: Boolean(result.context?.comparisonUsed), realModelResponse: Boolean(result.modelId), deterministicResponse: result.modelId == null && result.status === "AVAILABLE" });
  }
  const evaluation = { version: "v3", config: { realModelEnabled: String(process.env.AI_ASSISTANT_ENABLED).toLowerCase() === "true", primaryProvider: process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || null, groqPrimaryModel: process.env.GROQ_MODEL || null, groqFallbackModel: process.env.GROQ_FALLBACK_MODEL || null, fallbackEnabled: String(process.env.AI_MODEL_FALLBACK_ENABLED).toLowerCase() === "true" }, results };
  fs.writeFileSync(process.env.REAL_AI_V3_OUTPUT || "AI_MODEL_EVALUATION_V3_RAW.json", JSON.stringify(evaluation, null, 2));
  console.log(JSON.stringify({ version: evaluation.version, config: evaluation.config, count: results.length, httpFailures: results.filter((item) => item.httpStatus >= 400).length, realModelResponses: results.filter((item) => item.realModelResponse).length, deterministicResponses: results.filter((item) => item.deterministicResponse).length, fallbackResponses: results.filter((item) => item.fallbackUsed).length }));
}

run().catch((error) => { console.error(JSON.stringify({ error: error.code || error.message })); process.exitCode = 1; });
