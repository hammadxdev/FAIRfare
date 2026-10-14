const fs = require("fs");
const path = require("path");
const { DATASET_DIR, parseCsv } = require("./fairFareDataset.service");

const FILES = ["cities.csv", "provider_city_coverage.csv", "vehicle_pricing_parameters.csv", "time_rules.csv", "weather_rules.csv", "event_rules.csv", "synthetic_fare_scenarios.csv"];
const REQUIRED_HEADERS = {
  "cities.csv": ["city_id", "city", "province", "coverage_evidence", "coverage_verified", "city_status", "is_synthetic"],
  "provider_city_coverage.csv": ["city", "provider", "coverage_status", "verified", "source_url", "last_verified_at", "vehicle_coverage_status", "production_enabled"],
  "vehicle_pricing_parameters.csv": ["vehicle_type", "base_pkr", "per_km_pkr", "per_min_pkr", "min_fare_pkr", "pricing_source", "calibration_status", "model_version"],
  "time_rules.csv": ["weekday_index", "weekday_name", "hour_local", "peak_class", "illustrative_multiplier", "is_synthetic"],
  "weather_rules.csv": ["weather", "illustrative_multiplier", "bike_safety_warning", "verified_live", "is_synthetic"],
  "event_rules.csv": ["event_type", "pricing_multiplier", "requires_verified_source", "apply_as_automatic_surcharge", "handling"],
  "synthetic_fare_scenarios.csv": ["scenario_id", "city", "provider", "vehicle_type", "provider_city_coverage", "vehicle_coverage", "production_eligible", "route_id", "route_is_real", "distance_km", "duration_min", "weekday_index", "weekday_name", "hour_local", "peak_class", "weather", "popular_zone_synthetic", "popular_peak_adjustment_pkr", "peak_multiplier", "weather_multiplier", "event_status", "estimated_fare_pkr", "uncertainty_margin_pkr", "illustrative_low_pkr", "illustrative_high_pkr", "price_is_live", "is_synthetic", "model_version", "calibration_status"],
};
const NUMERIC_FIELDS = { "vehicle_pricing_parameters.csv": ["base_pkr", "per_km_pkr", "per_min_pkr", "min_fare_pkr"], "time_rules.csv": ["weekday_index", "hour_local", "illustrative_multiplier"], "weather_rules.csv": ["illustrative_multiplier"], "event_rules.csv": ["pricing_multiplier"], "synthetic_fare_scenarios.csv": ["distance_km", "duration_min", "weekday_index", "hour_local", "popular_peak_adjustment_pkr", "peak_multiplier", "weather_multiplier", "estimated_fare_pkr", "uncertainty_margin_pkr", "illustrative_low_pkr", "illustrative_high_pkr"] };

function duplicateCount(rows, key) { const seen = new Set(); let count = 0; for (const row of rows) { const value = key(row); if (seen.has(value)) count += 1; seen.add(value); } return count; }

function validateFairFareDatasetV1(datasetDir = DATASET_DIR) {
  const report = { datasetDir: path.resolve(datasetDir), files: {}, errors: [], warnings: [], coverage: {}, scenario: {} };
  const tables = {};
  for (const file of FILES) {
    const fullPath = path.join(datasetDir, file);
    if (!fs.existsSync(fullPath)) { report.errors.push(`missing file: ${file}`); continue; }
    const rows = parseCsv(fs.readFileSync(fullPath, "utf8")); tables[file] = rows;
    const missingHeaders = REQUIRED_HEADERS[file].filter((header) => !Object.keys(rows[0] || {}).includes(header));
    if (missingHeaders.length) report.errors.push(`${file} missing headers: ${missingHeaders.join(", ")}`);
    for (const field of NUMERIC_FIELDS[file] || []) rows.forEach((row, index) => { if (row[field] === "" || !Number.isFinite(Number(row[field]))) report.errors.push(`${file}:${index + 2} invalid numeric ${field}`); });
    report.files[file] = { rows: rows.length, headers: Object.keys(rows[0] || {}) };
  }
  const cities = tables["cities.csv"] || [], coverage = tables["provider_city_coverage.csv"] || [], vehicles = tables["vehicle_pricing_parameters.csv"] || [], scenarios = tables["synthetic_fare_scenarios.csv"] || [];
  const citySet = new Set(cities.map((row) => row.city)); const providerSet = new Set(coverage.map((row) => row.provider)); const vehicleSet = new Set(vehicles.map((row) => row.vehicle_type));
  const expectedProviders = new Set(["inDrive", "Yango", "Bykea"]);
  const expectedCityProviderKeys = new Set(cities.flatMap((city) => [...expectedProviders].map((provider) => `${city.city}|${provider}`)));
  const actualCityProviderKeys = new Set(coverage.map((row) => `${row.city}|${row.provider}`));
  const missingCityProviderRows = [...expectedCityProviderKeys].filter((key) => !actualCityProviderKeys.has(key));
  const unexpectedCityProviderRows = [...actualCityProviderKeys].filter((key) => !expectedCityProviderKeys.has(key));
  if (cities.length !== 21) report.warnings.push(`Expected 21 candidate cities; found ${cities.length}.`);
  if (coverage.length !== 63 || missingCityProviderRows.length || unexpectedCityProviderRows.length) {
    report.errors.push(`Expected complete 21x3 city-provider matrix; rows=${coverage.length}, missing=${missingCityProviderRows.length}, unexpected=${unexpectedCityProviderRows.length}`);
  }
  for (const [index, row] of scenarios.entries()) {
    const line = index + 2;
    if (!citySet.has(row.city)) report.errors.push(`synthetic_fare_scenarios.csv:${line} unknown city ${row.city}`);
    if (!providerSet.has(row.provider)) report.errors.push(`synthetic_fare_scenarios.csv:${line} unknown provider ${row.provider}`);
    if (!vehicleSet.has(row.vehicle_type)) report.errors.push(`synthetic_fare_scenarios.csv:${line} unknown vehicle ${row.vehicle_type}`);
    for (const field of ["distance_km", "duration_min", "estimated_fare_pkr"]) if (!Number.isFinite(Number(row[field])) || Number(row[field]) <= 0) report.errors.push(`synthetic_fare_scenarios.csv:${line} invalid ${field}`);
    if (Number(row.weekday_index) < 0 || Number(row.weekday_index) > 6 || Number(row.hour_local) < 0 || Number(row.hour_local) > 23) report.errors.push(`synthetic_fare_scenarios.csv:${line} time out of range`);
  }
  const unsafeEnabled = coverage.filter((row) => row.production_enabled === "True" && (row.verified !== "True" || !/(^|_)(verified|supported|approved)(_|$)/i.test(row.vehicle_coverage_status || "")));
  report.errors.push(...unsafeEnabled.map((row) => `coverage enables unverified combination: ${row.city}|${row.provider}`));
  report.coverage = { cities: cities.length, providerCityRows: coverage.length, providers: [...new Set(coverage.map((row) => row.provider))], expectedProviders: [...expectedProviders], missingCityProviderRows, unexpectedCityProviderRows, verifiedRows: coverage.filter((row) => row.verified === "True").length, productionEnabledRows: coverage.filter((row) => row.production_enabled === "True").length, vehicleCoverageVerifiedRows: coverage.filter((row) => /(^|_)(verified|supported|approved)(_|$)/i.test(row.vehicle_coverage_status || "")).length, duplicateCityProviderRows: duplicateCount(coverage, (row) => `${row.city}|${row.provider}`) };
  report.scenario = { rows: scenarios.length, cities: [...new Set(scenarios.map((row) => row.city))], providers: [...new Set(scenarios.map((row) => row.provider))], vehicles: [...new Set(scenarios.map((row) => row.vehicle_type))], duplicateScenarioIds: duplicateCount(scenarios, (row) => row.scenario_id), allSynthetic: scenarios.every((row) => row.is_synthetic === "True"), allNonLive: scenarios.every((row) => row.price_is_live === "False"), allIneligible: scenarios.every((row) => row.production_eligible === "False") };
  report.warnings.push("All scenario fare values are synthetic model/test data, not observed provider quotations.");
  if (report.coverage.vehicleCoverageVerifiedRows === 0) report.warnings.push("No provider/city/vehicle combination has verified vehicle coverage.");
  return report;
}

if (require.main === module) { const report = validateFairFareDatasetV1(); console.log(JSON.stringify(report, null, 2)); if (report.errors.length) process.exitCode = 1; }
module.exports = { FILES, validateFairFareDatasetV1 };
