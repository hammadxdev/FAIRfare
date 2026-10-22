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

test("Bykea user-confirmed service mappings preserve variants and unknown codes", () => {
  const entries = [23, 70, 44, 45, 48].map((service_code) => normalizeBykeaServiceEntry({ service_code, success: true, mstr: "Est: 196 PKR", currency_code: "PKR" }));
  assert.deepEqual(entries.map((item) => [item.service_code, item.providerServiceName, item.vehicleCategory, item.serviceTier]), [
    [23, "Bike", "bike", "standard"], [70, "Rickshaw", "rickshaw", "standard"], [44, "Car AC", "car", "standard"], [45, "Car", "car", "standard"], [48, "Car Premium", "car", "premium"],
  ]);
  assert.deepEqual(entries[2].features, ["AC"]);
  const unknown = normalizeBykeaServiceEntry({ service_code: 47, success: true, mstr: "Est: 196 PKR", currency_code: "PKR" });
  assert.equal(unknown.vehicleCategory, "unknown");
  assert.equal(unknown.providerServiceName, "Service 47");
});
