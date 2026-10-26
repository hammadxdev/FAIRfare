const test = require("node:test");
const assert = require("node:assert/strict");
const { requestBody } = require("../services/ai/providerAdapters");
const { selectCandidate } = require("../services/tripResolution.service");
const toolRegistry = require("../services/ai/toolRegistry");

test("compact native request retains routing data while context grows by round", () => {
  const candidate = { provider: "groq", model: "openai/gpt-oss-120b", supportsTools: true, supportsRequiredToolChoice: true };
  const base = { nativeToolAgent: true, responseLanguage: "english" };
  const tools = [{ name: "search_locations", description: "Search locations", schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } }, { name: "calculate_route", description: "Calculate route", schema: { type: "object", properties: { pickup: { type: "object" }, dropoff: { type: "object" } }, required: ["pickup", "dropoff"], additionalProperties: false } }];
  const first = JSON.stringify(requestBody(candidate, { systemInstructions: "system", message: "route", context: base, history: [], toolDefinitions: tools, toolMessages: [{ role: "user", content: "route" }] }));
  const second = JSON.stringify(requestBody(candidate, { systemInstructions: "system", message: "route", context: base, history: [], toolDefinitions: tools, toolMessages: [{ role: "user", content: "route" }, { role: "assistant", tool_calls: [{ id: "s", type: "function", function: { name: "search_locations", arguments: JSON.stringify({ query: "LGU" }) } }] }, { role: "tool", tool_call_id: "s", content: JSON.stringify({ status: "OK", candidates: [{ placeId: "p1", name: "LGU", lat: 31.45, lng: 74.4, resolutionType: "verified_named_landmark" }] }) }] }));
  assert.ok(second.length > first.length);
  assert.match(second, /31\.45/);
  assert.match(second, /74\.4/);
});

test("generic ranking prefers a matching area or landmark and rejects unrelated business", () => {
  const result = selectCandidate("Gulberg", [
    { name: "Unrelated Gulberg Cafe", category: "catering", resultType: "commercial", lat: 31.5, lng: 74.3 },
    { name: "Gulberg", resultType: "suburb", lat: 31.52, lng: 74.35 },
  ]);
  assert.equal(result.location.name, "Gulberg");
  assert.equal(result.location.resolutionType, "approximate_representative_area");
  assert.equal(result.location.approximate, true);
});

test("exact matching business remains a valid named landmark", () => {
  const result = selectCandidate("Liberty Market", [{ name: "Liberty Market", category: "commercial", resultType: "commercial", placeId: "market-1", lat: 31.51, lng: 74.34 }]);
  assert.equal(result.location.placeId, "market-1");
  assert.equal(result.location.resolutionType, "verified_named_landmark");
});

test("compact search results preserve identity and routing references", async () => {
  toolRegistry.setToolDependenciesForTests({ maps: { fetchAutocomplete: async () => Array.from({ length: 10 }, (_, i) => ({ name: i === 0 ? "Liberty Market" : `Liberty unrelated ${i}`, placeId: `p${i}`, resultType: i === 0 ? "market" : "commercial", category: i === 0 ? "market" : "catering", lat: 31.5 + i / 1000, lng: 74.34 + i / 1000 })) } });
  const result = await toolRegistry.getTool("search_locations").execute({ query: "Liberty Market", cityHint: "Lahore" });
  assert.ok(result.candidates.length <= 6);
  assert.equal(result.candidates[0].placeId, "p0");
  assert.equal(typeof result.candidates[0].lat, "number");
  assert.equal(typeof result.candidates[0].lng, "number");
  toolRegistry.resetToolDependenciesForTests();
});
