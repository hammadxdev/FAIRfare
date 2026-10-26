const { getConfig, VEHICLE_TYPE_ORDER_IDS, ORDER_TYPE_IDS } = require("./indrive.constants");
const { createIndriveClient } = require("./indrive.client");
const { createSessionManager } = require("./indrive.auth");
const { mapPricingResponse, mapCategory } = require("./indrive.mapper");
const { IndriveError, CODES } = require("./indrive.errors");
const { calculateSimulatedFare } = require("../simulation.engine");
const { buildAutocompleteRequest, normalizeAutocompleteResponse } = require("./indrive.autocomplete");
const { resolveProviderConfig } = require("../../services/providerRuntimeConfig.service");

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

function normalizeNearbyLocations(body) {
  const contractors = Array.isArray(body?.contractors) ? body.contractors : null;
  if (!contractors) return null;
  return contractors.map((item) => {
    const latitude = Number(item?.latitude); const longitude = Number(item?.longitude);
    if (!item?.id || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    const heading = Number(item.heading); const speed = Number(item.speed);
    return { id: String(item.id), latitude, longitude, ...(Number.isFinite(heading) ? { heading } : {}), ...(Number.isFinite(speed) ? { speed } : {}), transportKind: item.transport_kind == null ? null : String(item.transport_kind), transportComfortLevel: item.transport_comfort_level == null ? null : String(item.transport_comfort_level) };
  }).filter(Boolean);
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
    // PostgreSQL is the only runtime source for inDrive session credentials.
    liveTransportEnabled: config.mode === "real" && Boolean(config.pricingUrl),
    getStatus: () => config.mode === "simulated" ? "READY" : sessionManager.getStatus(),
    getTokenDiagnostics: () => sessionManager.getTokenDiagnostics(),
    getSessionManager: () => sessionManager,
    async getProviderStatus() {
      const simulated = config.mode === "simulated";
      return {
        provider: "indrive",
        displayName: "inDrive",
        enabled: Boolean(config.enabled),
        mode: config.mode,
        status: await (simulated ? Promise.resolve("READY") : sessionManager.getStatus()),
        session: simulated ? { tokenPresent: false, refreshTokenPresent: false, accessExpiresAt: null, expiryKnown: false, source: "none", rotationVersion: 0, status: "NOT_CONFIGURED" } : await sessionManager.getTokenDiagnostics(),
      };
    },
    async getQuotes({ route, rate, vehicleType, observedAt, context, weather }) {
      const runtime = await resolveProviderConfig("indrive", config);
      const effectiveConfig = runtime.config;
      if (runtime.activated && !effectiveConfig.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      if (effectiveConfig.mode === "simulated") {
        return [{ ...calculateSimulatedFare({ provider: "indrive", vehicleType, rate, route, observedAt, context, weather }), providerName: "inDrive", tripDurationSeconds: route.durationSeconds, distanceMeters: route.distanceMeters, deepLink: null }];
      }
      if (!effectiveConfig.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      const requestClient = ownsClient && runtime.activated ? createIndriveClient({ config: effectiveConfig }) : indriveClient;
      const accessToken = await sessionManager.ensureValidSession();
      const first = await requestClient.getPricing(accessToken, buildPricingPayload({ ...route, vehicleType }));
      if (first.status === 401) {
        const retryToken = await sessionManager.ensureValidSession({ force: true });
        const second = await requestClient.getPricing(retryToken, buildPricingPayload({ ...route, vehicleType }));
        if (second.status === 401) { await sessionManager.markAuthRequired(); throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive pricing authentication failed"); }
        if (second.status === 403) { await sessionManager.markAccessDenied(); throw new IndriveError(CODES.ACCESS_DENIED, "inDrive pricing access was denied", { status: second.status }); }
        if (second.status < 200 || second.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive pricing failed", { status: second.status });
        return mapPricingResponse(second.body, route).map((quote) => ({ ...quote, source: "live" }));
      }
      if (first.status === 403) { await sessionManager.markAccessDenied(); throw new IndriveError(CODES.ACCESS_DENIED, "inDrive pricing access was denied", { status: first.status }); }
      if (first.status === 429) throw new IndriveError(CODES.RATE_LIMITED, "inDrive pricing rate limited");
      if (first.status < 200 || first.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive pricing failed", { status: first.status });
      return mapPricingResponse(first.body, route).map((quote) => ({ ...quote, source: "live" }));
    },
    async getAutocomplete(input) {
      if (!config.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      const accessToken = await sessionManager.ensureValidSession();
      const request = buildAutocompleteRequest(input, config);
      const response = await indriveClient.getAutocomplete(accessToken, request);
      if (response.status === 401) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive autocomplete authentication failed", { status: response.status });
      if (response.status === 403) { await sessionManager.markAccessDenied(); throw new IndriveError(CODES.ACCESS_DENIED, "inDrive autocomplete access was denied", { status: response.status }); }
      if (response.status === 408 || response.status === 504) throw new IndriveError(CODES.TIMEOUT, "inDrive autocomplete timed out", { status: response.status });
      if (response.status < 200 || response.status >= 300) throw new IndriveError(response.status === 429 ? CODES.RATE_LIMITED : CODES.UNAVAILABLE, "inDrive autocomplete failed", { status: response.status });
      const normalized = normalizeAutocompleteResponse(response.body);
      if (!normalized.valid) throw new IndriveError(CODES.BAD_RESPONSE, "inDrive autocomplete returned an invalid response");
      return { ...normalized, source: "live" };
    },
    async getNearbyDrivers({ latitude, longitude, rideType } = {}) {
      const lat = Number(latitude); const lng = Number(longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new IndriveError(CODES.MALFORMED_REQUEST, "inDrive locations request is invalid");
      if (!config.enabled || config.mode !== "real") throw new IndriveError(CODES.UNAVAILABLE, "inDrive live locations are not enabled");
      const accessToken = await sessionManager.ensureValidSession();
      const requested = rideType == null ? ORDER_TYPE_IDS : [Number(VEHICLE_TYPE_ORDER_IDS[String(rideType)] ?? VEHICLE_TYPE_ORDER_IDS[String(rideType).toUpperCase()] ?? rideType)];
      if (requested.some((orderTypeId) => !Number.isInteger(orderTypeId) || orderTypeId <= 0)) throw new IndriveError(CODES.MALFORMED_REQUEST, "inDrive locations vehicle type is invalid");
      const results = await Promise.all(requested.map(async (orderTypeId) => {
        const response = await indriveClient.getLocations(accessToken, { latitude: lat, longitude: lng, orderTypeId });
        if (response.status === 401) { await sessionManager.markAuthRequired(); throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive locations authentication failed", { status: response.status }); }
        if (response.status === 403) { await sessionManager.markAccessDenied(); throw new IndriveError(CODES.ACCESS_DENIED, "inDrive locations access was denied", { status: response.status }); }
        if (response.status === 408 || response.status === 504) throw new IndriveError(CODES.TIMEOUT, "inDrive locations timed out", { status: response.status });
        if (response.status === 429) throw new IndriveError(CODES.RATE_LIMITED, "inDrive locations rate limited");
        if (response.status < 200 || response.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive locations failed", { status: response.status });
        const drivers = normalizeNearbyLocations(response.body);
        if (!drivers) throw new IndriveError(CODES.BAD_RESPONSE, "inDrive locations returned an invalid response");
        return { orderTypeId, vehicleType: mapCategory(orderTypeId).normalizedCategory, drivers, driverCount: drivers.length };
      }));
      return { provider: "inDrive", status: "available", source: "live", vehicles: results, driverCount: results.reduce((total, item) => total + item.driverCount, 0) };
    },
    getFareQuote() { throw new Error("Use getQuotes for inDrive"); },
    getPickupEtaMin() { return null; },
  };
}

const defaultAdapter = createIndriveAdapter();
module.exports = defaultAdapter;
module.exports.createIndriveAdapter = createIndriveAdapter;
module.exports.buildPricingPayload = buildPricingPayload;
module.exports.normalizeNearbyLocations = normalizeNearbyLocations;
