const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
const { rememberComparison, clearComparisonsForTests } = require("../services/currentComparison.service");
const assistant = require("../services/ai/aiRideAssistant.service");
const { randomUUID } = require("crypto");

test.beforeEach(() => {
  clearComparisonsForTests();
  assistant.setLlmClientForTests({ complete: async ({ context }) => { global.__lastAiContext = context; return "Grounded test reply"; } });
});

test("AI requires auth, rejects empty and overlong messages", async () => {
  assert.equal((await request(app).post("/api/ai/chat").send({ message: "hello" })).status, 401);
  const auth = await createAuthenticatedTestUser(app, "AI Validation User");
  const headers = { Authorization: authHeader(auth) };
  assert.equal((await request(app).post("/api/ai/chat").set(headers).send({ message: " " })).status, 400);
  assert.equal((await request(app).post("/api/ai/chat").set(headers).send({ message: "x".repeat(1001) })).status, 400);
});

test("AI supplies only the authenticated user's preferences and bounded history", async () => {
  const userA = await createAuthenticatedTestUser(app, "AI Context A");
  const userB = await createAuthenticatedTestUser(app, "AI Context B");
  await request(app).put("/api/preferences").set("Authorization", authHeader(userA)).send({ preferredVehicleType: "RICKSHAW", avoidedVehicleTypes: ["BIKE"], typicalBudget: 600 });
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(userA)).send({ message: "What are my preferences?", userId: userB.user.id });
  assert.equal(response.status, 200);
  assert.equal(global.__lastAiContext.preferences.preferredVehicleType, "RICKSHAW");
  assert.deepEqual(global.__lastAiContext.preferences.avoidedVehicleTypes, ["BIKE"]);
  assert.equal(JSON.stringify(global.__lastAiContext).includes(userB.user.email), false);
  assert.ok(global.__lastAiContext.history.length <= 5);
});

test("AI current comparison context is owned, factual, and keeps prediction separate", async () => {
  const userA = await createAuthenticatedTestUser(app, "AI Comparison A");
  const userB = await createAuthenticatedTestUser(app, "AI Comparison B");
  const comparison = { comparisonId: randomUUID(), pickup: { name: "Gulberg" }, dropoff: { name: "DHA" }, results: [
    { provider: { displayName: "Bike Co" }, categoryName: "Bike", fare: 300, etaMin: 5, prediction: { status: "AVAILABLE", predictedFare: 340, dataSource: "SIMULATED" }, recommendation: { status: "WAIT", currentFare: 300, expectedFare: 340, reason: "Current fare is below reference", modelDataSource: "SIMULATED" }, personalization: { eligible: false, isTopRecommendation: false, withinBudget: true, reasons: [], exclusionReason: "Vehicle type is in your avoided preferences." } },
    { provider: { displayName: "Rickshaw Co" }, categoryName: "Rickshaw", fare: 480, etaMin: 8, prediction: null, recommendation: null, personalization: { eligible: true, isTopRecommendation: true, withinBudget: true, preferredVehicleMatch: true, reasons: ["Matches your preferred vehicle type."] } },
  ] };
  rememberComparison({ userId: userA.user.id, comparison });
  const own = await request(app).post("/api/ai/chat").set("Authorization", authHeader(userA)).send({ message: "Which ride should I take?", comparisonId: comparison.comparisonId });
  assert.equal(own.status, 200);
  assert.equal(global.__lastAiContext.comparison.rides[0].fare, 300);
  assert.equal(global.__lastAiContext.comparison.rides[0].prediction.predictedFare, 340);
  assert.equal(global.__lastAiContext.comparison.rides[0].bookWait.status, "WAIT");
  assert.equal(global.__lastAiContext.comparison.rides[1].personalization.isTopRecommendation, true);
  const other = await request(app).post("/api/ai/chat").set("Authorization", authHeader(userB)).send({ message: "show it", comparisonId: comparison.comparisonId });
  assert.equal(other.status, 200);
  assert.equal(global.__lastAiContext.comparison, null);
});

test("disabled or provider failures return safe assistant responses", async () => {
  const auth = await createAuthenticatedTestUser(app, "AI Failure User");
  assistant.setLlmClientForTests({ complete: async () => { const error = new Error("timeout"); error.code = "LLM_TIMEOUT"; throw error; } });
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message: "Should I book now?" });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.available, false);
  assert.equal(response.body.data.status, "UNAVAILABLE");
  assert.equal(response.body.data.reply, null);
});
