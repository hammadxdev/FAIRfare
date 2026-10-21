const { createIndriveProvider, CONFIG, normalizeLiveEstimate, STATUS } = require("../providers/indrive-architecture");
const { mapIndrivePricingRequest } = require("../providers/indrive-pricing.contract");

const pickup = { latitude: 31.4742, longitude: 74.4163 };
const destination = { latitude: 31.5204, longitude: 74.3587 };
const routeInput = { pickup, destination, distanceMeters: 9301, durationSeconds: 1139 };
const CATEGORY_IDS = new Set(["2", "33", "31", "29", "11"]);

function keys(value) { return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : []; }
function finitePositive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function validCoordinate(value) { return value && Number.isFinite(Number(value.latitude)) && Math.abs(Number(value.latitude)) <= 90 && Number.isFinite(Number(value.longitude)) && Math.abs(Number(value.longitude)) <= 180; }
function stage(name, contract, source, response, resultCount, errors = []) {
  return { stage: name, endpointOrContract: contract, evidence: source === "fixture" ? "local fixture" : source === "authorized-live" ? "fresh authorized live" : "no transport", requestAttempted: source === "authorized-live", responseStatus: response?.status || null, responseShape: keys(response), resultCount, errors };
}
function fixtureTransport() {
  return {
    async getSuggestions() { return { status: STATUS.AVAILABLE, suggestions: [{ id: "fixture-pickup", title: "Synthetic pickup", latitude: 31.47, longitude: 74.41 }, { id: "fixture-destination", title: "Synthetic destination", latitude: 31.52, longitude: 74.35 }] }; },
    async getRoute() { return { status: STATUS.AVAILABLE, route: { distanceMeters: 9301, durationSeconds: 1139, encodedPolyline: "synthetic-polyline" } }; },
    async getNearbyDrivers() { return { status: STATUS.AVAILABLE, availability: "unknown", drivers: [] }; },
    async getFareEstimates() { return { status: STATUS.AVAILABLE, currency: "PKR", quotedAt: "2026-10-16T12:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", estimates: [
      { rideType: "2", categoryName: "Moto", fareMinor: 16300, priceType: "suggested", negotiable: true },
      { rideType: "33", categoryName: "Mini", fareMinor: 45000, priceType: "fixed" },
      { rideType: "31", categoryName: "Rickshaw", fareMinor: 30000, priceType: "suggested", negotiable: true },
      { rideType: "29", categoryName: "Ride AC", fareMinor: 62000, priceType: "fixed" },
      { rideType: "11", categoryName: "Premium", fareMinor: 78000, priceType: "fixed" },
    ] }; },
  };
}
function validateSuggestions(response) {
  const items = Array.isArray(response?.suggestions) ? response.suggestions : [];
  const invalid = items.filter((item) => !validCoordinate(item));
  return { count: items.length, errors: response?.status !== STATUS.AVAILABLE ? ["response_not_available"] : invalid.length ? ["suggestion_coordinates_invalid"] : [] };
}
function validateRoute(response) {
  const route = response?.route;
  const errors = response?.status !== STATUS.AVAILABLE ? ["response_not_available"] : [];
  if (!finitePositive(route?.distanceMeters)) errors.push("distance_missing_or_invalid");
  if (!finitePositive(route?.durationSeconds)) errors.push("duration_missing_or_invalid");
  if (!route?.encodedPolyline && !route?.geometry) errors.push("geometry_missing");
  return { count: errors.length ? 0 : 1, errors };
}
function explicitDriverCount(response) {
  const value = response?.driverCount ?? response?.count;
  return Number.isInteger(value) && value >= 0 ? value : null;
}
function validatePricing(response, now = Date.now()) {
  const errors = [];
  const estimates = Array.isArray(response?.estimates) ? response.estimates : [];
  if (response?.status !== STATUS.AVAILABLE) errors.push("response_not_available");
  if (String(response?.currency || "").toUpperCase() !== "PKR") errors.push("currency_missing_or_not_PKR");
  if (!response?.quotedAt || !Number.isFinite(Date.parse(response.quotedAt))) errors.push("quoted_at_missing_or_invalid");
  if (!response?.expiresAt || !Number.isFinite(Date.parse(response.expiresAt)) || Date.parse(response.expiresAt) <= now) errors.push("expired_or_invalid_expiry");
  const normalized = estimates.map((estimate) => normalizeLiveEstimate(estimate, "PKR", 100)).filter(Boolean);
  if (normalized.length !== estimates.length) errors.push("invalid_fare_entry");
  if (new Set(estimates.map((estimate) => String(estimate.rideType))).size !== estimates.length || estimates.some((estimate) => !CATEGORY_IDS.has(String(estimate.rideType)))) errors.push("category_ids_invalid_or_duplicate");
  if (normalized.some((estimate) => !["suggested", "fixed"].includes(estimate.priceType))) errors.push("price_type_invalid");
  return { count: errors.length ? 0 : normalized.length, errors, normalized: normalized.map((estimate) => ({ categoryId: String(estimate.rideType), farePkr: estimate.fare, priceType: estimate.priceType })) };
}
async function runDiagnostic({ transport = null, source = "none", now = Date.now() } = {}) {
  const provider = createIndriveProvider({ config: { ...CONFIG, mode: transport ? "authorized-live" : "unavailable", currencyMultiplier: 100 }, transport });
  const report = [];
  const autocompleteRequest = { text: "synthetic destination", latitude: pickup.latitude, longitude: pickup.longitude, sessionId: "synthetic-session" };
  if (!autocompleteRequest.text) throw new Error("autocomplete request schema invalid");
  const autocomplete = transport?.getSuggestions ? await transport.getSuggestions(autocompleteRequest) : await provider.getSuggestions(autocompleteRequest);
  const autocompleteCheck = validateSuggestions(autocomplete);
  report.push(stage("1. Autocomplete", "getSuggestions({text, latitude, longitude, sessionId}) -> suggestions[{latitude, longitude}]", source, autocomplete, autocompleteCheck.count, autocompleteCheck.errors));

  const routeRequest = { pickup, destination };
  const routeResponse = transport?.getRoute ? await transport.getRoute(routeRequest) : await provider.getRoute(routeRequest);
  const routeCheck = validateRoute(routeResponse);
  report.push(stage("2. Route/waypoints", "getRoute({pickup, destination}) -> route{distanceMeters, durationSeconds, geometry|encodedPolyline}", source, routeResponse, routeCheck.count, routeCheck.errors));

  const nearbyRequest = { latitude: pickup.latitude, longitude: pickup.longitude, rideType: "2" };
  const nearbyResponse = transport?.getNearbyDrivers ? await transport.getNearbyDrivers(nearbyRequest) : await provider.getNearbyDrivers(nearbyRequest);
  report.push(stage("3. Nearby drivers", "getNearbyDrivers({latitude, longitude, rideType}) -> availability and explicit driverCount", source, nearbyResponse, explicitDriverCount(nearbyResponse), nearbyResponse?.status === STATUS.AVAILABLE ? [] : ["response_not_available"]));

  const pricingRequest = mapIndrivePricingRequest(routeInput);
  const pricingResponse = transport?.getFareEstimates ? await transport.getFareEstimates({ pickup, destination, route: { distanceMeters: pricingRequest.geo.distance_meters, durationSeconds: pricingRequest.geo.duration_seconds } }) : await provider.getFareEstimates({ pickup, destination, route: routeInput });
  const pricingCheck = validatePricing(pricingResponse, now);
  report.push({ ...stage("4. Vehicle-wise pricing", "mapIndrivePricingRequest -> getFareEstimates -> estimates[{rideType, fareMinor, priceType}]", source, pricingResponse, pricingCheck.count, pricingCheck.errors), normalized: pricingCheck.normalized });
  return { provider: "inDrive", freshAuthorizedLiveAttempted: source === "authorized-live", stages: report };
}

if (require.main === module) runDiagnostic({ transport: fixtureTransport(), source: "fixture" }).then((report) => console.log(JSON.stringify(report))).catch((error) => { console.log(JSON.stringify({ provider: "inDrive", freshAuthorizedLiveAttempted: false, error: "DIAGNOSTIC_FAILED" })); process.exitCode = 1; });
module.exports = { CATEGORY_IDS, fixtureTransport, runDiagnostic, validateSuggestions, validateRoute, validatePricing };
