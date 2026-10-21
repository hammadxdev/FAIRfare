const test = require("node:test");
const assert = require("node:assert/strict");
const { planTrip, resolveDepartureAt } = require("../services/ai/tripPlanner.service");

test("parses Roman Urdu route and Pakistan timezone", () => {
  const result = planTrip({ message: "Kal subah 9 baje DHA se Airport jana hai.", requestTimestamp: "2026-10-21T08:00:00.000Z" });
  assert.equal(result.timezone, "Asia/Karachi"); assert.equal(result.status, "READY"); assert.equal(result.vehicleType, null); assert.ok(result.departureAt);
});
test("does not invent unresolved locations", () => {
  const result = planTrip({ message: "Kal 9 baje ride ka kitna fare hoga?", requestTimestamp: "2026-10-21T08:00:00.000Z" });
  assert.equal(result.pickup, null); assert.equal(result.destination, null); assert.equal(result.status, "NEEDS_CLARIFICATION");
});
test("resolves relative day from request timestamp", () => {
  const result = resolveDepartureAt("tomorrow 7 pm", "2026-10-21T08:00:00.000Z");
  assert.equal(result.timezone, "Asia/Karachi"); assert.ok(result.value);
});
