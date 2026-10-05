const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWeatherResponse,
  resolveWeatherContext,
  clearWeatherCache,
  emptyWeather,
} = require("../services/weatherContext.service");
const {
  SIMULATION_CONFIG,
  calculateSimulatedFare,
  weatherCalibrationMatrix,
} = require("../providers/simulation.engine");
const { createObservationRows } = require("../services/fareObservation.service");

const route = { distanceMeters: 8000, durationSeconds: 1500 };
const context = { hour: 13, dayOfWeek: 2, isWeekend: false };
const weather = (condition, weatherSeverity, precipitationMm = 3.2) => ({ condition, weatherSeverity, precipitationMm, temperatureC: 24, source: "FIXTURE" });

test("normalizes clear, rain, heavy rain, and storm weather without vendor codes leaking", () => {
  assert.deepEqual(normalizeWeatherResponse({ current: { weather_code: 0, precipitation: 0, temperature_2m: 24 } }, "fixed", "FIXTURE"), { condition: "CLEAR", weatherSeverity: "NONE", precipitationMm: 0, temperatureC: 24, observedAt: "fixed", source: "FIXTURE" });
  assert.equal(normalizeWeatherResponse({ current: { weather_code: 61, precipitation: 1, temperature_2m: 24 } }).condition, "RAIN");
  assert.equal(normalizeWeatherResponse({ current: { weather_code: 82, precipitation: 8, temperature_2m: 23 } }).condition, "HEAVY_RAIN");
  assert.equal(normalizeWeatherResponse({ current: { weather_code: 95, precipitation: 4, temperature_2m: 23 } }).condition, "STORM");
  assert.equal(normalizeWeatherResponse({ current: { weather_code: 0, precipitation: 0, temperature_2m: 38 } }).condition, "HOT");
  assert.equal(normalizeWeatherResponse({ nope: true }).condition, "UNKNOWN");
});

test("weather lookup is cached once per rounded pickup/time bucket", async () => {
  clearWeatherCache();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, async json() { return { current: { weather_code: 61, precipitation: 1.2, temperature_2m: 24 } }; } }; };
  const first = await resolveWeatherContext({ latitude: 31.47001, longitude: 74.28001, observedAt: 1_700_000_000_000, fetchImpl });
  const second = await resolveWeatherContext({ latitude: 31.47004, longitude: 74.28004, observedAt: 1_700_000_000_001, fetchImpl });
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test("weather failures return UNKNOWN and never throw", async () => {
  clearWeatherCache();
  const failed = await resolveWeatherContext({ latitude: 31.47, longitude: 74.28, observedAt: 1_800_000_000_000, fetchImpl: async () => { throw new Error("timeout"); } });
  assert.deepEqual(failed, emptyWeather(new Date(1_800_000_000_000).toISOString(), "UNAVAILABLE"));
});

test("every configured provider/category has distinct weather configuration and deterministic fare/ETA", () => {
  const clear = calculateSimulatedFare({ provider: "quickride", vehicleType: "bike", route, context, weather: weather("CLEAR", "NONE", 0) });
  const rain = calculateSimulatedFare({ provider: "quickride", vehicleType: "bike", route, context, weather: weather("RAIN", "MODERATE") });
  const heavy = calculateSimulatedFare({ provider: "quickride", vehicleType: "bike", route, context, weather: weather("HEAVY_RAIN", "HEAVY", 9) });
  assert.ok(rain.fare > clear.fare && heavy.fare > rain.fare);
  assert.ok(heavy.pickupEtaSeconds > clear.pickupEtaSeconds);
  for (const provider of Object.keys(SIMULATION_CONFIG)) for (const vehicleType of Object.keys(SIMULATION_CONFIG[provider].categories)) {
    const category = SIMULATION_CONFIG[provider].categories[vehicleType];
    assert.ok(category.weatherSensitivity && Object.keys(category.weatherSensitivity).length > 0);
    const a = calculateSimulatedFare({ provider, vehicleType, route, context, weather: weather("RAIN", "MODERATE") });
    const b = calculateSimulatedFare({ provider, vehicleType, route, context, weather: weather("RAIN", "MODERATE") });
    assert.deepEqual(a, b);
    assert.ok(Number.isFinite(a.fare) && a.fare >= 0 && a.pickupEtaSeconds > 0 && a.pickupEtaSeconds <= 720);
  }
});

test("weather response changes are category-specific and provider-specific", () => {
  const inDriveMoto = calculateSimulatedFare({ provider: "indrive", vehicleType: "bike", route, context, weather: weather("HEAVY_RAIN", "HEAVY", 9) });
  const inDrivePremium = calculateSimulatedFare({ provider: "indrive", vehicleType: "premium", route, context, weather: weather("HEAVY_RAIN", "HEAVY", 9) });
  const yangoBike = calculateSimulatedFare({ provider: "quickride", vehicleType: "bike", route, context, weather: weather("HEAVY_RAIN", "HEAVY", 9) });
  assert.notEqual(inDriveMoto.metadata.breakdown.weatherFactor, inDrivePremium.metadata.breakdown.weatherFactor);
  assert.notEqual(inDriveMoto.metadata.breakdown.weatherFactor, yangoBike.metadata.breakdown.weatherFactor);
});

test("observation rows store normalized weather fields and preserve simulated provenance", () => {
  const [row] = createObservationRows({
    pickup: { lat: 31.47, lng: 74.28 }, dropoff: { lat: 31.5, lng: 74.3 }, distanceMeters: 8000, durationSeconds: 1500,
    requestedVehicleType: "bike", observedAt: 1_700_000_000_000, weatherContext: weather("RAIN", "MODERATE"),
    results: [{ provider: { id: 1, name: "quickride" }, dataSource: "SIMULATED", quotes: [{ categoryId: "bike", categoryName: "Bike", fare: 219, currency: "PKR" }] }],
  });
  assert.equal(row.data_source, "SIMULATED");
  assert.deepEqual([row.weather_condition, row.weather_severity, row.precipitation_mm, row.temperature_c], ["RAIN", "MODERATE", 3.2, 24]);
});

test("weather calibration covers every provider/category and weather interaction", () => {
  const matrix = weatherCalibrationMatrix();
  assert.equal(matrix.length, 5 * (5 + 4 + 4));
  assert.ok(matrix.some((row) => row.scenario === "CLEAR" && row.fare !== matrix.find((other) => other.provider === row.provider && other.vehicleType === row.vehicleType && other.scenario === "HEAVY_RAIN").fare));
});
