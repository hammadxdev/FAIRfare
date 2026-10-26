const DEFAULT_CURRENCY = "PKR";
const DEFAULT_CURRENCY_MULTIPLIER = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FARE_ENDPOINT = "/talos/api/v3/users/estimation/fare";
const DEFAULT_NEARBY_ENDPOINT = "/talos/api/v1/eta";
const DEFAULT_SERVICE_MAPPINGS = Object.freeze({
  "23": { label: "Bike", vehicleCategory: "bike", serviceTier: "standard", features: [] },
  "70": { label: "Rickshaw", vehicleCategory: "rickshaw", serviceTier: "standard", features: [] },
  "44": { label: "Car AC", vehicleCategory: "car", serviceTier: "standard", features: ["AC"] },
  "45": { label: "Car", vehicleCategory: "car", serviceTier: "standard", features: [] },
  "48": { label: "Car Premium", vehicleCategory: "car", serviceTier: "premium", features: [] },
});

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function normalizedMode(value) {
  const mode = String(value || "unavailable").trim().toLowerCase().replace(/_/g, "-");
  return ["authorized-live", "simulated", "unavailable"].includes(mode) ? mode : "unavailable";
}

function validHttpsUrl(value) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 120_000 ? parsed : fallback;
}

function serviceCodes(value) {
  const codes = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(codes)];
}

function serviceMappings(value) {
  if (!value) return DEFAULT_SERVICE_MAPPINGS;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...DEFAULT_SERVICE_MAPPINGS, ...parsed } : DEFAULT_SERVICE_MAPPINGS;
  } catch { return DEFAULT_SERVICE_MAPPINGS; }
}

function validEndpoint(value) {
  const endpoint = String(value || "").trim();
  return endpoint.startsWith("/") && !endpoint.includes("#") && !endpoint.includes("?") ? endpoint : "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validLatitude(value) {
  const number = finiteNumber(value);
  return number !== null && number >= -90 && number <= 90;
}

function validLongitude(value) {
  const number = finiteNumber(value);
  return number !== null && number >= -180 && number <= 180;
}

function getConfig(env = process.env) {
  const requestedMode = normalizedMode(env.BYKEA_MODE || (booleanValue(env.BYKEA_AUTHORIZED_LIVE) ? "authorized-live" : "unavailable"));
  const authorizedLive = booleanValue(env.BYKEA_AUTHORIZED_LIVE, false);
  const apiBaseUrl = String(env.BYKEA_API_BASE_URL || "").trim().replace(/\/$/, "");
  const fareEndpoint = validEndpoint(env.BYKEA_FARE_ENDPOINT || DEFAULT_FARE_ENDPOINT);
  const nearbyEndpoint = validEndpoint(env.BYKEA_NEARBY_ENDPOINT || DEFAULT_NEARBY_ENDPOINT);
  const deviceId = String(env.BYKEA_DEVICE_ID || "").trim();
  const appUserId = String(env.BYKEA_APP_USER_ID || "").trim();
  const appUserToken = String(env.BYKEA_APP_USER_TOKEN || "").trim();
  const appVersion = String(env.BYKEA_APP_VERSION || "").trim();
  const appLanguage = String(env.BYKEA_APP_LANGUAGE || "en").trim() || "en";
  const configuredServiceCodes = serviceCodes(env.BYKEA_SERVICE_CODES || "23,70,44,45,48");
  const requestType = String(env.BYKEA_REQUEST_TYPE || "APP").trim();
  const hasVehicleType = Object.prototype.hasOwnProperty.call(env, "BYKEA_VEHICLE_TYPE");
  const vehicleType = hasVehicleType ? String(env.BYKEA_VEHICLE_TYPE).trim() : null;
  const appUserType = String(env.BYKEA_APP_USER_TYPE || "passenger").trim();
  const headerLatitude = String(env.BYKEA_HEADER_LATITUDE || "").trim();
  const headerLongitude = String(env.BYKEA_HEADER_LONGITUDE || "").trim();
  const headerAltitude = String(env.BYKEA_HEADER_ALTITUDE || "").trim();
  const userAgent = String(env.BYKEA_USER_AGENT || "").trim();
  const validBaseUrl = validHttpsUrl(apiBaseUrl);
  const mandatoryHeadersConfigured = Boolean(
    appUserType && validLatitude(headerLatitude) && validLongitude(headerLongitude)
      && finiteNumber(headerAltitude) !== null && appLanguage && userAgent,
  );
  const endpointContractConfigured = Boolean(
    fareEndpoint && deviceId && appUserId && appUserToken && configuredServiceCodes.length && requestType && vehicleType !== null && mandatoryHeadersConfigured,
  );
  const configError = requestedMode === "authorized-live"
    ? !authorizedLive
      ? "BYKEA_AUTHORIZED_LIVE must be true before authorized-live mode can run"
      : !validBaseUrl
      ? "BYKEA_API_BASE_URL must be an HTTPS URL"
      : !endpointContractConfigured
        ? "Bykea endpoint, identity, query, and six mandatory header settings are required for the authorized contract"
        : null
    : null;
  const mode = configError ? "unavailable" : requestedMode;

  return {
    enabled: mode !== "unavailable",
    requestedMode,
    mode,
    authorizedLive,
    apiBaseUrl,
    fareEndpoint,
    nearbyEndpoint,
    deviceId,
    appUserId,
    appUserToken,
    appVersion,
    appLanguage,
    serviceCodes: configuredServiceCodes,
    serviceMappings: serviceMappings(env.BYKEA_SERVICE_MAPPINGS),
    requestType,
    vehicleType,
    appUserType,
    headerLatitude,
    headerLongitude,
    headerAltitude,
    userAgent,
    currency: String(env.BYKEA_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase(),
    currencyMultiplier: Number(env.BYKEA_CURRENCY_MULTIPLIER || DEFAULT_CURRENCY_MULTIPLIER),
    timeoutMs: positiveInteger(env.BYKEA_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    configError,
    endpointContractConfigured,
    mandatoryHeadersConfigured,
  };
}

module.exports = {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCY_MULTIPLIER,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_FARE_ENDPOINT,
  DEFAULT_NEARBY_ENDPOINT,
  getConfig,
  normalizedMode,
  DEFAULT_SERVICE_MAPPINGS,
};
