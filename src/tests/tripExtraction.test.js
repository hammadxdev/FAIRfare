const test = require("node:test");
const assert = require("node:assert/strict");
const { extractTripLocations } = require("../services/tripExtraction.service");
const { resolveTripForAssistant } = require("../services/tripResolution.service");

test("extracts the complete North Nazimabad to Gulshan-e-Hameed Phase 2 trip", () => {
  assert.deepEqual(extractTripLocations("ok so i wanna go from north nazimabad to gulshan e hameed phase 2"), { pickup: "north nazimabad", destination: "gulshan e hameed phase 2", pattern: "from_to" });
});
test("supports English, Roman Urdu, labels, and phase names", () => {
  assert.equal(extractTripLocations("I want to go to LGU from Gulberg 3").pickup, "Gulberg 3");
  assert.deepEqual(extractTripLocations("I want to go to LGU from Gulberg III"), { pickup: "Gulberg III", destination: "LGU", pattern: "to_from" });
  assert.equal(extractTripLocations("Mujhe Gulberg se LGU jana hai").pickup, "Gulberg");
  assert.equal(extractTripLocations("Railway Station se Liberty jana hai").destination, "Liberty");
  assert.deepEqual(extractTripLocations("pickup is DHA Phase 6 and drop is Johar Town"), { pickup: "DHA Phase 6", destination: "Johar Town", pattern: "labeled" });
});
test("extracts natural airport-to-DHA request without filler or vehicle suffix", () => {
  assert.deepEqual(extractTripLocations("hi ia wanna go tomorrow from airport to dha via car"), { pickup: "airport", destination: "dha", pattern: "from_to" });
  assert.deepEqual(extractTripLocations("Tomorrow morning airport to DHA Phase 5"), { pickup: "airport", destination: "DHA Phase 5", pattern: "short_from_to" });
});
test("different districts do not become same-city merely because they share a country", async () => {
  const result = await resolveTripForAssistant({
    message: "from Karachi to Lahore",
    geocode: async ({ input }) => [{ name: input, address: input, city: input, county: input === "Karachi" ? "Karachi District" : "Lahore District", state: input === "Karachi" ? "Sindh" : "Punjab", lat: input === "Karachi" ? 24.85 : 31.56, lng: input === "Karachi" ? 67.02 : 74.31 }],
    route: async () => ({ distanceMeters: 1200000, durationSeconds: 42000 }),
  });
  assert.equal(result.status, "CROSS_CITY");
  assert.equal(result.cityMismatch, true);
});
test("generic place labels remain unresolved when Geoapify returns multiple cities", async () => {
  const result = await resolveTripForAssistant({
    message: "from Saddar to the airport",
    geocode: async ({ input }) => input === "Saddar"
      ? [{ name: "Saddar", city: "Rawalpindi", county: "Rawalpindi District", lat: 33.6, lng: 73.05 }, { name: "Saddar", city: "Karachi Division", county: "Karachi District", lat: 24.85, lng: 67.02 }]
      : [{ name: "Airport", city: "Lahore", county: "Lahore District", lat: 31.52, lng: 74.4 }, { name: "Airport", city: "Karachi", county: "Karachi District", lat: 24.9, lng: 67.18 }],
    route: async () => ({ distanceMeters: 1000, durationSeconds: 100 }),
  });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.unresolved, "pickup");
});
test("geocodes both locations and routes after successful resolution", async () => {
  const calls = [];
  const result = await resolveTripForAssistant({ message: "from North Nazimabad to Gulshan e Hameed Phase 2", geocode: async ({ input }) => { calls.push(`geocode:${input}`); return [{ name: input, address: `${input}, Karachi`, city: "Karachi", lat: input.includes("North") ? 24.9 : 24.93, lng: input.includes("North") ? 67.0 : 67.1 }]; }, route: async ({ origin, destination }) => { calls.push(`route:${origin.name}->${destination.name}`); return { distanceMeters: 10700, durationSeconds: 840 }; } });
  assert.equal(result.status, "RESOLVED");
  assert.deepEqual(calls, ["geocode:North Nazimabad", "geocode:Gulshan e Hameed Phase 2", "route:North Nazimabad->Gulshan e Hameed Phase 2"]);
});
test("resolves airport to DHA in the correct direction with mocked map results", async () => {
  const result = await resolveTripForAssistant({
    message: "hi ia wanna go tomorrow from airport to dha via car",
    geocode: async ({ input }) => input.toLowerCase().includes("airport")
      ? [{ name: "Allama Iqbal International Airport", address: "Airport Road, Lahore", city: "Lahore", county: "Lahore District", resultType: "amenity", lat: 31.52, lng: 74.4 }]
      : [{ name: "DHA", address: "DHA Lahore, Lahore", city: "Lahore", county: "Lahore District", resultType: "suburb", lat: 31.47, lng: 74.4 }],
    route: async ({ origin, destination }) => ({ distanceMeters: origin.lat === 31.52 && destination.lat === 31.47 ? 12000 : 0, durationSeconds: 1200 }),
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.pickup.name, "Allama Iqbal International Airport");
  assert.equal(result.destination.name, "DHA");
  assert.equal(result.route.distanceMeters, 12000);
});
test("same administrative district prevents a false cross-city result", async () => {
  const result = await resolveTripForAssistant({
    message: "from Gulberg III to Lahore Garrison University",
    geocode: async ({ input }) => [{
      name: input,
      address: `${input}, Lahore, Pakistan`,
      city: input.includes("Gulberg") ? "Lahore" : "Lidher",
      county: "Lahore District",
      state: "Punjab",
      lat: input.includes("Gulberg") ? 31.5164 : 31.4637,
      lng: input.includes("Gulberg") ? 74.3448 : 74.4431,
    }],
    route: async () => ({ distanceMeters: 14190, durationSeconds: 1180 }),
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.cityMismatch, false);
});
test("rejects unrelated POIs when the exact university or area name is not present", async () => {
  const result = await resolveTripForAssistant({
    message: "from Gulberg III to Lahore Garrison University",
    geocode: async ({ input }) => input.includes("Gulberg")
      ? [{ name: "Ambassador Travel & Tours", address: "Main Boulevard, Lahore", city: "Lahore", category: "commercial.service", lat: 31.5164, lng: 74.3448 }]
      : [{ name: "Lahore Leads University", address: "Lahore, Punjab", city: "Lahore", category: "education", lat: 31.503, lng: 74.329 }],
    route: async () => ({ distanceMeters: 1000, durationSeconds: 100 }),
  });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.unresolved, "pickup");
});

test("resolves Gulberg III to Lahore Garrison University through safe aliases and labels the area match approximate", async () => {
  const calls = [];
  const result = await resolveTripForAssistant({
    message: "I wanna go from Gulberg III to Lahore Garrison University",
    geocode: async ({ input }) => {
      calls.push(input);
      if (/garrison|garission/i.test(input)) return [{ name: "Lahore Garission University", address: "Lahore Garission University, Lahore", city: "Lahore", county: "Lahore District", resultType: "amenity", category: "education.university", confidence: 0.66, lat: 31.4638, lng: 74.4431 }];
      if (/gulberg 3, lahore/i.test(input)) return [{ name: "Gulberg 3", address: "Gulberg 3, Model Town Tehsil, Lahore District", city: "Model Town Tehsil", county: "Lahore District", resultType: "street", confidence: 0.9, lat: 31.51, lng: 74.34 }];
      return [{ name: "Ambassador Travel & Tours", address: "Main Boulevard, Lahore", city: "Lahore", county: "Lahore District", category: "commercial.service", lat: 31.5164, lng: 74.3448 }];
    },
    route: async ({ origin, destination }) => ({ distanceMeters: origin.lat && destination.lat ? 15000 : 0, durationSeconds: 1100 }),
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.pickup.name, "Gulberg 3");
  assert.equal(result.pickup.approximate, true);
  assert.equal(result.destination.name, "Lahore Garrison University");
  assert.equal(result.cityMismatch, false);
  assert.ok(calls.includes("Gulberg 3, Lahore"));
});

test("maps LGU to Lahore Garrison University only after the initial acronym search is unresolved", async () => {
  const calls = [];
  const result = await resolveTripForAssistant({
    message: "Gulberg 3 to LGU",
    geocode: async ({ input }) => {
      calls.push(input);
      if (/Lahore Garrison University/i.test(input)) return [{ name: "Lahore Garission University", address: "Lahore Garission University, Lahore", city: "Lahore", county: "Lahore District", resultType: "amenity", category: "education.university", confidence: 0.66, lat: 31.4638, lng: 74.4431 }];
      if (/LGU/i.test(input)) return [{ name: "Lahore Grammar School", address: "Lahore, Lahore District", city: "Lahore", county: "Lahore District", category: "education.school", lat: 31.5, lng: 74.34 }];
      return [{ name: "Gulberg 3", address: "Gulberg 3, Lahore District", city: "Lahore", county: "Lahore District", resultType: "street", confidence: 0.9, lat: 31.51, lng: 74.34 }];
    },
    route: async () => ({ distanceMeters: 15000, durationSeconds: 1100 }),
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.destination.name, "Lahore Garrison University");
  assert.ok(calls.includes("Lahore Garrison University"));
});
