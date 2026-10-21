const test = require("node:test");
const assert = require("node:assert/strict");
const { routeIntent, buildServerIntent } = require("../services/ai/intentRouter.service");

test("recognizes service, route and comparison intents", () => {
  assert.equal(routeIntent("What is service 47?").intent, "service_identity");
  assert.equal(routeIntent("DHA se airport jana hai").intent, "current_trip");
  assert.equal(routeIntent("DHA se airport ki sabse sasti ride batao").intent, "cheapest_ride");
  assert.equal(routeIntent("route distance kitni hai").intent, "route_information");
});

test("server derives explicit comparison intent from user text, not model arguments", () => {
  assert.equal(buildServerIntent("DHA se airport jana hai", { userExplicitlyRequestedComparison: true }).explicitComparisonIntent, false);
  assert.equal(buildServerIntent("DHA se airport ki cheapest ride batao", { userExplicitlyRequestedComparison: true }).explicitComparisonIntent, true);
});

test("contextual follow-ups remain recognized", () => {
  assert.equal(routeIntent("aur sasti wali?", { hasFareRideContext: true }).intent, "follow_up");
});
