const assert = require("assert");
const test = require("node:test");

function hasUngroundedNumericRouteClaim(text) {
  const value = String(text || "");
  return /\b(?:distance|route|travel|drive|duration|time|km|kilometers?|meters?|minutes?)\b/i.test(value)
    && /\b\d+(?:\.\d+)?\s*(?:km|kilometers?|meters?|minutes?|mins?|hours?)\b/i.test(value);
}

test("route numbers are recognized even when search tools succeeded", () => {
  assert.equal(hasUngroundedNumericRouteClaim("Distance 17.5 km and 22 minutes"), true);
});

test("ordinary unrelated numbers are not treated as route claims", () => {
  assert.equal(hasUngroundedNumericRouteClaim("FairFare has 3 main app sections"), false);
});

test("failed route cannot ground numeric output", () => {
  const toolResults = [{ name: "search_locations", ok: true }, { name: "calculate_route", ok: false, error: { code: "INVALID_LOCATION_ARGUMENTS" } }];
  const routeSucceeded = toolResults.some((item) => item.name === "calculate_route" && item.ok === true && item.result?.status === "OK" && item.result?.sourceType === "verified_road_route");
  assert.equal(routeSucceeded, false);
  assert.equal(hasUngroundedNumericRouteClaim("17.5 km, about 22 minutes"), true);
});
