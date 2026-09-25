const test = require("node:test");
const assert = require("node:assert/strict");
const { recommendRide, DEFAULT_THRESHOLD_PERCENT } = require("../services/rideRecommendation.service");

function prediction(predictedFare = 500, extras = {}) { return { status: "AVAILABLE", predictedFare, dataSource: "SIMULATED", confidence: null, ...extras }; }

test("materially below expected recommends BOOK_NOW", () => {
  const result = recommendRide({ currentFare: 420, prediction: prediction() });
  assert.equal(result.status, "BOOK_NOW"); assert.equal(result.difference, -80); assert.equal(result.percentageDifference, -16); assert.match(result.reason, /below/);
});
test("materially above expected recommends WAIT without forecasting future movement", () => {
  const result = recommendRide({ currentFare: 590, prediction: prediction() });
  assert.equal(result.status, "WAIT"); assert.equal(result.percentageDifference, 18); assert.match(result.reason, /above/); assert.doesNotMatch(result.reason, /will|rise|decrease|10 minutes/i);
});
test("close and exact fares are NEUTRAL", () => {
  assert.equal(recommendRide({ currentFare: 515, prediction: prediction() }).status, "NEUTRAL");
  assert.equal(recommendRide({ currentFare: 500, prediction: prediction() }).status, "NEUTRAL");
});
test("prediction unavailable statuses produce INSUFFICIENT_DATA", () => {
  for (const status of ["MODEL_NOT_TRAINED", "UNSUPPORTED_CATEGORY", "PREDICTION_FAILED"]) {
    const result = recommendRide({ currentFare: 420, prediction: prediction(null, { status }) });
    assert.equal(result.status, "INSUFFICIENT_DATA"); assert.equal(result.modelDataSource, "SIMULATED");
  }
  assert.equal(recommendRide({ currentFare: 420, prediction: null }).status, "INSUFFICIENT_DATA");
});
test("invalid fares and expected fares are handled safely", () => {
  for (const currentFare of [-1, NaN, Infinity]) assert.equal(recommendRide({ currentFare, prediction: prediction() }).status, "INSUFFICIENT_DATA");
  for (const expectedFare of [0, -1, NaN, Infinity]) assert.equal(recommendRide({ currentFare: 420, prediction: prediction(expectedFare) }).status, "INSUFFICIENT_DATA");
});
test("preserves provenance and null confidence", () => {
  const result = recommendRide({ currentFare: 420, prediction: prediction(500, { dataSource: "SIMULATED", confidence: null }) });
  assert.equal(result.modelDataSource, "SIMULATED"); assert.equal(result.confidence, null); assert.equal(result.expectedFare, 500); assert.equal(result.currentFare, 420);
});
test("threshold is centralized and configurable", () => {
  assert.equal(DEFAULT_THRESHOLD_PERCENT, 10);
  const previous = process.env.FAIRFARE_RECOMMENDATION_THRESHOLD_PERCENT;
  process.env.FAIRFARE_RECOMMENDATION_THRESHOLD_PERCENT = "20";
  try { assert.equal(recommendRide({ currentFare: 550, prediction: prediction() }).status, "NEUTRAL"); } finally { if (previous === undefined) delete process.env.FAIRFARE_RECOMMENDATION_THRESHOLD_PERCENT; else process.env.FAIRFARE_RECOMMENDATION_THRESHOLD_PERCENT = previous; }
});
