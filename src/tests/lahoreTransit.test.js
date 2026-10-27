const test = require("node:test");
const assert = require("node:assert/strict");
const { planLahoreTransit, OFFICIAL_SOURCE } = require("../services/transit/lahoreTransit.service");

const point = (name) => ({ name, lat: 31.45, lng: 74.3, placeId: `test-${name}` });

test("plans a verified Lahore Metrobus trunk journey", () => {
  const result = planLahoreTransit({ origin: point("Gajjumata"), destination: point("Shahdara"), originName: "Gajjumata, Lahore", destinationName: "Shahdara, Lahore" });
  assert.equal(result.status, "OK");
  assert.equal(result.plans[0].mode, "metrobus");
  assert.equal(result.plans[0].fare.amount, 30);
  assert.equal(result.source.url, OFFICIAL_SOURCE.url);
});

test("plans a verified Orange Line journey with official fare band", () => {
  const result = planLahoreTransit({ origin: point("Dera Gujran"), destination: point("Ali Town"), originName: "Dera Gujran, Lahore", destinationName: "Ali Town, Lahore" });
  assert.equal(result.status, "OK");
  assert.equal(result.plans[0].mode, "orange_line");
  assert.equal(result.plans[0].fare.amount, 25);
});

test("refuses unsupported exact coverage instead of inventing a route", () => {
  const result = planLahoreTransit({ origin: point("Model Town"), destination: point("Johar Town"), originName: "Model Town, Lahore", destinationName: "Johar Town, Lahore" });
  assert.equal(result.status, "INSUFFICIENT_VERIFIED_COVERAGE");
  assert.deepEqual(result.plans, []);
});

test("refuses a non-Lahore city", () => {
  const result = planLahoreTransit({ origin: point("Gajjumata"), destination: point("Shahdara"), originName: "Gajjumata, Islamabad", destinationName: "Shahdara, Islamabad" });
  assert.equal(result.status, "UNSUPPORTED_CITY");
});
