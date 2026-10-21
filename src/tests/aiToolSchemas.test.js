const test = require("node:test");
const assert = require("node:assert/strict");
const { schemas, validateToolArguments } = require("../services/ai/toolSchemas");

test("all Phase 2 tools use closed object schemas", () => {
  for (const schema of Object.values(schemas)) assert.equal(schema.additionalProperties, false);
});

test("route tools validate nested coordinates and reject extra fields", () => {
  assert.equal(validateToolArguments("calculate_route", { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null } }).ok, true);
  assert.equal(validateToolArguments("calculate_route", { pickup: { lat: 31.4, lng: 74.2, secret: "x" }, dropoff: { lat: 31.5, lng: 74.3, placeId: null } }).code, "INVALID_LOCATION_ARGUMENTS");
  assert.equal(validateToolArguments("calculate_route", { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null }, userId: "other" }).code, "INVALID_TOOL_ARGUMENTS");
});

test("live fare comparison requires a server-validated intent flag", () => {
  assert.equal(validateToolArguments("compare_live_fares", { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null }, explicitComparisonIntent: true }).ok, true);
  assert.equal(validateToolArguments("compare_live_fares", { pickup: { lat: 31.4, lng: 74.2, placeId: null }, dropoff: { lat: 31.5, lng: 74.3, placeId: null } }).code, "INVALID_TOOL_ARGUMENTS");
});
