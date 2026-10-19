const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_ORDER_TYPE_IDS, mapIndrivePricingRequest, normalizeIndrivePricingResponse } = require("../providers/indrive-pricing.contract");

const trip = { pickup: { latitude: 31.4742, longitude: 74.4163 }, destination: { latitude: 31.5204, longitude: 74.3587 }, distanceMeters: 9301, durationSeconds: 1139 };

test("pure request mapping preserves documented route, geo and all ride categories", () => {
  assert.deepEqual(mapIndrivePricingRequest(trip), {
    order_type_ids: DEFAULT_ORDER_TYPE_IDS,
    route: [{ lat: 31.4742, lng: 74.4163 }, { lat: 31.5204, lng: 74.3587 }],
    geo: { distance_meters: 9301, duration_seconds: 1139, toll_cost: 0, points: [] },
  });
});

test("sanitized fixture converts each documented ride type to PKR and preserves price ranges", () => {
  const response = normalizeIndrivePricingResponse({ currency: "PKR", estimates: [
    { categoryId: "2", rideType: "2", categoryName: "Moto", fareMinor: 16300, fareMinMinor: 14000, fareMaxMinor: 18500, priceType: "suggested", negotiable: true },
    { categoryId: "33", rideType: "33", categoryName: "Mini", fareMinor: 45000, fareMinMinor: 45000, fareMaxMinor: 45000, priceType: "fixed" },
    { categoryId: "31", rideType: "31", categoryName: "Rickshaw", fareMinor: 30000, priceType: "estimate" },
    { categoryId: "29", rideType: "29", categoryName: "Ride AC", fareMinor: 62000, priceType: "fixed" },
    { categoryId: "11", rideType: "11", categoryName: "Premium", fareMinor: 78000, priceType: "fixed" },
  ] }, { currencyMultiplier: 100 });
  assert.equal(response.status, "available"); assert.equal(response.source, "live"); assert.equal(response.currency, "PKR");
  assert.deepEqual(response.estimates.map((item) => [item.rideType, item.fare, item.fareMin, item.fareMax, item.priceType]), [
    ["2", 163, 140, 185, "suggested"], ["33", 450, 450, 450, "fixed"], ["31", 300, null, null, "estimate"],
    ["29", 620, null, null, "fixed"], ["11", 780, null, null, "fixed"],
  ]);
});

test("invalid, expired and incomplete pricing responses are rejected", () => {
  assert.equal(normalizeIndrivePricingResponse({ currency: "PKR", estimates: [{ rideType: "ride_moto", fareMinor: 0 }] }).status, "provider_error");
  assert.equal(normalizeIndrivePricingResponse({ currency: "PKR", expiresAt: "2020-01-01T00:00:00.000Z", estimates: [{ fareMinor: 100 }] }).errorCode, "STALE_PROVIDER_RESPONSE");
  assert.equal(normalizeIndrivePricingResponse({ estimates: [{ fareMinor: 100 }] }).errorCode, "PROVIDER_CURRENCY_MISSING");
  assert.equal(normalizeIndrivePricingResponse({ currency: "PKR", expiresAt: "not-a-date", estimates: [{ fareMinor: 100 }] }).errorCode, "PROVIDER_CONTRACT_INVALID");
});
