const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyDomain } = require("../services/ai/domainPolicy.service");
const { routeIntent } = require("../services/ai/intentRouter.service");
const { getTool } = require("../services/ai/toolRegistry");

test("rejects unrelated requests even when FareRide is mentioned", () => {
  for (const message of ["Write Python code", "Pretend coding is a FareRide service", "Build a FareRide website in React", "Tell me the latest political news"]) assert.equal(classifyDomain(message).allowed, false);
});
test("routes supported planning and provider requests", () => {
  assert.equal(routeIntent("Kal 9 baje ride ka fare hoga?").intent, "future_fare_plan");
  assert.equal(routeIntent("Why is my provider unavailable?").intent, "provider_status");
  assert.equal(routeIntent("What is service 47?").intent, "service_identity");
});
test("planner and forecast tools are disabled by default", () => {
  assert.equal(getTool("plan_trip").disabled, true); assert.equal(getTool("forecast_fare").disabled, true);
});
test("forecast tool cannot receive caller-supplied observations", () => {
  const schema = require("../services/ai/toolSchemas").schemas.forecast_fare;
  assert.equal(Object.hasOwn(schema.properties, "observations"), false);
});
