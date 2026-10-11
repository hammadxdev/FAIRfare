const test = require("node:test");
const assert = require("node:assert/strict");
const { mapHistoryRow, enrichmentFor } = require("../services/history.service");

function row(overrides = {}) {
  return {
    id: "comparison-1",
    created_at: "2026-10-11T12:00:00.000Z",
    pickup_label: "Punjab Small Industries",
    pickup_latitude: 31.46,
    pickup_longitude: 74.26,
    destination_label: "Lahore Garrison University",
    destination_latitude: 31.51,
    destination_longitude: 74.40,
    distance_meters: 14900,
    duration_seconds: 2460,
    quotes: [{ provider: "indrive", category: "BIKE", fare: 280, currency: "PKR", fare_type: "ESTIMATE", pickup_eta_seconds: 300, availability: "available" }],
    ...overrides,
  };
}

test("history enrichment restores prediction and recommendation metadata", () => {
  const mapped = mapHistoryRow(row({
    enrichment_json: {
      version: 1,
      dataSource: "SIMULATED",
      results: [{ provider: "indrive", prediction: { status: "AVAILABLE", predictedFare: 295, dataSource: "SIMULATED" }, recommendation: { status: "BOOK_NOW", currentFare: 280 } }],
    },
    enrichment_created_at: "2026-10-11T12:00:00.000Z",
    enrichment_expires_at: "2999-01-01T00:00:00.000Z",
  }));
  assert.equal(mapped.enrichmentStatus, "current");
  assert.equal(mapped.quotes[0].prediction.predictedFare, 295);
  assert.equal(mapped.quotes[0].recommendation.status, "BOOK_NOW");
});

test("expired enrichment remains visible as stale and never changes fare facts", () => {
  const mapped = mapHistoryRow(row({
    enrichment_json: { results: [{ provider: "indrive", prediction: { status: "AVAILABLE" }, recommendation: { status: "BOOK_NOW" } }] },
    enrichment_expires_at: "2000-01-01T00:00:00.000Z",
  }));
  assert.equal(mapped.enrichmentStatus, "stale");
  assert.equal(mapped.quotes[0].fare, 280);
  assert.equal(mapped.quotes[0].recommendation.status, "BOOK_NOW");
});

test("enrichment payload is explicitly model-side and provider-neutral", () => {
  const payload = enrichmentFor([{ provider: { name: "indrive" }, prediction: { status: "MODEL_NOT_TRAINED" }, recommendation: { status: "INSUFFICIENT_DATA" } }]);
  assert.equal(payload.dataSource, "SIMULATED");
  assert.equal(payload.results[0].provider, "indrive");
});
