const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { validate } = require("../../scripts/validateFareDataset");
const { validateFairFareDatasetV1 } = require("../services/fairFareDatasetValidator.service");
const { getDatasetMode, resolveTripCoverage, estimateDatasetFare } = require("../services/fairFareDataset.service");
const { getAllAdapters } = require("../providers/provider.registry");
const { comparisonContext, derivedFacts } = require("../services/ai/aiRideAssistant.service");

test("synthetic training dataset is present, typed, unique, and has at least 500 rows", () => {
  const report = validate(path.join(__dirname, "../../ml/datasets/fare_training_synthetic.csv"));
  assert.equal(report.rows, 600);
  assert.equal(report.uniqueIds, 600);
  assert.equal(report.errors.length, 0);
});

test("Fair Fare v1 dataset is internally valid but has no production coverage", () => {
  const report = validateFairFareDatasetV1();
  assert.deepEqual(report.errors, []);
  assert.equal(report.files["synthetic_fare_scenarios.csv"].rows, 30000);
  assert.equal(report.coverage.verifiedRows, 0);
  assert.equal(report.coverage.productionEnabledRows, 0);
  assert.equal(report.coverage.vehicleCoverageVerifiedRows, 0);
  assert.equal(report.scenario.allSynthetic, true);
  assert.equal(report.scenario.allNonLive, true);
  assert.equal(report.scenario.allIneligible, true);
  assert.deepEqual(report.coverage.missingCityProviderRows, []);
  assert.deepEqual(report.coverage.unexpectedCityProviderRows, []);
});

test("coverage evidence register accounts for all 63 rows without activating any record", () => {
  const file = path.join(__dirname, "../../COVERAGE_EVIDENCE_REGISTER.csv");
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, 64);
  const headers = lines.shift().split(",");
  const rows = lines.map((line) => line.split(","));
  const index = (name) => headers.indexOf(name);
  assert.equal(new Set(rows.map((row) => row[index("city_id")])).size, 21);
  assert.equal(new Set(rows.map((row) => `${row[index("city_id")]}|${row[index("provider_internal_id")]}`)).size, 63);
  assert.ok(rows.every((row) => row[index("reviewer_approved")] === "false"));
  assert.ok(rows.every((row) => row[index("production_enabled")] === "false"));
  assert.ok(rows.every((row) => row[index("source_url")].startsWith("https://")));
});

test("coverage fails closed for unverified, limited-city, and intercity requests", () => {
  const lahore = resolveTripCoverage({ pickup: { name: "Gulberg III, Lahore" }, dropoff: { name: "LGU, Lahore" }, provider: "inDrive", vehicleType: "bike" });
  const limited = resolveTripCoverage({ pickup: { name: "Wah" }, dropoff: { name: "Taxila" }, provider: "Yango", vehicleType: "bike" });
  const intercity = resolveTripCoverage({ pickup: { name: "Lahore" }, dropoff: { name: "Karachi" }, provider: "Bykea", vehicleType: "bike" });
  assert.equal(lahore.supported, false);
  assert.equal(lahore.status, "PROVIDER_CITY_UNVERIFIED");
  assert.equal(limited.supported, false);
  assert.equal(intercity.status, "INTERCITY_COVERAGE_UNVERIFIED");
});

test("dataset mode defaults safely and provider IDs remain the existing app IDs", () => {
  const previous = process.env.FAIR_FARE_DATASET_MODE;
  delete process.env.FAIR_FARE_DATASET_MODE;
  assert.equal(getDatasetMode(), "legacy");
  process.env.FAIR_FARE_DATASET_MODE = "preview";
  assert.equal(getDatasetMode(), "preview");
  process.env.FAIR_FARE_DATASET_MODE = "verified";
  assert.equal(getDatasetMode(), "verified");
  process.env.FAIR_FARE_DATASET_MODE = "invalid-mode";
  assert.equal(getDatasetMode(), "legacy");
  if (previous === undefined) delete process.env.FAIR_FARE_DATASET_MODE; else process.env.FAIR_FARE_DATASET_MODE = previous;
  assert.deepEqual(getAllAdapters().map((adapter) => [adapter.id || adapter.name, adapter.displayName]), [["indrive", "inDrive"], ["quickride", "Yango"], ["urbancab", "Bykea"]]);
});

test("dataset baseline is deterministic and separates uncertainty from the scalar fare", () => {
  const input = { vehicleType: "bike", distanceKm: 8, durationMin: 24, hourOfDay: 12, dayOfWeek: 2, weather: { condition: "CLEAR", source: "OPEN_METEO" } };
  const first = estimateDatasetFare(input);
  const second = estimateDatasetFare(input);
  assert.deepEqual(first, second);
  assert.equal(first.fareMin, null);
  assert.equal(first.fareMax, null);
  assert.equal(first.metadata.provenance, "Fair Fare model-based estimate; not a live provider quotation");
  assert.equal(first.metadata.uncertainty.method, "synthetic_assumption_max_15_or_8_percent_not_calibrated");
});

test("AI grounding uses only public fare results and cannot select unverified rows", () => {
  const context = comparisonContext({
    coverage: { mode: "verified", providers: [{ provider: "quickride", displayName: "Yango", status: "PROVIDER_CITY_UNVERIFIED", supported: false }] },
    results: [{ provider: { name: "quickride", displayName: "Yango" }, fare: null, isAvailable: false, coverage: { status: "PROVIDER_CITY_UNVERIFIED" } }],
  });
  assert.deepEqual(derivedFacts(context.rides), { cheapest: null, pickupEstimate: null, bookWaitStatus: null });
});

test("weekday/peak and reliable weather inputs affect the deterministic model once coverage is approved", () => {
  const base = { vehicleType: "bike", distanceKm: 8, durationMin: 24, weather: { condition: "CLEAR", source: "OPEN_METEO" } };
  const offPeak = estimateDatasetFare({ ...base, hourOfDay: 12, dayOfWeek: 2 });
  const peak = estimateDatasetFare({ ...base, hourOfDay: 8, dayOfWeek: 2 });
  const rainy = estimateDatasetFare({ ...base, hourOfDay: 12, dayOfWeek: 2, weather: { condition: "RAIN", weatherSeverity: "MODERATE", source: "OPEN_METEO" } });
  const unknownWeather = estimateDatasetFare({ ...base, hourOfDay: 12, dayOfWeek: 2, weather: { condition: "RAIN", source: "UNAVAILABLE" } });
  assert.ok(peak.fare > offPeak.fare);
  assert.ok(rainy.fare > offPeak.fare);
  assert.equal(unknownWeather.fare, offPeak.fare);
});
