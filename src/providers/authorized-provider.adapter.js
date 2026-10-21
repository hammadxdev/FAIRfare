const crypto = require("node:crypto");

const STATUS = Object.freeze({
  NOT_CONFIGURED: "not_configured",
  AVAILABLE: "available",
  NO_DRIVERS: "no_drivers",
  BUSY: "busy",
  TIMEOUT: "timeout",
  AUTH_REQUIRED: "auth_required",
  ACCESS_DENIED: "access_denied",
  RATE_LIMITED: "rate_limited",
  AUTH_ERROR: "auth_error",
  UNAVAILABLE: "unavailable",
  INVALID_REQUEST: "invalid_request",
  PROVIDER_ERROR: "provider_error",
});

const SAFE_DIAGNOSTIC_CATEGORIES = new Set(["AUTH_ERROR", "BAD_REQUEST", "FORBIDDEN", "RATE_LIMITED", "UPSTREAM_ERROR", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "NO_VALID_TARIFFS"]);

function safeYangoDiagnostics(value) {
  if (!value || value.provider !== "yango" || !SAFE_DIAGNOSTIC_CATEGORIES.has(value.errorCategory)) return null;
  const upstreamStatus = value.upstreamStatus === null ? null : Number(value.upstreamStatus);
  if (upstreamStatus !== null && (!Number.isInteger(upstreamStatus) || upstreamStatus <= 0)) return null;
  if (![true, false, "unknown"].includes(value.requestReachedUpstream)) return null;
  return { provider: "yango", upstreamStatus, errorCategory: value.errorCategory, requestReachedUpstream: value.requestReachedUpstream };
}

class AuthorizedProviderError extends Error {
  constructor(code, message, status = STATUS.PROVIDER_ERROR, diagnostics = null) {
    super(message);
    this.name = "AuthorizedProviderError";
    this.code = code;
    this.status = status;
    this.isProviderError = true;
    const safeDiagnostics = safeYangoDiagnostics(diagnostics);
    if (safeDiagnostics) this.yangoDiagnostics = safeDiagnostics;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function requestId() {
  return crypto.randomUUID();
}

function normalizeCategory(estimate, requestedCategory) {
  const id = estimate?.rideType || estimate?.categoryId || estimate?.vehicleType || requestedCategory || null;
  const name = Object.prototype.hasOwnProperty.call(estimate || {}, "categoryName")
    ? estimate.categoryName
    : estimate?.vehicleCategory || estimate?.name || id;
  return { id: id == null ? null : String(id), name: name == null ? null : String(name) };
}

function normalizePriceType(estimate) {
  const value = String(estimate?.priceType || estimate?.fareType || "").trim().toLowerCase();
  if (["suggested", "negotiable", "recommended"].includes(value) || estimate?.negotiable === true || estimate?.isNegotiable === true) return "suggested";
  if (["fixed", "quote", "upfront"].includes(value)) return "fixed";
  return "estimate";
}

function normalizeLiveQuote(estimate, { currency, currencyMultiplier = 100, requestedCategory, quotedAt = null, expiresAt = null, now = Date.now } = {}) {
  const minor = estimate?.fareMinor ?? estimate?.amountMinor ?? estimate?.priceMinor;
  const rawFare = minor === undefined ? estimate?.fare ?? estimate?.amount ?? estimate?.price : Number(minor) / Number(currencyMultiplier || 1);
  const fare = Number(rawFare);
  const resolvedCurrency = String(estimate?.currency || currency || "").trim().toUpperCase();
  const effectiveExpiry = estimate?.expiresAt || expiresAt;
  const hasFare = finite(fare) && fare > 0;
  if (!resolvedCurrency || (estimate?.isAvailable !== false && !hasFare)) return null;
  if (effectiveExpiry && Number.isFinite(Date.parse(effectiveExpiry)) && Date.parse(effectiveExpiry) <= now()) return null;
  const category = normalizeCategory(estimate, requestedCategory);
  const fareMin = Number(estimate?.fareMin ?? estimate?.minFare);
  const fareMax = Number(estimate?.fareMax ?? estimate?.maxFare);
  return {
    categoryId: category.id,
    categoryName: category.name,
    rideType: category.id,
    fare: hasFare ? fare : null,
    currency: resolvedCurrency,
    priceType: normalizePriceType(estimate),
    isEstimate: estimate?.isEstimate !== false,
    quotedAt: estimate?.quotedAt || quotedAt || new Date(now()).toISOString(),
    expiresAt: effectiveExpiry || null,
    source: "live",
    ...(Number.isFinite(fareMin) && fareMin >= 0 ? { fareMin } : {}),
    ...(Number.isFinite(fareMax) && fareMax >= 0 ? { fareMax } : {}),
    ...(estimate?.fareType ? { fareType: String(estimate.fareType) } : {}),
    ...(estimate?.exactFare !== undefined ? { exactFare: estimate.exactFare } : {}),
    ...(estimate?.providerFinalFare !== undefined ? { providerFinalFare: estimate.providerFinalFare } : {}),
    ...(estimate?.displayFare !== undefined ? { displayFare: estimate.displayFare } : {}),
    ...(estimate?.startingFare !== undefined ? { startingFare: estimate.startingFare } : {}),
    ...(estimate?.quoteSemantics ? { quoteSemantics: String(estimate.quoteSemantics) } : {}),
    ...(estimate?.availability ? { availability: String(estimate.availability) } : {}),
    ...(estimate?.availabilityReason ? { availabilityReason: { ...estimate.availabilityReason } } : {}),
    ...(estimate?.isAvailable !== undefined ? { isAvailable: estimate.isAvailable === true } : {}),
    ...(estimate?.pickupEtaSeconds !== undefined ? { pickupEtaSeconds: estimate.pickupEtaSeconds } : {}),
    ...(estimate?.routeDistance !== undefined ? { routeDistance: estimate.routeDistance } : {}),
    ...(estimate?.tripDuration !== undefined ? { tripDuration: estimate.tripDuration } : {}),
    ...(estimate?.priceQualifier ? { priceQualifier: String(estimate.priceQualifier) } : {}),
    ...(estimate?.priceText ? { priceText: String(estimate.priceText) } : {}),
    ...(Array.isArray(estimate?.vehicleExamples) ? { vehicleExamples: estimate.vehicleExamples } : {}),
    ...(Number.isFinite(Number(estimate?.surgeMultiplier)) ? { surgeMultiplier: Number(estimate.surgeMultiplier) } : {}),
    ...(estimate?.categoryType ? { categoryType: String(estimate.categoryType) } : {}),
    ...(estimate?.vehicleCategory ? { vehicleCategory: String(estimate.vehicleCategory) } : {}),
    ...(estimate?.providerServiceName ? { providerServiceName: String(estimate.providerServiceName) } : {}),
    ...(estimate?.providerServiceLabel ? { providerServiceLabel: String(estimate.providerServiceLabel) } : {}),
    ...(estimate?.serviceTier ? { serviceTier: String(estimate.serviceTier) } : {}),
    ...(Array.isArray(estimate?.features) ? { features: estimate.features.map((feature) => String(feature)) } : {}),
    ...(estimate?.service_code !== undefined ? { service_code: estimate.service_code } : {}),
    ...(estimate?.currency_code !== undefined ? { currency_code: estimate.currency_code } : {}),
  };
}

function normalizeTransportResponse(response, options) {
  const id = options.providerId;
  const responseStatus = String(response?.status || STATUS.AVAILABLE).toLowerCase();
  const responseId = response?.requestId || requestId();
  if (responseStatus !== STATUS.AVAILABLE) {
    return { provider: id, status: responseStatus, source: "none", currency: options.currency, estimates: [], error: { code: response?.error?.code || "PROVIDER_UNAVAILABLE", message: "Live fare data is currently unavailable." }, requestId: responseId };
  }
  const estimates = (Array.isArray(response?.estimates) ? response.estimates : [])
    .map((estimate) => normalizeLiveQuote(estimate, { ...options, quotedAt: response?.quotedAt, expiresAt: response?.expiresAt }))
    .filter(Boolean);
  if (!estimates.length) return { provider: id, status: STATUS.PROVIDER_ERROR, source: "none", currency: options.currency, estimates: [], error: { code: "PROVIDER_BAD_RESPONSE", message: "Live provider returned no valid fare estimates." }, requestId: responseId };
  return {
    provider: id,
    status: STATUS.AVAILABLE,
    source: "live",
    currency: estimates[0].currency,
    estimates,
    routeMetadata: response?.routeMetadata || null,
    requestId: responseId,
  };
}

function createAuthorizedProviderAdapter({ id, displayName, currency = "PKR", currencyMultiplier = 100, requestedMode = "unavailable", transport = null, runtimeConfigResolver = null, transportFactory = null } = {}) {
  const liveTransportEnabled = requestedMode === "authorized-live" && Boolean(transport && typeof transport.getFareEstimates === "function");
  const options = { providerId: id, currency, currencyMultiplier };

  async function getFareEstimates({ pickup, destination, route, rideType } = {}) {
    let selectedTransport = transport;
    let selectedMode = requestedMode;
    if (typeof runtimeConfigResolver === "function") {
      const resolved = await runtimeConfigResolver();
      selectedMode = resolved.config?.mode || selectedMode;
      if (resolved.activated && typeof transportFactory === "function") selectedTransport = transportFactory(resolved.config);
    }
    if (selectedMode !== "authorized-live" || !selectedTransport || typeof selectedTransport.getFareEstimates !== "function") return { provider: id, status: STATUS.UNAVAILABLE, source: "none", currency, estimates: [], error: { code: "LIVE_INTEGRATION_NOT_CONFIGURED", message: "Live fare data is currently unavailable." }, requestId: requestId() };
    try {
      const response = await selectedTransport.getFareEstimates({ pickup, destination, route, rideType });
      return normalizeTransportResponse(response, { ...options, requestedCategory: rideType });
    } catch (error) {
      const status = error?.code === "PROVIDER_TIMEOUT" ? STATUS.TIMEOUT
        : error?.code === "PROVIDER_AUTH_REQUIRED" ? STATUS.AUTH_REQUIRED
          : error?.code === "PROVIDER_ACCESS_DENIED" ? STATUS.ACCESS_DENIED
            : error?.code === "PROVIDER_RATE_LIMITED" ? STATUS.RATE_LIMITED
            : error?.code === "PROVIDER_BAD_RESPONSE" || error?.code === "PROVIDER_NO_VALID_TARIFFS" ? STATUS.PROVIDER_ERROR
            : STATUS.UNAVAILABLE;
      const safeDiagnostics = id === "quickride" ? safeYangoDiagnostics(error?.yangoDiagnostics) : null;
      return { provider: id, status, source: "none", currency, estimates: [], error: { code: error?.code || "PROVIDER_UNAVAILABLE", message: "Live fare data is currently unavailable.", ...(safeDiagnostics ? { diagnostics: safeDiagnostics } : {}) }, requestId: requestId() };
    }
  }

  async function getQuotes({ route, vehicleType } = {}) {
    const response = await getFareEstimates({
      pickup: route?.pickup,
      destination: route?.destination,
      route,
      rideType: vehicleType,
    });
    if (response.status !== STATUS.AVAILABLE) {
      const error = new AuthorizedProviderError(response.error?.code || "PROVIDER_UNAVAILABLE", "Live fare data is currently unavailable.", response.status, response.error?.diagnostics);
      throw error;
    }
    return response.estimates.map((estimate) => ({
      ...estimate,
      providerId: id,
      providerName: displayName,
      pickupEtaSeconds: estimate.pickupEtaSeconds ?? null,
      isAvailable: estimate.isAvailable !== false,
      metadata: { source: "live", priceType: estimate.priceType, routeMetadata: response.routeMetadata || null, availabilityReason: estimate.availabilityReason || null },
    }));
  }

  return {
    id,
    name: id,
    displayName,
    mode: liveTransportEnabled ? "authorized-live" : "unavailable",
    liveTransportEnabled,
    getFareEstimates,
    getQuotes,
    getStatus: async () => liveTransportEnabled ? STATUS.AVAILABLE : "NOT_CONFIGURED",
  };
}

module.exports = { STATUS, AuthorizedProviderError, normalizeLiveQuote, normalizeTransportResponse, createAuthorizedProviderAdapter };
