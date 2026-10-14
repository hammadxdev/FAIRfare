const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
const tripAware = require("../services/tripAwareAiAssistant.service");
const { resolveTripForAssistant } = require("../services/tripResolution.service");

test("public /api/ai/chat uses trip-aware resolution without requesting street addresses", async () => {
  const auth = await createAuthenticatedTestUser(app, "Trip-aware endpoint user");
  const calls = [];
  tripAware.setTripResolverForTests(({ message }) => resolveTripForAssistant({
    message,
    geocode: async ({ input }) => {
      calls.push(`geocode:${input}`);
      if (/north nazimabad/i.test(input)) return [{ mainText: "North Nazimabad", description: "North Nazimabad, Karachi", city: "Karachi", lat: 24.93, lng: 67.04, placeId: "karachi-north-nazimabad" }];
      return [{ mainText: "Gulshan e Hameed Phase 2", description: "Gulshan e Hameed Phase 2, Karachi", city: "Karachi", lat: 24.91, lng: 67.10, placeId: "karachi-gulshan-e-hameed-2" }];
    },
    route: async ({ origin, destination }) => {
      calls.push(`route:${origin.placeId}->${destination.placeId}`);
      return { distanceMeters: 10700, durationSeconds: 840, geometryAvailable: true };
    }
  }));
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message: "ok so i wanna go from north nazimabad to gulshan e hameed phase 2" });
  assert.equal(response.status, 200);
  assert.match(response.body.data.reply, /North Nazimabad.*Gulshan e Hameed Phase 2/);
  assert.doesNotMatch(response.body.data.reply, /exact pickup street|exact destination address/i);
  assert.doesNotMatch(response.body.data.reply, /PKR\s*[\d,]+|Bykea|Yango|inDrive|\bRs\.?\s*[\d,]+|\b\d+\s* rupees?/i);
  assert.deepEqual(calls, ["geocode:north nazimabad", "geocode:gulshan e hameed phase 2", "route:karachi-north-nazimabad->karachi-gulshan-e-hameed-2"]);
  assert.ok(response.body.data.conversation);
  tripAware.setTripResolverForTests(undefined);
});
