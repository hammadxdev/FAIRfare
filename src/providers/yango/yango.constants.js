const DEFAULT_BASE_URL = "https://tc.taxi.yango.tech";
const DEFAULT_ROUTE_STATS_PATH = "/3.0/routestats";

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function normalizedPath(value) {
  const path = String(value || DEFAULT_ROUTE_STATS_PATH).trim();
  return path.startsWith("/") ? path : `/${path}`;
}

function getConfig(env = process.env) {
  const enabled = booleanValue(env.YANGO_ENABLED, false);
  const baseUrl = String(env.YANGO_API_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  let validBaseUrl = true;
  try {
    const parsed = new URL(baseUrl);
    validBaseUrl = parsed.protocol === "https:";
  } catch {
    validBaseUrl = false;
  }

  const accessToken = String(env.YANGO_AUTHORIZED_ACCESS_TOKEN || "").trim();
  const clientId = String(env.YANGO_AUTHORIZED_CLIENT_ID || "").trim();
  const authorizationConfigured = Boolean(accessToken && clientId);
  const authorizationVerified = booleanValue(env.YANGO_AUTHORIZATION_VERIFIED, false);
  const configError = !validBaseUrl
    ? "YANGO_API_BASE_URL must be an HTTPS URL"
    : enabled && !authorizationVerified
      ? "Yango RouteStats authorization has not been verified"
      : enabled && !authorizationConfigured
        ? "Yango RouteStats authorization is not configured"
      : null;

  return {
    enabled,
    baseUrl,
    routeStatsPath: normalizedPath(env.YANGO_ROUTE_STATS_PATH),
    accessToken,
    clientId,
    authorizationVerified,
    zoneName: String(env.YANGO_DEFAULT_ZONE || "lahore").trim(),
    supportedZones: String(env.YANGO_SUPPORTED_ZONES || "lahore").split(",").map((zone) => zone.trim().toLowerCase()).filter(Boolean),
    selectedClass: String(env.YANGO_DEFAULT_CLASS || "econom").trim(),
    paymentType: String(env.YANGO_DEFAULT_PAYMENT_TYPE || "cash").trim(),
    timeoutMs: Number(env.YANGO_REQUEST_TIMEOUT_MS || 10000),
    testContext: getTestConfig(env),
    authorizationConfigured,
    configError,
    mode: enabled && authorizationVerified && authorizationConfigured && validBaseUrl ? "authorized-live" : "unavailable",
  };
}

function getTestConfig(env = process.env) {
  return {
    enabled: env.NODE_ENV !== "production" && booleanValue(env.YANGO_TEST_REQUEST_ENABLED ?? env.YANGO_TEST_CONTEXT_ENABLED, false),
    userId: String(env.YANGO_TEST_USER_ID || "").trim(),
    mobileId: String(env.YANGO_TEST_MOBILE_ID || "").trim(),
    location: String(env.YANGO_TEST_LOCATION || "").trim(),
    mobcf: String(env.YANGO_TEST_MOBCF || "").trim(),
    mobpr: String(env.YANGO_TEST_MOBPR || "").trim(),
    hasOngoingOrders: false,
    ongoingOrdersStatuses: "none",
    perfClass: "medium",
    acceptLanguage: "en-US",
    vpnActive: "0",
  };
}

module.exports = { DEFAULT_BASE_URL, DEFAULT_ROUTE_STATS_PATH, getConfig, getTestConfig };
