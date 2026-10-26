const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../services/ai/toolRegistry");
const { runBoundedToolAgent } = require("../services/ai/toolExecutor.service");

test("continues from two successful Gemini searches to calculate_route", async () => {
  const pickup = { name: "Lahore Garrison University", address: "Lahore", placeId: "lgu", lat: 31.45, lng: 74.28, resolutionType: "verified_named_landmark" };
  const destination = { name: "Punjab University", address: "Lahore", placeId: "pu", lat: 31.49, lng: 74.30, resolutionType: "verified_named_landmark" };
  let round = 0;
  let routeCalls = 0;
  registry.setToolDependenciesForTests({ maps: {
    fetchAutocomplete: async ({ input }) => [input.includes("Garrison") ? pickup : destination],
    computeRoute: async () => { routeCalls += 1; return { distanceMeters: 7000, durationSeconds: 1200 }; },
  } });
  try {
    const result = await runBoundedToolAgent({
      message: "lgu sy punjab university jana hy",
      context: { nativeToolAgent: true, responseLanguage: "roman_urdu" },
      serverContext: { userId: "offline-user", nativeToolAgent: true, deadlineAt: Date.now() + 8000 },
      tools: registry.listTools(),
      llmClient: { completeDetailed: async () => {
        round += 1;
        if (round === 1) return { toolCalls: [
          { id: "s1", name: "search_locations", arguments: { query: "LGU" } },
          { id: "s2", name: "search_locations", arguments: { query: "Punjab University" } },
        ], text: null };
        if (round === 2) return { toolCalls: [{ id: "gemini-1", name: "calculate_route", arguments: JSON.stringify({ pickup: { lat: pickup.lat, lng: pickup.lng }, dropoff: { lat: destination.lat, lng: destination.lng } }) }], text: null };
        return { toolCalls: [], text: "Distance verified." };
      } },
    });
    assert.equal(result.errorCode, undefined);
    assert.equal(routeCalls, 1);
    assert.equal(result.resolvedTrip.route.distanceMeters, 7000);
    assert.deepEqual(result.modelSelectedTools, ["search_locations", "search_locations", "calculate_route"]);
  } finally {
    registry.resetToolDependenciesForTests();
  }
});

test("normalizes a Gemini-style round-2 function wrapper and rejects missing arguments", async () => {
  const point = { name: "Alpha", address: "Lahore", placeId: "a", lat: 31.4, lng: 74.2, resolutionType: "verified_named_landmark" };
  const other = { name: "Beta", address: "Lahore", placeId: "b", lat: 31.41, lng: 74.21, resolutionType: "verified_named_landmark" };
  registry.setToolDependenciesForTests({ maps: { fetchAutocomplete: async ({ input }) => [input.includes("Beta") ? other : point], computeRoute: async () => ({ distanceMeters: 1000, durationSeconds: 300 }) } });
  try {
    let round = 0;
    const result = await runBoundedToolAgent({ message: "route", context: { nativeToolAgent: true }, serverContext: { userId: "u", nativeToolAgent: true, deadlineAt: Date.now() + 5000 }, tools: registry.listTools(), llmClient: { completeDetailed: async () => {
      round += 1;
      if (round === 1) return { toolCalls: [{ id: "s", name: "search_locations", arguments: { query: "Alpha" } }, { id: "s2", name: "search_locations", arguments: { query: "Beta" } }] };
      if (round === 2) return { toolCalls: [{ functionCall: { name: "calculate_route", args: { pickup: { lat: 31.4, lng: 74.2 }, dropoff: { lat: 31.41, lng: 74.21 } } }, thoughtSignature: "sig" }] };
      return { text: "ok", toolCalls: [] };
    } } });
    assert.equal(result.errorCode, undefined);
    assert.equal(result.resolvedTrip.route.distanceMeters, 1000);
  } finally { registry.resetToolDependenciesForTests(); }
});

test("executes a valid tool call returned in the fourth model round and finalizes once", async () => {
  const a = { name: "Alpha", address: "Lahore", placeId: "a4", lat: 31.4, lng: 74.2, resolutionType: "verified_named_landmark", approximate: false };
  const b = { name: "Beta", address: "Lahore", placeId: "b4", lat: 31.41, lng: 74.21, resolutionType: "verified_named_landmark", approximate: false };
  let round = 0; let routeCalls = 0;
  registry.setToolDependenciesForTests({ maps: { fetchAutocomplete: async ({ input }) => [input.includes("Beta") ? b : a], computeRoute: async () => { routeCalls += 1; return { distanceMeters: 1000, durationSeconds: 300 }; } } });
  try {
    const result = await runBoundedToolAgent({ message: "route", context: { nativeToolAgent: true }, serverContext: { userId: "u4", nativeToolAgent: true, deadlineAt: Date.now() + 8000 }, tools: registry.listTools(), llmClient: { completeDetailed: async () => { round += 1; if (round <= 3) return { toolCalls: [{ id: `s${round}`, name: "search_locations", arguments: { query: round === 2 ? "Beta" : "Alpha" } }] }; if (round === 4) return { toolCalls: [{ id: "gemini-1", name: "calculate_route", arguments: JSON.stringify({ pickup: { lat: a.lat, lng: a.lng }, dropoff: { lat: b.lat, lng: b.lng } }) }] }; return { toolCalls: [], text: "Route verified." }; } } });
    assert.equal(result.errorCode, undefined); assert.equal(routeCalls, 1); assert.equal(round, 5); assert.equal(result.resolvedTrip.route.distanceMeters, 1000);
  } finally { registry.resetToolDependenciesForTests(); }
});
