const test = require("node:test");
const assert = require("node:assert/strict");
const { decodePolyline, validateRouteCoordinates } = require("../services/polyline.service");

test("precision-5 decoded route coordinates remain in valid bounds", () => {
  const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.ok(points.every((point) => point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180));
});

test("reported production coordinates fail strict backend validation", () => {
  const result = validateRouteCoordinates(
    [
      { latitude: -994.83648, longitude: 8 },
      { latitude: -2106.83648, longitude: 2715 },
    ],
    { lat: 31.474559870753506, lng: 74.41546671755498 },
    { lat: 31.4637789, lng: 74.4431405 },
    4600,
    420
  );
  assert.deepEqual({ valid: result.valid, reason: result.reason }, { valid: false, reason: "invalid-coordinate" });
});

test("valid Lahore route endpoints pass strict validation", () => {
  const result = validateRouteCoordinates(
    [
      { latitude: 31.4746, longitude: 74.4155 },
      { latitude: 31.4638, longitude: 74.4431 },
    ],
    { lat: 31.474559870753506, lng: 74.41546671755498 },
    { lat: 31.4637789, lng: 74.4431405 },
    4600,
    420
  );
  assert.equal(result.valid, true);
});
