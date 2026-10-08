const test = require("node:test");
const assert = require("node:assert/strict");
const maps = require("../services/maps");

const originalFetch = global.fetch;
const originalKey = process.env.GEOAPIFY_API_KEY;

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY;
  else process.env.GEOAPIFY_API_KEY = originalKey;
});

test("Geoapify autocomplete normalizes coordinates and uses valid proximity bias", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  let requested;
  global.fetch = async (url) => {
    requested = new URL(url);
    return response({ features: [{ properties: { place_id: "geo-1", name: "Emporium", formatted: "Emporium, Lahore", address_line2: "Lahore, Pakistan", lat: 31.47, lon: 74.34 } }] });
  };

  const results = await maps.fetchAutocomplete({ input: "Emporium", sessionToken: "ignored", lat: 31.47, lng: 74.34 });
  assert.equal(requested.pathname, "/v1/geocode/autocomplete");
  assert.equal(requested.searchParams.get("bias"), "proximity:74.34,31.47");
  assert.equal(results[0].placeId, "geo-1");
  assert.equal(results[0].lat, 31.47);
  assert.equal(results[0].lng, 74.34);
});

test("malformed autocomplete bias is ignored safely", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  let requested;
  global.fetch = async (url) => { requested = new URL(url); return response({ features: [] }); };
  await maps.fetchAutocomplete({ input: "Johar Town", lat: 999, lng: 74.3 });
  assert.equal(requested.searchParams.has("bias"), false);
});

test("Geoapify reverse geocoding preserves Fair Fare coordinates and address", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  global.fetch = async () => response({ features: [{ properties: { name: "Johar Town", formatted: "Johar Town, Lahore, Pakistan", lat: 31.47, lon: 74.27 } }] });
  const result = await maps.fetchReverseGeocode({ lat: 31.47, lng: 74.27 });
  assert.deepEqual(result, { name: "Johar Town", address: "Johar Town, Lahore, Pakistan", lat: 31.47, lng: 74.27 });
});

test("Geoapify place details preserves the legacy name/address contract", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  global.fetch = async () => response({ features: [{ properties: { place_id: "geo-1", formatted: "Emporium, Lahore", lat: 31.47, lon: 74.34 } }] });
  const result = await maps.fetchPlaceDetails({ placeId: "geo-1" });
  assert.deepEqual(result, { placeId: "geo-1", name: "Emporium, Lahore", address: "Emporium, Lahore", lat: 31.47, lng: 74.34 });
});

test("Geoapify routing normalizes meters, seconds, and MultiLineString geometry", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  let requested;
  global.fetch = async (url) => {
    requested = new URL(url);
    return response({ features: [{ properties: { distance: 7669, time: 554.872 }, geometry: { type: "MultiLineString", coordinates: [[[74.34, 31.47], [74.35, 31.48]], [[74.35, 31.48], [74.36, 31.49]]] } }] });
  };
  const result = await maps.computeRoute({ origin: { lat: 31.47, lng: 74.34 }, destination: { lat: 31.49, lng: 74.36 }, vehicleType: "car" });
  assert.equal(requested.pathname, "/v1/routing");
  assert.equal(requested.searchParams.get("mode"), "drive");
  assert.equal(result.distanceMeters, 7669);
  assert.equal(result.durationSeconds, 554.872);
  assert.ok(result.encodedPolyline.length > 0);
  assert.equal(requested.origin, "https://api.geoapify.com");
});

test("Geoapify bike routing uses motorcycle road mode", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  let requested;
  global.fetch = async (url) => { requested = new URL(url); return response({ features: [{ properties: { distance: 100, time: 10 }, geometry: { type: "LineString", coordinates: [[74.3, 31.5], [74.31, 31.51]] } }] }); };
  await maps.computeRoute({ origin: { lat: 31.5, lng: 74.3 }, destination: { lat: 31.51, lng: 74.31 }, vehicleType: "bike" });
  assert.equal(requested.searchParams.get("mode"), "motorcycle");
});

test("Geoapify failures are safe and active mode never calls Google", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  let requestedUrl = "";
  global.fetch = async (url) => { requestedUrl = String(url); return response({ message: "invalid api key" }, 401); };
  await assert.rejects(() => maps.fetchReverseGeocode({ lat: 31.5, lng: 74.3 }), /Geoapify reverse geocoding failed/);
  assert.equal(requestedUrl.includes("googleapis.com"), false);
  assert.equal(requestedUrl.includes("test-key"), true);
});

test("Geoapify timeout, empty results, malformed coordinates, and unusable routes fail safely", async () => {
  process.env.GEOAPIFY_API_KEY = "test-key";
  global.fetch = async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; };
  await assert.rejects(() => maps.fetchReverseGeocode({ lat: 31.5, lng: 74.3 }), /timed out/);

  global.fetch = async () => response({ features: [] });
  assert.deepEqual(await maps.fetchAutocomplete({ input: "NoSuchPlace" }), []);
  assert.deepEqual(await maps.fetchReverseGeocode({ lat: 31.5, lng: 74.3 }), { name: null, address: null, lat: 31.5, lng: 74.3 });
  await assert.rejects(() => maps.fetchReverseGeocode({ lat: 91, lng: 74.3 }), /Invalid coordinates/);
  await assert.rejects(() => maps.computeRoute({ origin: { lat: 31.5, lng: 74.3 }, destination: { lat: 31.6, lng: 74.4 }, vehicleType: "car" }), /no usable road route/);
});

test("missing Geoapify key does not reveal configuration values", async () => {
  delete process.env.GEOAPIFY_API_KEY;
  await assert.rejects(() => maps.fetchReverseGeocode({ lat: 31.5, lng: 74.3 }), /Geoapify map services are not configured/);
});
