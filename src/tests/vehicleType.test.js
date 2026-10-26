const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeVehicleType } = require("../services/vehicleType.service");

test("Yango services are categorized by their own class, not the requested vehicle type", () => {
  const category = (providerCategoryId) => normalizeVehicleType({ provider: "quickride", providerCategoryId, requestedVehicleType: "car" });
  assert.equal(category("moto"), "BIKE");
  assert.equal(category("tuktuk"), "RICKSHAW");
  assert.equal(category("econom"), "ECONOMY_CAR");
  assert.equal(category("business"), "STANDARD_CAR");
  assert.equal(category("comfortplus"), "PREMIUM_CAR");
  assert.equal(normalizeVehicleType({ provider: "yango", providerCategoryId: "MOTO", requestedVehicleType: "car" }), "BIKE");
});

test("Bykea services are categorized by service code", () => {
  const category = (providerCategoryId) => normalizeVehicleType({ provider: "urbancab", providerCategoryId, requestedVehicleType: "car" });
  assert.equal(category("23"), "BIKE");
  assert.equal(category("70"), "RICKSHAW");
  assert.equal(category("45"), "ECONOMY_CAR");
  assert.equal(category("44"), "STANDARD_CAR");
  assert.equal(category("48"), "PREMIUM_CAR");
  assert.equal(normalizeVehicleType({ provider: "bykea", providerCategoryId: 23, requestedVehicleType: "car" }), "BIKE");
});

test("unknown provider service ids and other providers keep the requested vehicle type", () => {
  assert.equal(normalizeVehicleType({ provider: "quickride", providerCategoryId: "vip", requestedVehicleType: "car" }), "STANDARD_CAR");
  assert.equal(normalizeVehicleType({ provider: "urbancab", providerCategoryId: null, requestedVehicleType: "bike" }), "BIKE");
  assert.equal(normalizeVehicleType({ provider: "indrive", providerCategoryId: "2", requestedVehicleType: "car" }), "BIKE");
  assert.equal(normalizeVehicleType({ provider: "quickride", requestedVehicleType: "unknown-type" }), "UNKNOWN");
});
