const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../services/tripAwareAiAssistant.service");
const registry = require("../services/ai/toolRegistry");

const originalFlag = process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
process.env.NODE_ENV = "test";
test.afterEach(() => {
  assistant.setTripResolverForTests();
  registry.resetToolDependenciesForTests();
  if (originalFlag === undefined) delete process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
  else process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED = originalFlag;
});

test("resolved ride requests execute the authenticated live comparison with route metrics", async () => {
  process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED = "true";
  const calls = [];
  assistant.setTripResolverForTests(async () => ({
    status: "RESOLVED",
    extracted: { pickup: "LGU", destination: "Gulberg 3" },
    pickup: { name: "Lahore Garrison University", lat: 31.46, lng: 74.44, placeId: "lgu" },
    destination: { name: "Gulberg 3", lat: 31.51, lng: 74.34, placeId: "gulberg-3" },
    city: "Lahore",
    route: { distanceMeters: 25300, durationSeconds: 1740 },
  }));
  registry.setToolDependenciesForTests({
    maps: { computeRoute: async ({ origin, destination }) => ({ distanceMeters: 25300, durationSeconds: 1740, origin, destination }) },
    compareFares: async (args) => { calls.push(args); return { comparisonId: "live-1", results: [{ provider: { displayName: "Yango" }, fare: 540, currency: "PKR", dataSource: "TEST", isAvailable: true }] }; },
  });

  const result = await assistant.answer({ userId: "user-1", message: "hi i wanna go from LGU to Gulberg 3 by car" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "user-1");
  assert.equal(calls[0].vehicleType, "car");
  assert.equal(calls[0].route.distanceKm, 25.3);
  assert.equal(calls[0].route.durationMin, 29);
  assert.equal(result.comparisonId, "live-1");
  assert.match(result.reply, /Yango: 540 PKR/);
});

test("disabled live comparison is reported by flag name after route resolution", async () => {
  delete process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
  assistant.setTripResolverForTests(async () => ({ status: "RESOLVED", extracted: { pickup: "LGU", destination: "Gulberg 3" }, pickup: { name: "LGU", lat: 31.46, lng: 74.44 }, destination: { name: "Gulberg 3", lat: 31.51, lng: 74.34 }, route: { distanceMeters: 25300, durationSeconds: 1740 } }));
  registry.setToolDependenciesForTests({ maps: { computeRoute: async () => ({ distanceMeters: 25300, durationSeconds: 1740 }) } });
  const result = await assistant.answer({ userId: "user-1", message: "from LGU to Gulberg 3" });
  assert.match(result.reply, /FAIRFARE_AI_LIVE_COMPARISON_ENABLED=false/);
});
