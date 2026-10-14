const fs = require("fs");
const path = require("path");

const DATASET_DIR = path.resolve(__dirname, "..", "data", "Fair_Fare_Synthetic_Dataset_v1");
const PROVIDER_ALIASES = Object.freeze({
  indrive: "indrive",
  "in-drive": "indrive",
  yango: "quickride",
  quickride: "quickride",
  bykea: "urbancab",
  urbancab: "urbancab",
});
const VEHICLE_ALIASES = Object.freeze({
  bike: "bike",
  rickshaw: "rickshaw",
  mini: "economy_car",
  economy_car: "economy_car",
  car: "economy_car",
  premium: "premium_car",
  premium_car: "premium_car",
});
const DATASET_MODES = Object.freeze(["legacy", "preview", "verified"]);
const { buildApprovalMatrix } = require("./coverageApproval.service");

function getDatasetMode() {
  const configured = String(process.env.FAIR_FARE_DATASET_MODE || "legacy").trim().toLowerCase();
  return DATASET_MODES.includes(configured) ? configured : "legacy";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
  return rows.filter((values) => values.some((value) => value !== "")).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function readCsv(name) {
  return parseCsv(fs.readFileSync(path.join(DATASET_DIR, name), "utf8"));
}

function truthy(value) { return String(value).toLowerCase() === "true"; }
function keyCity(value) { return String(value || "").trim().toLowerCase(); }
function canonicalProvider(value) { return PROVIDER_ALIASES[keyCity(value)] || null; }
function canonicalVehicle(value) { return VEHICLE_ALIASES[keyCity(value)] || null; }

function approvedCoverage() {
  // Explicit approvals are intentionally opt-in and exact. Format:
  // City|provider|vehicle,City|provider|vehicle
  const allowed = new Set(buildApprovalMatrix().filter((candidate) => candidate.classification === "READY_FOR_REVIEW" && candidate.mappingUnambiguous).map((candidate) => candidate.key.toLowerCase()));
  return new Set(String(process.env.FAIRFARE_APPROVED_COVERAGE || "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => allowed.has(item)));
}

function loadReferenceData() {
  const cities = readCsv("cities.csv");
  const coverage = readCsv("provider_city_coverage.csv");
  const vehicles = readCsv("vehicle_pricing_parameters.csv");
  const timeRules = readCsv("time_rules.csv");
  const weatherRules = readCsv("weather_rules.csv");
  const eventRules = readCsv("event_rules.csv");
  return Object.freeze({ cities, coverage, vehicles, timeRules, weatherRules, eventRules });
}

let references;
function data() { if (!references) references = loadReferenceData(); return references; }

function cityFromLocation(location) {
  const explicit = location?.city || location?.cityName;
  if (explicit && data().cities.some((city) => keyCity(city.city) === keyCity(explicit))) return String(explicit).trim();
  const text = keyCity(`${location?.name || ""} ${location?.address || ""}`);
  const match = data().cities.find((city) => new RegExp(`(?:^|[^a-z])${String(city.city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase()}(?:$|[^a-z])`).test(text));
  return match?.city || null;
}

function resolveTripCoverage({ pickup, dropoff, provider, vehicleType }) {
  const pickupCity = cityFromLocation(pickup);
  const dropoffCity = cityFromLocation(dropoff);
  const normalizedProvider = canonicalProvider(provider) || keyCity(provider);
  const normalizedVehicle = canonicalVehicle(vehicleType) || keyCity(vehicleType);
  const city = pickupCity || dropoffCity || null;
  const intercity = Boolean(pickupCity && dropoffCity && keyCity(pickupCity) !== keyCity(dropoffCity));
  const coverageRow = city ? data().coverage.find((row) => keyCity(row.city) === keyCity(city) && canonicalProvider(row.provider) === normalizedProvider) : null;
  const approvalKey = `${keyCity(city)}|${normalizedProvider}|${normalizedVehicle}`;
  const explicitlyApproved = approvedCoverage().has(approvalKey);
  let status = "CITY_UNVERIFIED";
  if (intercity) status = "INTERCITY_COVERAGE_UNVERIFIED";
  else if (!city) status = "CITY_UNVERIFIED";
  else if (!coverageRow) status = "PROVIDER_CITY_UNVERIFIED";
  else if (explicitlyApproved) status = "APPROVED_CONFIGURATION";
  else if (!truthy(coverageRow.verified) || !truthy(coverageRow.production_enabled)) status = "PROVIDER_CITY_UNVERIFIED";
  else if (!/(^|_)(verified|supported|approved)(_|$)/i.test(coverageRow.vehicle_coverage_status || "")) status = "VEHICLE_COVERAGE_UNVERIFIED";
  else status = "SUPPORTED";
  return {
    city,
    pickupCity,
    dropoffCity,
    intercity,
    provider: normalizedProvider,
    vehicleType: normalizedVehicle,
    status,
    supported: status === "SUPPORTED" || status === "APPROVED_CONFIGURATION",
    coverage: coverageRow ? { city: coverageRow.city, provider: coverageRow.provider, coverageStatus: coverageRow.coverage_status, verified: truthy(coverageRow.verified), vehicleCoverageStatus: coverageRow.vehicle_coverage_status, productionEnabled: truthy(coverageRow.production_enabled), sourceUrl: coverageRow.source_url || null, lastVerifiedAt: coverageRow.last_verified_at || null } : null,
    provenance: "Fair Fare synthetic dataset v1; coverage is not live provider availability",
  };
}

function baselineFor(vehicleType) {
  const normalized = canonicalVehicle(vehicleType);
  const row = data().vehicles.find((item) => keyCity(item.vehicle_type) === normalized);
  if (!row) return null;
  return { vehicleType: normalized, baseFare: Number(row.base_pkr), perKm: Number(row.per_km_pkr), perMinute: Number(row.per_min_pkr), minimumFare: Number(row.min_fare_pkr), pricingSource: row.pricing_source, calibrationStatus: row.calibration_status, modelVersion: row.model_version };
}

function timeRule(hour, dayOfWeek) { return data().timeRules.find((row) => Number(row.hour_local) === Number(hour) && Number(row.weekday_index) === Number(dayOfWeek)) || null; }
function weatherRule(weather) { return data().weatherRules.find((row) => keyCity(row.weather) === keyCity(weather)) || null; }

function weatherCategory(weather) {
  if (!weather || weather.source === "UNAVAILABLE" || weather.source === "MALFORMED" || weather.source === "DISABLED" || weather.condition === "UNKNOWN") return null;
  if (weather.condition === "HEAVY_RAIN" || weather.weatherSeverity === "HEAVY") return "heavy_rain";
  if (weather.condition === "RAIN") return "light_rain";
  if (weather.condition === "FOG") return "fog";
  if (weather.condition === "HOT") return "extreme_heat";
  return "clear";
}

function estimateDatasetFare({ vehicleType, distanceKm, durationMin, hourOfDay, dayOfWeek, weather } = {}) {
  const baseline = baselineFor(vehicleType);
  if (!baseline) return null;
  const rule = timeRule(hourOfDay, dayOfWeek);
  const weatherKey = weatherCategory(weather);
  const weatherConfig = weatherKey ? weatherRule(weatherKey) : null;
  const base = Math.max(baseline.minimumFare, baseline.baseFare + Number(distanceKm) * baseline.perKm + Number(durationMin) * baseline.perMinute);
  const timeMultiplier = rule ? Number(rule.illustrative_multiplier) : 1;
  const weatherMultiplier = weatherConfig && weather?.source ? Number(weatherConfig.illustrative_multiplier) : 1;
  const fare = Math.round(base * timeMultiplier * weatherMultiplier);
  return {
    fare: Math.max(baseline.minimumFare, fare),
    fareMin: null,
    fareMax: null,
    uncertaintyMarginPkr: Math.max(15, Math.round(fare * 0.08)),
    currency: "PKR",
    fareType: "ESTIMATE",
    modelVersion: baseline.modelVersion,
    metadata: {
      simulated: true,
      dataSource: "SYNTHETIC_DATASET",
      provenance: "Fair Fare model-based estimate; not a live provider quotation",
      calibrationStatus: baseline.calibrationStatus,
      pricingSource: baseline.pricingSource,
      breakdown: { baseFare: baseline.baseFare, distanceFare: Math.round(Number(distanceKm) * baseline.perKm), timeFare: Math.round(Number(durationMin) * baseline.perMinute), timeMultiplier, weatherMultiplier },
      uncertainty: { marginPkr: Math.max(15, Math.round(fare * 0.08)), method: "synthetic_assumption_max_15_or_8_percent_not_calibrated" },
    },
  };
}

function resetForTests() { references = undefined; }

module.exports = { DATASET_DIR, DATASET_MODES, PROVIDER_ALIASES, VEHICLE_ALIASES, getDatasetMode, parseCsv, data, canonicalProvider, canonicalVehicle, cityFromLocation, resolveTripCoverage, baselineFor, timeRule, weatherRule, weatherCategory, estimateDatasetFare, resetForTests };
