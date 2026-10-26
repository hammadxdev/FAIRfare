const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../services/tripAwareAiAssistant.service");
const registry = require("../services/ai/toolRegistry");
const { validateToolArguments } = require("../services/ai/toolSchemas");
const { executeToolCalls } = require("../services/ai/toolExecutor.service");

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

test("verified Lahore current trip sends schema-valid normalized route to the fare service", async () => {
  process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED = "true";
  const calls = [];
  assistant.setTripResolverForTests(async () => ({
    status: "RESOLVED",
    extracted: { pickup: "DHA Phase 5 Lahore", destination: "Allama Iqbal International Airport Lahore" },
    pickup: { name: "DHA Phase 5 Lahore", lat: 31.4697, lng: 74.4036, placeId: "lahore-dha-5" },
    destination: { name: "Allama Iqbal International Airport Lahore", lat: 31.5216, lng: 74.4036, placeId: "lahore-airport" },
    city: "Lahore",
    route: { distanceMeters: 18000, durationSeconds: 2400, providerRouteId: "internal-route", geometry: "internal-only" },
  }));
  registry.setToolDependenciesForTests({
    compareFares: async (args) => {
      calls.push(args);
      return { comparisonId: "lahore-live-1", results: [{ provider: { displayName: "Yango" }, fare: 540, currency: "PKR", dataSource: "REAL", source: "live", isAvailable: true, metadata: { providerFreshness: "current" } }] };
    },
  });

  const result = await assistant.answer({ userId: "user-lahore", message: "Compare ride fares from DHA Phase 5 Lahore to Allama Iqbal International Airport Lahore by car" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: "user-lahore",
    pickup: { name: "DHA Phase 5 Lahore", lat: 31.4697, lng: 74.4036, placeId: "lahore-dha-5" },
    dropoff: { name: "Allama Iqbal International Airport Lahore", lat: 31.5216, lng: 74.4036, placeId: "lahore-airport" },
    vehicleType: "car",
    route: { distanceKm: 18, durationMin: 40, distanceMeters: 18000, durationSeconds: 2400, eligibilityReason: null },
  });
  assert.deepEqual(validateToolArguments("compare_live_fares", {
    pickup: calls[0].pickup,
    dropoff: calls[0].dropoff,
    vehicleType: calls[0].vehicleType,
    route: calls[0].route,
    explicitComparisonIntent: true,
  }), { ok: true });
  assert.equal(validateToolArguments("compare_live_fares", {
    pickup: calls[0].pickup,
    dropoff: calls[0].dropoff,
    vehicleType: calls[0].vehicleType,
    route: { ...calls[0].route, providerRouteId: "resolver-only-field" },
    explicitComparisonIntent: true,
  }).code, "INVALID_ROUTE_ARGUMENTS");
  assert.equal(result.comparisonId, "lahore-live-1");
});

test("disabled model-selected comparison is rejected before the fare service", async () => {
  delete process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
  let fareCalls = 0;
  registry.setToolDependenciesForTests({ compareFares: async () => { fareCalls += 1; throw new Error("fare service must not be reached"); } });
  const result = await executeToolCalls([{ name: "compare_live_fares", arguments: {
    pickup: { lat: 31.4697, lng: 74.4036 },
    dropoff: { lat: 31.5216, lng: 74.4036 },
    explicitComparisonIntent: true,
  } }], { userId: "user-lahore", explicitComparisonIntent: true, liveComparisonEnabled: false, deadlineAt: Date.now() + 1000 });
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].result.status, "LIVE_COMPARISON_DISABLED");
  assert.equal(fareCalls, 0);
});

test("disabled live comparison is reported by flag name after route resolution", async () => {
  delete process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED;
  let fareCalls = 0;
  assistant.setTripResolverForTests(async () => ({ status: "RESOLVED", extracted: { pickup: "LGU", destination: "Gulberg 3" }, pickup: { name: "LGU", lat: 31.46, lng: 74.44 }, destination: { name: "Gulberg 3", lat: 31.51, lng: 74.34 }, route: { distanceMeters: 25300, durationSeconds: 1740 } }));
  registry.setToolDependenciesForTests({ maps: { computeRoute: async () => ({ distanceMeters: 25300, durationSeconds: 1740 }) }, compareFares: async () => { fareCalls += 1; throw new Error("fare service must not be reached"); } });
  const result = await assistant.answer({ userId: "user-1", message: "from LGU to Gulberg 3" });
  assert.match(result.reply, /FAIRFARE_AI_LIVE_COMPARISON_ENABLED=false/);
  assert.equal(fareCalls, 0);
});
