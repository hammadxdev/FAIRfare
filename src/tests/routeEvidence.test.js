const assert = require("assert");
const test = require("node:test");
const { routeEvidenceFromRun, matchRouteEvidence } = require("../services/ai/routeEvidence.service");

function run(overrides = {}) {
  return {
    status: "COMPLETED",
    completed_at: new Date().toISOString(),
    response_json: { context: { trip: {
      status: "RESOLVED",
      pickup: { name: "Lahore Garrison University", query: "LGU DHA Phase 6", lat: 31.46, lng: 74.44, placeId: "lgu" },
      destination: { name: "Punjab University New Campus", query: "Punjab University New Campus (Quaid-e-Azam Campus)", lat: 31.5, lng: 74.3, placeId: "pu-new" },
      route: { distanceMeters: 17462, durationSeconds: 1333.679 },
    } } },
    tool_execution_json: { results: [{ name: "calculate_route", ok: true, result: { sourceType: "verified_road_route" } }] },
    ...overrides,
  };
}

test("only a completed verified route run becomes reusable evidence", () => {
  const evidence = routeEvidenceFromRun(run());
  assert.equal(evidence.source, "verified_road_route");
  assert.equal(matchRouteEvidence("LGU DHA Phase 6 se Punjab University New Campus jana hai", evidence), true);
  assert.equal(matchRouteEvidence("LGU DHA Phase 6 se UET New Campus Kala Shah Kaku jana hai", evidence), false);
});

test("assistant prose alone is not route evidence", () => {
  assert.equal(routeEvidenceFromRun({ status: "COMPLETED", completed_at: new Date().toISOString(), response_json: { reply: "17.5 km" }, tool_execution_json: { results: [] } }), null);
});

test("expired and failed runs are rejected", () => {
  assert.equal(routeEvidenceFromRun({ ...run(), completed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }), null);
  assert.equal(routeEvidenceFromRun({ ...run(), status: "FAILED" }), null);
});
