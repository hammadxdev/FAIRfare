const test = require("node:test");
const assert = require("node:assert/strict");
const { mapHistoryRow, serviceIdentityForQuote, sanitizeServiceMetadata } = require("../services/history.service");

test("persists only sanitized service identity metadata", () => {
  const identity = serviceIdentityForQuote({ provider: { id: "urbancab", displayName: "Bykea" }, dataSource: "REAL" }, {
    service_code: 47,
    providerServiceName: "Service 47",
    providerServiceLabel: "Service 47",
    vehicleCategory: "unknown",
    metadata: { features: ["AC"], accessToken: "must-not-persist", nested: { password: "must-not-persist" } },
    fare: 450,
    isAvailable: true,
  }, new Date("2026-10-21T12:00:00.000Z"));
  assert.equal(identity.providerId, "urbancab");
  assert.equal(identity.serviceCode, "47");
  assert.equal(identity.verifiedVehicleCategory, null);
  assert.equal(identity.serviceMetadata.accessToken, undefined);
  assert.equal(identity.serviceMetadata.nested.password, undefined);
  assert.equal(identity.sourceType, "actual_provider");
});

test("restores identity fields while preserving legacy fare fields", () => {
  const mapped = mapHistoryRow({
    id: "comparison-1", created_at: "2026-10-21T12:00:00.000Z", pickup_label: "Pickup", pickup_latitude: 31.4, pickup_longitude: 74.2,
    destination_label: "Dropoff", destination_latitude: 31.5, destination_longitude: 74.3, distance_meters: 1000, duration_seconds: 600,
    quotes: [{ provider: "urbancab", provider_id: "urbancab", provider_display_name: "Bykea", category: null, fare: 450, fare_min: null, fare_max: null, currency: "PKR", fare_type: "estimate", pickup_eta_seconds: null, availability: "available", service_code: "47", provider_service_name: "Service 47", provider_service_label: "Service 47", verified_vehicle_category: null, service_category_confidence: null, service_category_provenance: null, service_tier: "unknown", service_metadata_json: { features: [] }, source_type: "actual_provider", quote_created_at: "2026-10-21T12:00:00.000Z", valid_until: null, observed_at: "2026-10-21T12:00:00.000Z" }],
  });
  assert.equal(mapped.id, "comparison-1");
  assert.equal(mapped.comparisonId, "comparison-1");
  assert.equal(mapped.quotes[0].fare, 450);
  assert.equal(mapped.quotes[0].serviceCode, "47");
  assert.equal(mapped.quotes[0].providerServiceName, "Service 47");
  assert.equal(mapped.quotes[0].verifiedVehicleCategory, null);
});

test("sanitizer removes credential-like fields without touching fare metadata", () => {
  const safe = sanitizeServiceMetadata({ fare: 450, currency: "PKR", apiKey: "hidden", headers: { authorization: "hidden" } });
  assert.deepEqual(safe, { fare: 450, currency: "PKR", headers: {} });
});
