const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const googleMapsService = require("../services/googleMaps.service");

// Never let these tests hit real Google APIs: every test either exercises a
// validation path that returns before any Google call, or monkey-patches
// googleMapsService's exported functions with fakes.
const originalFetchAutocomplete = googleMapsService.fetchAutocomplete;
const originalFetchPlaceDetails = googleMapsService.fetchPlaceDetails;
const originalFetchReverseGeocode = googleMapsService.fetchReverseGeocode;
const originalComputeRoute = googleMapsService.computeRoute;
const originalGlobalFetch = global.fetch;

test.afterEach(() => {
  googleMapsService.fetchAutocomplete = originalFetchAutocomplete;
  googleMapsService.fetchPlaceDetails = originalFetchPlaceDetails;
  googleMapsService.fetchReverseGeocode = originalFetchReverseGeocode;
  googleMapsService.computeRoute = originalComputeRoute;
  global.fetch = originalGlobalFetch;
  delete process.env.GOOGLE_MAPS_API_KEY;
});

test("autocomplete returns empty array for input shorter than 3 characters", async () => {
  const res = await request(app).get("/api/maps/autocomplete").query({ input: "un", sessionToken: "abc" });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []);
});

test("autocomplete returns safe error when Google API key is missing", async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  googleMapsService.fetchAutocomplete = originalFetchAutocomplete;

  const res = await request(app)
    .get("/api/maps/autocomplete")
    .query({ input: "university", sessionToken: "abc-key-missing-test" });

  assert.equal(res.status, 500);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Google Maps API key is missing/);
});

test("autocomplete returns normalized mocked results", async () => {
  googleMapsService.fetchAutocomplete = async () => [
    {
      placeId: "place-1",
      description: "University Road, Sialkot, Pakistan",
      mainText: "University Road",
      secondaryText: "Sialkot, Pakistan",
    },
  ];

  const res = await request(app)
    .get("/api/maps/autocomplete")
    .query({ input: "university", sessionToken: "session-autocomplete-1" });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data[0].placeId, "place-1");
  assert.equal(res.body.data[0].mainText, "University Road");
});

test("autocomplete forwards optional user coordinates without changing the session token", async () => {
  let received;
  googleMapsService.fetchAutocomplete = async (input) => {
    received = input;
    return [];
  };

  const res = await request(app)
    .get("/api/maps/autocomplete")
    .query({ input: "KFC", sessionToken: "session-location-1", lat: 31.5204, lng: 74.3587 });

  assert.equal(res.status, 200);
  assert.deepEqual(received, { input: "KFC", sessionToken: "session-location-1", lat: 31.5204, lng: 74.3587 });
});

test("autocomplete works without location context and does not invent coordinates", async () => {
  let received;
  googleMapsService.fetchAutocomplete = async (input) => {
    received = input;
    return [];
  };

  const res = await request(app)
    .get("/api/maps/autocomplete")
    .query({ input: "KFC", sessionToken: "session-location-2" });

  assert.equal(res.status, 200);
  assert.deepEqual(received, { input: "KFC", sessionToken: "session-location-2", lat: null, lng: null });
});

test("Google autocomplete uses location bias only when coordinates are supplied", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { json: async () => ({ status: "ZERO_RESULTS", predictions: [] }) };
  };

  await googleMapsService.fetchAutocomplete({ input: "KFC", sessionToken: "session-google-location-1", lat: 31.5204, lng: 74.3587 });
  const withLocation = new URL(requestedUrl);
  assert.equal(withLocation.searchParams.get("location"), "31.5204,74.3587");
  assert.equal(withLocation.searchParams.get("radius"), "50000");
  assert.equal(withLocation.searchParams.get("sessiontoken"), "session-google-location-1");

  await googleMapsService.fetchAutocomplete({ input: "KFC", sessionToken: "session-google-location-2" });
  const withoutLocation = new URL(requestedUrl);
  assert.equal(withoutLocation.searchParams.has("location"), false);
  assert.equal(withoutLocation.searchParams.has("radius"), false);
});

test("place details validates missing placeId", async () => {
  const res = await request(app).get("/api/maps/place-details").query({ sessionToken: "abc" });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("placeId")));
});

test("place details returns normalized mocked result", async () => {
  googleMapsService.fetchPlaceDetails = async () => ({
    placeId: "place-1",
    name: "University Road",
    address: "University Road, Sialkot, Pakistan",
    lat: 32.4945,
    lng: 74.5229,
  });

  const res = await request(app)
    .get("/api/maps/place-details")
    .query({ placeId: "place-1", sessionToken: "session-details-1" });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, "University Road");
  assert.equal(res.body.data.lat, 32.4945);
});

test("reverse geocode validates invalid coordinates", async () => {
  const res = await request(app).get("/api/maps/reverse-geocode").query({ lat: "notanumber", lng: 74.5 });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("lat")));
});

test("reverse geocode returns normalized mocked result", async () => {
  googleMapsService.fetchReverseGeocode = async ({ lat, lng }) => ({
    name: "Selected Location",
    address: "Kashmir Road, Sialkot, Pakistan",
    lat,
    lng,
  });

  const res = await request(app)
    .get("/api/maps/reverse-geocode")
    .query({ lat: 32.5018, lng: 74.5353 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, "Selected Location");
  assert.equal(res.body.data.address, "Kashmir Road, Sialkot, Pakistan");
});

test("reverse geocode keeps GPS coordinates and derives a readable name", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  global.fetch = async () => ({
    json: async () => ({
      status: "OK",
      results: [{
        formatted_address: "Kashmir Road, Sialkot, Pakistan",
        address_components: [{ long_name: "Kashmir Road", types: ["route"] }],
      }],
    }),
  });

  const result = await googleMapsService.fetchReverseGeocode({ lat: 31.5204, lng: 74.3587 });
  assert.equal(result.name, "Kashmir Road");
  assert.equal(result.address, "Kashmir Road, Sialkot, Pakistan");
  assert.equal(result.lat, 31.5204);
  assert.equal(result.lng, 74.3587);
});

test("route endpoint validates missing origin/destination", async () => {
  const res = await request(app).post("/api/maps/route").send({ vehicleType: "bike" });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.errors.some((e) => e.includes("origin")));
  assert.ok(res.body.errors.some((e) => e.includes("destination")));
});

test("route endpoint response is normalized when Google service is mocked", async () => {
  googleMapsService.computeRoute = async () => ({
    distanceMeters: 6800,
    durationSeconds: 1080,
    encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
  });

  const res = await request(app)
    .post("/api/maps/route")
    .send({
      origin: { lat: 32.4945, lng: 74.5229 },
      destination: { lat: 32.5201, lng: 74.56 },
      vehicleType: "bike",
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.distanceKm, 6.8);
  assert.equal(res.body.data.durationMin, 18);
  assert.ok(Array.isArray(res.body.data.polylineCoordinates));
  assert.ok(res.body.data.polylineCoordinates.length > 0);
});

test("usage endpoint returns request counters", async () => {
  const res = await request(app).get("/api/maps/usage");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(typeof res.body.data.totalGoogleRequests === "number");
  assert.ok(typeof res.body.data.dailyLimit === "number");
});
