const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../services/tripAwareAiAssistant.service");
const resolver = require("../services/ai/serviceIdentityResolver.service");

test.afterEach(() => resolver.setHistoryReaderForTests());

test("routes English service questions directly to the resolver", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => ({ id: "c-1", comparisonId: "c-1", searchedAt: "2026-10-21T12:00:00.000Z", enrichmentStatus: "current", quotes: [{ provider: "indrive", providerId: "indrive", providerDisplayName: "inDrive", serviceCode: "47", providerServiceName: "Ride AC", verifiedVehicleCategory: "car", serviceCategoryProvenance: "provider_mapping", fare: 600, currency: "PKR", availability: "available", quoteFreshness: "fresh" }] }), getHistory: async () => [] });
  const result = await assistant.answer({ userId: "user-1", message: "What is service 47?", comparisonId: "c-1" });
  assert.equal(result.modelId, null);
  assert.match(result.reply, /Ride AC/);
  assert.match(result.reply, /inDrive/);
});

test("routes Roman Urdu service follow-ups without generic model fallback", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => ({ id: "c-1", comparisonId: "c-1", searchedAt: "2026-10-21T12:00:00.000Z", enrichmentStatus: "current", quotes: [{ provider: "urbancab", providerId: "urbancab", providerDisplayName: "Bykea", serviceCode: "47", providerServiceName: "Service 47", providerServiceLabel: "Service 47", fare: 300, currency: "PKR", availability: "available", quoteFreshness: "historical" }] }), getHistory: async () => [] });
  const result = await assistant.answer({ userId: "user-1", message: "Service 47 kya hai?", comparisonId: "c-1" });
  assert.equal(result.modelId, null);
  assert.match(result.reply, /Service 47/);
  assert.match(result.reply, /verified vehicle identity|vehicle category unknown/i);
});

test("does not guess when service follow-up context is ambiguous", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => ({ id: "c-1", comparisonId: "c-1", searchedAt: "2026-10-21T12:00:00.000Z", enrichmentStatus: "current", quotes: [{ provider: "indrive", providerId: "indrive", providerDisplayName: "inDrive", serviceCode: "47", providerServiceName: "Ride AC" }, { provider: "urbancab", providerId: "urbancab", providerDisplayName: "Bykea", serviceCode: "23", providerServiceName: "Service 23" }] }), getHistory: async () => [] });
  const result = await assistant.answer({ userId: "user-1", message: "Iska fare kitna tha?", comparisonId: "c-1" });
  assert.match(result.reply, /more than one service|ek se zyada services/i);
});
