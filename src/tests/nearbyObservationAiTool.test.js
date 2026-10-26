const test = require("node:test");
const assert = require("node:assert/strict");
const observations = require("../services/nearbyObservation.service");
const { validateToolArguments } = require("../services/ai/toolSchemas");
const aiTools = require("../services/ai/toolRegistry");
const OBSERVATION_BASIS = "local date, weekday, hour and part of day are derived from each row's time_context_basis; request-start rows are exact backend handler starts, legacy rows remain backend receipt time";

function assertObservationBasis(value) {
  assert.match(value, /derived from each row's time_context_basis/);
  assert.match(value, /request-start rows are exact backend handler starts/);
  assert.match(value, /legacy rows remain backend receipt time/);
}

test("nearby history suppresses details below sample/day thresholds and exposes no timestamps or coordinates", async () => {
  observations.resetForTests();
  let queryCount = 0;
  observations.setQueryForTests(async (sql) => {
    queryCount += 1;
    assert.match(sql, /public\.nearby_observations/);
    if (queryCount === 1) return { rows: [{ sample_count: 9, distinct_days: 5, verified_position_samples: 2, fresh_verified_position_samples: 1 }] };
    throw new Error("detail query must not run below threshold");
  });
  const context = await observations.readNearbyObservationContext({ latitude: 31.4744, longitude: 74.4163, category: "bike" });
  assert.equal(queryCount, 1);
  assertObservationBasis(context.observationBasis);
  assert.match(context.currentPositionBasis, /verified provider capture time/);
  assert.equal(context.status, "INSUFFICIENT_DATA");
  assert.equal(context.trendEligible, false);
  assert.deepEqual(context.observations, []);
  assert.equal(context.sampleCount, 9);
  observations.resetForTests();
});

test("eligible history returns coarse aggregates without exact dates, event times, or marker positions", async () => {
  observations.resetForTests();
  let calls = 0;
  observations.setQueryForTests(async (sql, params) => {
    calls += 1;
    assert.equal(params[1], "bike");
    if (calls === 1) return { rows: [{ sample_count: 20, distinct_days: 7, verified_position_samples: 12, fresh_verified_position_samples: 3 }] };
    const selectedFields = sql.split(/\bFROM\b/i)[0];
    assert.doesNotMatch(selectedFields, /local_date|first_received_at|last_received_at|latitude|longitude|driver_id/i);
    assert.match(sql, /HAVING count\(DISTINCT received_at\) >= \$6/);
    assert.equal(params[5], observations.MIN_BREAKDOWN_SAMPLES);
    return { rows: [{ provider: "yango", vehicle_category: "bike", local_weekday: 5, part_of_day: "Evening", weather_condition: "RAIN", request_observations: 7, verified_position_observations: 5, currently_fresh_verified_position_observations: 1 }] };
  });
  const context = await observations.readNearbyObservationContext({ latitude: 31.4744, longitude: 74.4163, category: "bike" });
  assert.equal(context.status, "OK", context.reason);
  assert.equal(context.trendEligible, true);
  assert.equal(context.distinctDays, 7);
  assertObservationBasis(context.observationBasis);
  assert.equal(context.currentPositionBasis, "verified provider capture time within 60 seconds before query time");
  assert.equal(context.observations[0].requestObservations, 7);
  assert.equal("localDate" in context.observations[0], false);
  assert.equal("firstReceivedAt" in context.observations[0], false);
  assert.equal("latestWeatherAt" in context.observations[0], false);
  assert.equal("latitude" in context.observations[0], false);
  assert.equal("longitude" in context.observations[0], false);
  observations.resetForTests();
});

test("detailed historical groups below minimum group size are excluded by SQL", async () => {
  observations.resetForTests();
  let calls = 0;
  observations.setQueryForTests(async (sql) => {
    calls += 1;
    if (calls === 1) return { rows: [{ sample_count: 30, distinct_days: 10, verified_position_samples: 0, fresh_verified_position_samples: 0 }] };
    assert.match(sql, /HAVING count\(DISTINCT received_at\) >= \$6/);
    return { rows: [] };
  });
  const context = await observations.readNearbyObservationContext({ latitude: 31.4744, longitude: 74.4163, category: "rickshaw" });
  assert.equal(context.trendEligible, true);
  assert.deepEqual(context.observations, []);
  assert.equal(calls, 2);
  observations.resetForTests();
});

test("AI tool arguments allow only supported provider/category and bounded pickup coordinates", () => {
  assert.equal(validateToolArguments("get_nearby_observation_context", { pickup: { lat: 31.47, lng: 74.41 }, category: "bike", provider: "yango" }).ok, true);
  assert.equal(validateToolArguments("get_nearby_observation_context", { pickup: { lat: 91, lng: 74.41 }, category: "bike" }).ok, false);
  assert.equal(validateToolArguments("get_nearby_observation_context", { pickup: { lat: 31, lng: 74, driverId: "x" }, category: "bike" }).ok, false);
  assert.equal(validateToolArguments("get_nearby_observation_context", { pickup: { lat: 31, lng: 74 }, category: "bike", provider: "unknown" }).ok, false);
});

test("nearby context remains a read-only opt-in AI tool", async () => {
  const previous = process.env.FAIRFARE_AI_NEARBY_HISTORY_ENABLED;
  process.env.FAIRFARE_AI_NEARBY_HISTORY_ENABLED = "true";
  const result = { status: "INSUFFICIENT_DATA", observationBasis: OBSERVATION_BASIS, trendEligible: false, trendStatus: "INSUFFICIENT_SAMPLE_FOR_TRENDS", observations: [] };
  aiTools.setToolDependenciesForTests({ readNearbyObservationContext: async () => result });
  try {
    const tool = aiTools.getTool("get_nearby_observation_context");
    assert.equal(tool.mayCallProvider, false);
    assert.equal(tool.mayMutateState, false);
    assert.deepEqual(await tool.execute({ pickup: { lat: 31.4, lng: 74.3 }, category: "bike" }), result);
  } finally {
    aiTools.resetToolDependenciesForTests();
    if (previous === undefined) delete process.env.FAIRFARE_AI_NEARBY_HISTORY_ENABLED;
    else process.env.FAIRFARE_AI_NEARBY_HISTORY_ENABLED = previous;
  }
});
