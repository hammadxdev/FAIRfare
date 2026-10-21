const test = require("node:test");
const assert = require("node:assert/strict");
const { mapCategory } = require("../providers/indrive/indrive.mapper");
const { canonicalVehicleCategory, normalizeTariff } = require("../providers/yango/yango.mapper");
const { normalizeBykeaServiceEntry } = require("../providers/bykea/bykea.mapper");

test("inDrive category metadata maps only documented provider categories", () => {
  assert.equal(mapCategory(2).vehicleCategory, "bike");
  assert.equal(mapCategory(31).vehicleCategory, "rickshaw");
  assert.equal(mapCategory(33).vehicleCategory, "car");
  assert.equal(mapCategory(29).vehicleCategory, "car");
  assert.equal(mapCategory(11).vehicleCategory, "car");
  assert.equal(mapCategory(999).vehicleCategory, "unknown");
  assert.deepEqual(mapCategory(29).features, ["AC"]);
  assert.equal(mapCategory(11).serviceTier, "premium");
  assert.equal(mapCategory(11).providerServiceName, "Premium");
  assert.equal(mapCategory(999).serviceTier, "unknown");
});

test("Yango exposes explicit Bike/Rickshaw metadata and keeps generic tariffs unknown", () => {
  assert.equal(canonicalVehicleCategory("", "Bike"), "bike");
  assert.equal(canonicalVehicleCategory("", "Rickshaw"), "rickshaw");
  assert.equal(normalizeTariff({ id: "econom", name: "Economy", price: 400, currency: "PKR" }).vehicleCategory, "unknown");
  const ac = normalizeTariff({ id: "econom-ac", name: "Economy A/C", price: 400, currency: "PKR" });
  assert.equal(ac.vehicleCategory, "unknown");
  assert.equal(ac.serviceTier, "economy");
  assert.deepEqual(ac.features, ["AC"]);
  assert.equal(normalizeTariff({ id: "comfort", name: "Comfort", price: 400, currency: "PKR" }).serviceTier, "standard");
});

test("Bykea service codes remain unknown without provider-supplied vehicle metadata", () => {
  const normalized = normalizeBykeaServiceEntry({ service_code: 23, success: true, mstr: "Est: 196 PKR", currency_code: "PKR" });
  assert.equal(normalized.vehicleCategory, "unknown");
  assert.equal(normalized.providerServiceLabel, "Service 23");
  assert.equal(normalized.providerServiceName, "Service 23");
  assert.equal(normalized.serviceTier, "unknown");
  assert.deepEqual(normalized.features, []);
});
