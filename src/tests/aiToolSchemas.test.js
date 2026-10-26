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

test("nested route and planner arguments reject unexpected or malformed values", () => {
  const point = { lat: 31.4, lng: 74.2 };
  assert.equal(validateToolArguments("compare_live_fares", { pickup: point, dropoff: point, explicitComparisonIntent: true, route: { distanceKm: 3, shell: "bad" } }).ok, false);
  assert.equal(validateToolArguments("calculate_route", { pickup: { lat: 31.4, lng: 74.2, name: 42 }, dropoff: point }).code, "INVALID_LOCATION_ARGUMENTS");
  assert.equal(validateToolArguments("plan_trip", { message: "Plan trip", context: { pickup: "Here", sql: "SELECT 1" } }).code, "INVALID_TOOL_ARGUMENTS");
  assert.equal(validateToolArguments("plan_trip", { message: "Plan trip", context: { pickup: "Here" } }).ok, true);
});

test("historical fare forecast requires supported provider, category and zoned forecast time", () => {
  const valid = { providerId: "yango", vehicleType: "car", forecastAt: "2026-10-20T20:30:00.000Z" };
  assert.equal(validateToolArguments("forecast_fare", valid).ok, true, JSON.stringify(validateToolArguments("forecast_fare", valid)));
  assert.equal(validateToolArguments("forecast_fare", { ...valid, hourOfDay: 2 }).ok, false);
  assert.equal(validateToolArguments("forecast_fare", { ...valid, providerId: "unknown" }).ok, false);
  assert.equal(validateToolArguments("forecast_fare", { ...valid, vehicleType: "plane" }).ok, false);
  assert.equal(validateToolArguments("forecast_fare", { ...valid, forecastAt: "2026-99-99T20:30:00Z" }).code, "INVALID_FORECAST_TIME");
  assert.equal(validateToolArguments("forecast_fare", { providerId: "yango", vehicleType: "car" }).ok, false);
});
