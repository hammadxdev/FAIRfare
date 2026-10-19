const { getConfig, VEHICLE_TYPE_ORDER_IDS, ORDER_TYPE_IDS } = require("./indrive.constants");
const { createIndriveClient } = require("./indrive.client");
const { createSessionManager } = require("./indrive.auth");
const { mapPricingResponse } = require("./indrive.mapper");
const { IndriveError, CODES } = require("./indrive.errors");
const { calculateSimulatedFare } = require("../simulation.engine");
const { buildAutocompleteRequest, normalizeAutocompleteResponse } = require("./indrive.autocomplete");
const { resolveProviderConfig } = require("../../services/providerRuntimeConfig.service");

function jwtExpiry(token) {
  try {
    const payload = token.split(".")[1];
    const exp = Number(JSON.parse(Buffer.from(payload, "base64url")).exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch (_) { return null; }
}

function buildPricingPayload(route) {
  const requestedCategory = route.orderTypeId ?? VEHICLE_TYPE_ORDER_IDS[route.vehicleType] ?? VEHICLE_TYPE_ORDER_IDS[String(route.vehicleType || "").toUpperCase()];
  if (!Number.isInteger(Number(requestedCategory))) {
    throw new IndriveError(CODES.UNSUPPORTED_CATEGORY, "inDrive category is not supported");
  }
  const payload = {
    order_type_ids: ORDER_TYPE_IDS,
    route: [
      { latitude: Number(route.pickup.latitude), longitude: Number(route.pickup.longitude) },
      { latitude: Number(route.destination.latitude), longitude: Number(route.destination.longitude) },
    ],
    geo: {
      distance_meters: Number(route.distanceMeters), duration_seconds: Number(route.durationSeconds),
      toll_cost: 0.0, provider: "", points: [],
    },
  };
  // Compatibility alias for older in-process callers; it is non-enumerable
  // and is therefore never sent in the v6 JSON contract.
  Object.defineProperty(payload, "order_type_id", { value: Number(requestedCategory), enumerable: false });
  return payload;
}

function createIndriveAdapter({ config = getConfig(), client, session } = {}) {
  const indriveClient = client || createIndriveClient({ config });
  const ownsClient = !client;
  const ownsSession = !session;
  const sessionManager = session || createSessionManager({ client: indriveClient, config });
  if (ownsSession && process.env.NODE_ENV !== "test" && config.mode === "real" && config.enabled) {
    void sessionManager.start();
  }
  return {
    id: "indrive", name: "indrive", displayName: "inDrive", mode: config.mode,
    // PostgreSQL may contain the authoritative rotated token even when the
    // bootstrap access-token environment variable is empty.
    liveTransportEnabled: config.mode === "real" && Boolean(config.pricingUrl),
    getStatus: () => config.mode === "simulated" ? "READY" : sessionManager.getStatus(),
    getTokenDiagnostics: () => sessionManager.getTokenDiagnostics(),
    getSessionManager: () => sessionManager,
    async getQuotes({ route, rate, vehicleType, observedAt, context, weather }) {
      const runtime = await resolveProviderConfig("indrive", config);
      const effectiveConfig = runtime.config;
      if (runtime.activated && !effectiveConfig.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      if (effectiveConfig.mode === "simulated") {
        return [{ ...calculateSimulatedFare({ provider: "indrive", vehicleType, rate, route, observedAt, context, weather }), providerName: "inDrive", tripDurationSeconds: route.durationSeconds, distanceMeters: route.distanceMeters, deepLink: null }];
      }
      if (!effectiveConfig.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      const requestClient = ownsClient && runtime.activated ? createIndriveClient({ config: effectiveConfig }) : indriveClient;
      // Preserve the lightweight, access-token-only adapter contract used by
      // offline callers. Production getConfig always includes refreshToken,
      // so authorized runtime traffic uses the persisted session manager.
      if (config.refreshToken === undefined && Object.prototype.hasOwnProperty.call(config, "accessToken")) {
        const expiry = jwtExpiry(config.accessToken);
        if (!expiry) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive authorized access token is invalid");
        if (Math.floor(Date.now() / 1000) >= expiry) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive authorized access token is expired");
        const response = await requestClient.getPricing(config.accessToken, buildPricingPayload({ ...route, vehicleType }));
        if (response.status === 401 || response.status === 403) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive pricing authentication failed", { status: response.status });
        if (response.status === 408 || response.status === 504) throw new IndriveError(CODES.TIMEOUT, "inDrive pricing timed out", { status: response.status });
        if (response.status < 200 || response.status >= 300) throw new IndriveError(response.status === 429 ? CODES.RATE_LIMITED : CODES.UNAVAILABLE, "inDrive pricing failed", { status: response.status });
        const quotes = mapPricingResponse(response.body, route)
          .filter((quote) => quote.categoryId && Number.isFinite(quote.fare) && quote.fare > 0 && quote.currency)
          .map((quote) => ({ ...quote, source: "live" }));
        if (!quotes.length) throw new IndriveError(CODES.BAD_RESPONSE, "inDrive pricing returned no valid quotes");
        return quotes;
      }
      const accessToken = await sessionManager.ensureValidSession();
      const first = await requestClient.getPricing(accessToken, buildPricingPayload({ ...route, vehicleType }));
      if (first.status === 401) {
        const retryToken = await sessionManager.ensureValidSession({ force: true });
        const second = await requestClient.getPricing(retryToken, buildPricingPayload({ ...route, vehicleType }));
        if (second.status === 401) { await sessionManager.markAuthRequired(); throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive pricing authentication failed"); }
        if (second.status < 200 || second.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive pricing failed", { status: second.status });
        return mapPricingResponse(second.body, route);
      }
      if (first.status === 429) throw new IndriveError(CODES.RATE_LIMITED, "inDrive pricing rate limited");
      if (first.status < 200 || first.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive pricing failed", { status: first.status });
      return mapPricingResponse(first.body, route);
    },
    async getAutocomplete(input) {
      if (!config.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      if (config.refreshToken === undefined && Object.prototype.hasOwnProperty.call(config, "accessToken")) {
        const expiry = jwtExpiry(config.accessToken);
        if (!config.accessToken || !expiry) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive authorized access token is invalid");
        if (Math.floor(Date.now() / 1000) >= expiry) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive authorized access token is expired");
        const request = buildAutocompleteRequest(input, config);
        const response = await indriveClient.getAutocomplete(config.accessToken, request);
        if (response.status === 401 || response.status === 403) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive autocomplete authentication failed", { status: response.status });
        if (response.status === 408 || response.status === 504) throw new IndriveError(CODES.TIMEOUT, "inDrive autocomplete timed out", { status: response.status });
        if (response.status < 200 || response.status >= 300) throw new IndriveError(response.status === 429 ? CODES.RATE_LIMITED : CODES.UNAVAILABLE, "inDrive autocomplete failed", { status: response.status });
        const normalized = normalizeAutocompleteResponse(response.body);
        if (!normalized.valid) throw new IndriveError(CODES.BAD_RESPONSE, "inDrive autocomplete returned an invalid response");
        return { ...normalized, source: "live" };
      }
      const accessToken = await sessionManager.ensureValidSession();
      const request = buildAutocompleteRequest(input, config);
      const response = await indriveClient.getAutocomplete(accessToken, request);
      if (response.status === 401 || response.status === 403) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive autocomplete authentication failed", { status: response.status });
      if (response.status === 408 || response.status === 504) throw new IndriveError(CODES.TIMEOUT, "inDrive autocomplete timed out", { status: response.status });
      if (response.status < 200 || response.status >= 300) throw new IndriveError(response.status === 429 ? CODES.RATE_LIMITED : CODES.UNAVAILABLE, "inDrive autocomplete failed", { status: response.status });
      const normalized = normalizeAutocompleteResponse(response.body);
      if (!normalized.valid) throw new IndriveError(CODES.BAD_RESPONSE, "inDrive autocomplete returned an invalid response");
      return { ...normalized, source: "live" };
    },
    getFareQuote() { throw new Error("Use getQuotes for inDrive"); },
    getPickupEtaMin() { return null; },
  };
}

const defaultAdapter = createIndriveAdapter();
module.exports = defaultAdapter;
module.exports.createIndriveAdapter = createIndriveAdapter;
module.exports.buildPricingPayload = buildPricingPayload;
