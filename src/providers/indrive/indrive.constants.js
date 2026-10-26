const PROVIDER_ID = "indrive";
const PROVIDER_NAME = "inDrive";

const TOKEN_RENEW_URL = "https://ath-gw-cf.euce1.indriverapp.com/api/auth/v1/token/renew";
const PRICING_URL = "https://api-gw-cf.sa.apse1.aws.indriverapp.com/recprice-gateway-backend/api/pricing/v6/price";
const AUTOCOMPLETE_URL = "https://api-gw-cf.sa.apse1.aws.indriverapp.com/geo2dev/api/autocomplete";
const LOCATIONS_URL = "https://api-gw-cf.sa.apse1.aws.indriverapp.com/new-order/api/new-order/v1/locations";
const ORDER_TYPE_IDS = [2, 33, 31, 29, 11];
const ORDER_TYPE_CATEGORIES = {
  2: { name: "Moto", normalizedCategory: "BIKE", serviceTier: "standard", features: [] },
  33: { name: "Mini", normalizedCategory: "ECONOMY_CAR", serviceTier: "economy", features: [] },
  31: { name: "Rickshaw", normalizedCategory: "RICKSHAW", serviceTier: "standard", features: [] },
  29: { name: "Ride AC", normalizedCategory: "STANDARD_CAR", serviceTier: "standard", features: ["AC"] },
  11: { name: "Premium", normalizedCategory: "PREMIUM_CAR", serviceTier: "premium", features: [] },
};

const VEHICLE_TYPE_ORDER_IDS = Object.freeze({
  BIKE: 2,
  ECONOMY_CAR: 33,
  RICKSHAW: 31,
  STANDARD_CAR: 29,
  PREMIUM_CAR: 11,
  bike: 2,
  mini: 33,
  rickshaw: 31,
  car: 29,
  premium: 11,
});

function getConfig(env = process.env) {
  const requestedMode = String(env.INDRIVE_MODE || "simulated").toLowerCase();
  const simulationOnly = env.FAIRFARE_SIMULATION_ONLY === undefined
    ? true
    : String(env.FAIRFARE_SIMULATION_ONLY).toLowerCase() !== "false";
  return {
    enabled: env.INDRIVE_ENABLED !== "false",
    simulationOnly,
    // Demo deployments fail closed to simulation. REAL is reachable only when
    // explicitly opting out of the global simulation-only guard.
    mode: env.NODE_ENV === "test" ? "simulated" : simulationOnly ? "simulated" : ["simulated", "real"].includes(requestedMode) ? requestedMode : "simulated",
    pricingUrl: env.INDRIVE_AUTHORIZED_PRICING_URL || PRICING_URL,
    autocompleteUrl: env.INDRIVE_AUTHORIZED_AUTOCOMPLETE_URL || AUTOCOMPLETE_URL,
    locationsUrl: env.INDRIVE_AUTHORIZED_LOCATIONS_URL || LOCATIONS_URL,
    cityId: Number(env.INDRIVE_CITY_ID || 5388),
    autocompleteRoutePointType: env.INDRIVE_AUTOCOMPLETE_ROUTE_POINT_TYPE || "to",
    currencyMultiplier: Number(env.INDRIVE_CURRENCY_MULTIPLIER || 100),
    deviceFingerprint: env.INDRIVE_DEVICE_FINGERPRINT || "",
    fingerprint: env.INDRIVE_FINGERPRINT || "",
    appVersion: env.INDRIVE_APP_VERSION || "android 5.157.0",
    language: env.INDRIVE_LANGUAGE || "en_US",
    osType: env.INDRIVE_OS_TYPE || "android",
    appFlavor: env.INDRIVE_APP_FLAVOR || "indriver",
    timeoutMs: Number(env.INDRIVE_REQUEST_TIMEOUT_MS || 30000),
    refreshBufferSeconds: Number(env.INDRIVE_REFRESH_BUFFER_SECONDS || 300),
  };
}

module.exports = {
  PROVIDER_ID,
  PROVIDER_NAME,
  TOKEN_RENEW_URL,
  PRICING_URL,
  AUTOCOMPLETE_URL,
  LOCATIONS_URL,
  ORDER_TYPE_IDS,
  ORDER_TYPE_CATEGORIES,
  VEHICLE_TYPE_ORDER_IDS,
  getConfig,
};
