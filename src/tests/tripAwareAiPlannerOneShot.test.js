const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../services/tripAwareAiAssistant.service");
const observations = require("../services/fareObservation.service");

const message = "Kal 9 baje DHA Phase 5 Lahore se Allama Iqbal International Airport jana hai. Yango, Bykea aur inDrive ka estimated fare batao aur sasta time bhi.";
const original = { route: process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED, forecast: process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED, history: process.env.FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED };
test.afterEach(() => { assistant.setTripResolverForTests(); observations.resetQueryForTests(); for (const [key, value] of Object.entries({ FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED: original.route, FAIRFARE_AI_FARE_FORECAST_ENABLED: original.forecast, FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED: original.history })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test("one-shot planner resolves route and returns isolated provider forecasts without live calls", async () => {
  process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED = "true"; process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED = "true"; process.env.FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED = "true";
  let queryCount = 0;
  assistant.setTripResolverForTests(async () => ({ status: "RESOLVED", city: "Lahore", pickup: { name: "DHA Phase 5 Lahore", placeId: "p1", lat: 31.45, lng: 74.4 }, destination: { name: "Allama Iqbal International Airport", placeId: "p2", lat: 31.52, lng: 74.4 }, route: { distanceMeters: 18000, durationSeconds: 2400 } }));
  observations.setQueryForTests(async (_sql, params) => { queryCount += 1; const providerId = params[0]; return { rows: [300, 320, 340, 360, 380].map((fare, index) => ({ provider_id: providerId, normalized_category: "car", provider_category: "car", pickup_zone: "Lahore", destination_zone: "Lahore", fare, currency: "PKR", observed_at: `2026-10-${String(10 + index).padStart(2, "0")}T04:00:00.000Z`, hour_of_day: 9, day_of_week: 3, distance_meters: 18000, duration_seconds: 2400, data_source: "REAL" })) }; });
  const result = await assistant.oneShotFuturePlan({ args: { userId: "user-1", conversationId: "conversation-1" }, plan: require("../services/ai/tripPlanner.service").planTrip({ message, requestTimestamp: "2026-10-21T00:00:00.000Z" }), message });
  assert.equal(result.status, "READY"); assert.equal(result.route.verified, true); assert.equal(result.estimates.length, 3); assert.equal(queryCount, 3); assert.equal(result.booking.created, false); assert.ok(result.estimates.every((item) => item.sourceType === "forecast"));
});
