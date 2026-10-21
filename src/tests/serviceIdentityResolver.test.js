const test = require("node:test");
const assert = require("node:assert/strict");
const resolver = require("../services/ai/serviceIdentityResolver.service");

function comparison(id, quotes, enrichmentStatus = "current") {
  return { id, comparisonId: id, searchedAt: "2026-10-21T12:00:00.000Z", enrichmentStatus, quotes };
}

function quote(overrides = {}) {
  return { provider: "urbancab", providerId: "urbancab", providerDisplayName: "Bykea", serviceCode: "47", providerServiceName: null, providerServiceLabel: "Service 47", fare: 450, currency: "PKR", availability: "available", sourceType: "actual_provider", quoteFreshness: "fresh", ...overrides };
}

test.afterEach(() => resolver.setHistoryReaderForTests());

test("resolves a verified service code with fare and freshness evidence", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => comparison("c-1", [quote({ providerServiceName: "Ride AC", verifiedVehicleCategory: "car", serviceCategoryConfidence: "verified", serviceCategoryProvenance: "provider_mapping" })]), getHistory: async () => [] });
  const result = await resolver.lookupProviderService({ userId: "user-1", comparisonId: "c-1", serviceCode: "47" });
  assert.equal(result.status, "FOUND");
  assert.equal(result.service.name, "Ride AC");
  assert.equal(result.service.vehicleCategory, "car");
  assert.equal(result.fare.value, 450);
  assert.equal(result.evidence.freshness, "fresh");
});

test("does not invent identity for an unknown service code", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => comparison("c-1", [quote({ serviceCode: "47" })]), getHistory: async () => [] });
  const result = await resolver.lookupProviderService({ userId: "user-1", comparisonId: "c-1", serviceCode: "47" });
  assert.equal(result.status, "UNKNOWN_SERVICE");
  assert.equal(result.serviceCode, "47");
});

test("reports ambiguity when the same code belongs to multiple providers", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => comparison("c-1", [quote(), quote({ provider: "indrive", providerId: "indrive", providerDisplayName: "inDrive" })]), getHistory: async () => [] });
  const result = await resolver.lookupProviderService({ userId: "user-1", comparisonId: "c-1", serviceCode: "47" });
  assert.equal(result.status, "AMBIGUOUS_PROVIDER");
  assert.equal(result.matches.length, 2);
});

test("honors provider aliases and rejects missing or unauthorized comparisons", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async (id) => id === "owned" ? comparison(id, [quote()]) : null, getHistory: async () => [] });
  assert.equal((await resolver.lookupProviderService({ userId: "user-1", comparisonId: "missing", provider: "Yango", serviceCode: "47" })).status, "COMPARISON_NOT_FOUND");
  assert.equal((await resolver.lookupProviderService({ userId: "user-1", comparisonId: "owned", provider: "Urban Cab", serviceCode: "47" })).status, "UNKNOWN_SERVICE");
});

test("uses the latest authorized history after process cache is absent", async () => {
  let called = false;
  resolver.setHistoryReaderForTests({ getHistoryById: async () => null, getHistory: async ({ userId }) => { called = userId === "user-1"; return [comparison("history-1", [quote({ providerServiceName: "Verified Bike" })])]; } });
  const result = await resolver.lookupProviderService({ userId: "user-1", serviceCode: "47" });
  assert.equal(called, true);
  assert.equal(result.status, "FOUND");
  assert.equal(result.comparisonId, "history-1");
});

test("marks expired comparison evidence as historical", async () => {
  resolver.setHistoryReaderForTests({ getHistoryById: async () => comparison("old", [quote({ quoteFreshness: "historical" })], "stale"), getHistory: async () => [] });
  const result = await resolver.lookupProviderService({ userId: "user-1", comparisonId: "old", serviceCode: "47" });
  assert.equal(result.status, "UNKNOWN_SERVICE");
  assert.equal(result.evidence.freshness, "historical");
});
