const { buildRouteStatsPayload } = require("./yango.payload");
const { normalizeRouteStatsResponse } = require("./yango.mapper");
const { recordProviderApiPayload } = require("../../services/providerApiPayloadStorage.service");
const crypto = require("node:crypto");

function inspectAccessToken(token, now = Date.now) {
  const value = String(token || "").trim();
  if (!value) return { kind: "missing", expiration: "unknown", expired: false };
  const parts = value.split(".");
  if (parts.length !== 3) return { kind: "opaque", expiration: "unknown", expired: false };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!Number.isFinite(Number(payload.exp))) return { kind: "jwt", expiration: "unknown", expired: false };
    return { kind: "jwt", expiration: "known", expired: Number(payload.exp) * 1000 <= now() };
  } catch {
    return { kind: "invalid", expiration: "unknown", expired: false };
  }
}

function jwtExpired(token, now = Date.now) {
  const inspected = inspectAccessToken(token, now);
  return inspected.kind === "jwt" ? inspected.expired : inspected.kind === "invalid";
}

function clientError(code, message, status = null) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = status;
  return error;
}

const ERROR_CATEGORIES = new Set(["AUTH_ERROR", "BAD_REQUEST", "FORBIDDEN", "RATE_LIMITED", "UPSTREAM_ERROR", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "NO_VALID_TARIFFS"]);

function diagnostics(errorCategory, upstreamStatus = null, requestReachedUpstream = "unknown") {
  return {
    provider: "yango",
    upstreamStatus: Number.isInteger(upstreamStatus) && upstreamStatus > 0 ? upstreamStatus : null,
    errorCategory: ERROR_CATEGORIES.has(errorCategory) ? errorCategory : "UPSTREAM_ERROR",
    requestReachedUpstream: [true, false, "unknown"].includes(requestReachedUpstream) ? requestReachedUpstream : "unknown",
  };
}

function clientErrorWithDiagnostics(code, message, status, errorCategory, reached = "unknown") {
  const error = clientError(code, message, status);
  error.yangoDiagnostics = diagnostics(errorCategory, status, reached);
  return error;
}

function httpErrorCategory(status) {
  if (status === 401) return "AUTH_ERROR";
  if (status === 403) return "FORBIDDEN";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "BAD_REQUEST";
  return "UPSTREAM_ERROR";
}

const STRUCTURED_CODE_FIELDS = new Set(["code", "error_code", "errorCode", "status_code", "statusCode"]);

function inspectErrorBody(text) {
  const value = String(text || "");
  if (!value.trim()) return { bodyKind: "empty", structuredCodeFieldPresent: false };
  try {
    const parsed = JSON.parse(value);
    const hasCode = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && [...STRUCTURED_CODE_FIELDS].some((field) => Object.prototype.hasOwnProperty.call(parsed, field));
    return { bodyKind: "json", structuredCodeFieldPresent: hasCode };
  } catch {
    return { bodyKind: /^[\[{]/.test(value.trim()) ? "invalid_json" : "text", structuredCodeFieldPresent: false };
  }
}

function emitDevelopmentDiagnostic({ enabled, sink, status, body }) {
  if (enabled !== true || process.env.NODE_ENV === "production" || typeof sink !== "function") return;
  const shape = inspectErrorBody(body);
  try {
    sink({ upstreamStatus: Number.isInteger(status) ? status : null, ...shape });
  } catch {
    // Diagnostics must never affect provider error handling.
  }
}

function parseTestLocation(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function yangoSelectedClass(rideType, fallback) {
  const value = String(rideType || "").trim();
  const fairfareToYango = { bike: "moto", car: "econom", mini: "econom", rickshaw: "econom" };
  return fairfareToYango[value] || value || fallback;
}

function normalizeNearestDrivers(body) {
  if (!Array.isArray(body?.drivers)) return null;
  return body.drivers.map((driver) => {
    const positions = Array.isArray(driver?.positions) ? driver.positions : [];
    const position = positions[positions.length - 1];
    const latitude = Number(position?.lat);
    const longitude = Number(position?.lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    const direction = Number(position.direction);
    const timestamp = Number(position.timestamp);
    return {
      latitude,
      longitude,
      ...(Number.isFinite(direction) ? { heading: direction } : {}),
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      ...(typeof driver.free === "boolean" ? { available: driver.free } : {}),
      ...(typeof driver.display_tariff === "string" ? { tariff: driver.display_tariff } : {}),
      ...(typeof driver.static_icon === "boolean" ? { staticIcon: driver.static_icon } : {}),
    };
  }).filter(Boolean);
}

function buildNearestDriversPayload({ latitude, longitude, rideType, config, id = crypto.randomUUID() } = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw clientError("PROVIDER_INVALID_REQUEST", "Yango nearby-driver coordinates are invalid.");
  }
  return {
    id: String(id),
    point: [lng, lat],
    classes: [yangoSelectedClass(rideType, config?.selectedClass || "econom")],
    current_drivers: [],
    simplify: true,
    payment: { type: config?.paymentType || "cash" },
  };
}

function nearestDriversHeaders(config) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    Authorization: `Bearer ${config.accessToken}`,
    "X-Oauth-Token": config.accessToken,
  };
  const optional = {
    "X-Yataxi-Userid": config.driverRequestHeaders?.userId,
    "User-Agent": config.driverRequestHeaders?.userAgent,
    "X-User-Agent-Split": config.driverRequestHeaders?.userAgentSplit,
    "X-Ya-Go-Superapp-Session": config.driverRequestHeaders?.superappSession,
    "X-Perf-Class": config.driverRequestHeaders?.perfClass,
    "Accept-Language": config.driverRequestHeaders?.acceptLanguage,
    "X-Appmetrica-Uuid": config.driverRequestHeaders?.appmetricaUuid,
    "X-Appmetrica-Deviceid": config.driverRequestHeaders?.appmetricaDeviceId,
    "X-Mob-Id": config.driverRequestHeaders?.mobileId,
    "X-Vpn-Active": config.driverRequestHeaders?.vpnActive,
    "X-Yataxi-Last-Zone-Names": config.driverRequestHeaders?.lastZoneNames || config.zoneName,
    "X-Yataxi-Has-Ongoing-Orders": config.driverRequestHeaders?.hasOngoingOrders,
    "X-Yataxi-Ongoing-Orders-Statuses": config.driverRequestHeaders?.ongoingOrdersStatuses,
  };
  for (const [name, value] of Object.entries(optional)) if (value) headers[name] = value;
  return headers;
}

function createYangoRouteStatsClient({ config, testContext = null, fetchImpl = globalThis.fetch, now = Date.now, diagnosticsEnabled = false, onDiagnostic = null, payloadRecorder = recordProviderApiPayload } = {}) {
  return {
    async getNearbyDrivers({ latitude, longitude, rideType = "car" } = {}) {
      if (!config?.enabled || config.mode !== "authorized-live" || !config.authorizationConfigured) throw clientErrorWithDiagnostics("PROVIDER_AUTH_REQUIRED", "Yango authorization is required.", null, "AUTH_ERROR", false);
      const tokenState = inspectAccessToken(config.accessToken, now);
      if (tokenState.kind === "missing" || tokenState.kind === "invalid" || tokenState.expired) throw clientErrorWithDiagnostics("PROVIDER_AUTH_REQUIRED", "Yango access token is unavailable or expired.", null, "AUTH_ERROR", false);
      if (typeof fetchImpl !== "function") throw clientErrorWithDiagnostics("PROVIDER_UNAVAILABLE", "HTTP transport is unavailable.", null, "NETWORK_ERROR", false);
      const payload = buildNearestDriversPayload({ latitude, longitude, rideType, config });
      const url = new URL(`${config.baseUrl}${config.nearestDriversPath}`);
      if (config.nearestDriversMobcf) url.searchParams.set("mobcf", config.nearestDriversMobcf);
      if (config.nearestDriversMobpr) url.searchParams.set("mobpr", config.nearestDriversMobpr);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), { method: "POST", headers: nearestDriversHeaders(config), body: JSON.stringify(payload), signal: controller.signal });
        const text = await response.text();
        if (!response.ok) {
          const category = httpErrorCategory(response.status);
          const code = category === "AUTH_ERROR" || category === "FORBIDDEN" ? "PROVIDER_AUTH_ERROR" : "PROVIDER_ERROR";
          throw clientErrorWithDiagnostics(code, "Yango nearest-drivers request failed.", response.status, category, true);
        }
        let body;
        try { body = JSON.parse(text); } catch { throw clientErrorWithDiagnostics("PROVIDER_BAD_RESPONSE", "Yango returned malformed nearby-driver JSON.", response.status, "INVALID_RESPONSE", true); }
        const drivers = normalizeNearestDrivers(body);
        if (!drivers) throw clientErrorWithDiagnostics("PROVIDER_BAD_RESPONSE", "Yango returned an invalid nearby-driver response.", response.status, "INVALID_RESPONSE", true);
        // This is FairFare's receipt time, not the driver's position capture time.
        return { provider: "Yango", status: drivers.length ? "available" : "no_drivers", source: "live", rideType: yangoSelectedClass(rideType, config.selectedClass), drivers, driverCount: drivers.length, receivedAt: new Date(now()).toISOString() };
      } catch (error) {
        if (error?.name === "AbortError") throw clientErrorWithDiagnostics("PROVIDER_TIMEOUT", "Yango nearest-drivers request timed out.", null, "TIMEOUT", "unknown");
        if (error?.yangoDiagnostics || error?.code === "PROVIDER_INVALID_REQUEST") throw error;
        throw clientErrorWithDiagnostics(error?.code || "PROVIDER_UNAVAILABLE", "Yango nearest-drivers transport failed.", null, "NETWORK_ERROR", "unknown");
      } finally { clearTimeout(timer); }
    },
    async getFareEstimates({ pickup, destination, rideType } = {}) {
      if (!config?.enabled || config.mode !== "authorized-live" || !config.authorizationConfigured) throw clientErrorWithDiagnostics("PROVIDER_AUTH_REQUIRED", "Yango authorization is required.", null, "AUTH_ERROR", false);
      const tokenState = inspectAccessToken(config.accessToken, now);
      if (tokenState.kind === "missing") throw clientErrorWithDiagnostics("PROVIDER_AUTH_REQUIRED", "Yango access token is required.", null, "AUTH_ERROR", false);
      if (tokenState.kind === "invalid") throw clientErrorWithDiagnostics("PROVIDER_AUTH_REQUIRED", "Yango access token format is invalid.", null, "AUTH_ERROR", false);
      if (tokenState.expired) throw clientErrorWithDiagnostics("PROVIDER_AUTH_REQUIRED", "Yango access token is expired.", null, "AUTH_ERROR", false);
      if (typeof fetchImpl !== "function") throw clientErrorWithDiagnostics("PROVIDER_UNAVAILABLE", "HTTP transport is unavailable.", null, "NETWORK_ERROR", "unknown");
      const approvedTestContext = process.env.NODE_ENV !== "production" && testContext?.enabled === true ? testContext : null;
      const testLocation = approvedTestContext ? parseTestLocation(approvedTestContext.location) : null;
      const payload = buildRouteStatsPayload({
        pickup,
        destination,
        zoneName: config.zoneName,
        supportedZones: config.supportedZones,
        selectedClass: yangoSelectedClass(rideType, config.selectedClass),
        paymentType: config.paymentType,
        id: approvedTestContext?.userId,
        currentLocation: testLocation ? [testLocation.longitude, testLocation.latitude] : undefined,
        preciseLocationAvailable: Boolean(testLocation),
      });
      const record = (responsePayload, httpStatus) => { if (typeof payloadRecorder === "function") void payloadRecorder({ provider: "yango", operation: "route_stats", requestPayload: payload, responsePayload, httpStatus }); };
      const url = new URL(`${config.baseUrl}${config.routeStatsPath}`);
      if (approvedTestContext?.mobcf) url.searchParams.set("mobcf", approvedTestContext.mobcf);
      if (approvedTestContext?.mobpr) url.searchParams.set("mobpr", approvedTestContext.mobpr);
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${config.accessToken}`,
        "X-Oauth-Token": config.accessToken,
      };
      if (approvedTestContext) {
        if (approvedTestContext.userId) headers["X-Yataxi-Userid"] = approvedTestContext.userId;
        if (testLocation) headers["X-Location"] = `${testLocation.latitude};${testLocation.longitude}`;
        if (config.zoneName) headers["X-Yataxi-Last-Zone-Names"] = config.zoneName;
        if (approvedTestContext.mobileId) headers["X-Mob-Id"] = approvedTestContext.mobileId;
        headers["X-Yataxi-Has-Ongoing-Orders"] = approvedTestContext.hasOngoingOrders ? "true" : "false";
        headers["X-Yataxi-Ongoing-Orders-Statuses"] = approvedTestContext.ongoingOrdersStatuses;
        headers["X-Perf-Class"] = approvedTestContext.perfClass;
        headers["Accept-Language"] = approvedTestContext.acceptLanguage;
        headers["X-Vpn-Active"] = approvedTestContext.vpnActive;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const text = await response.text();
        let observedBody = text;
        try { observedBody = JSON.parse(text); } catch { /* sanitizer records only allowlisted fields */ }
        record(observedBody, response.status);
        if (!response.ok) {
          emitDevelopmentDiagnostic({ enabled: diagnosticsEnabled, sink: onDiagnostic, status: response.status, body: text });
          const category = httpErrorCategory(response.status);
          const code = category === "AUTH_ERROR" || category === "FORBIDDEN" ? "PROVIDER_AUTH_ERROR" : "PROVIDER_ERROR";
          throw clientErrorWithDiagnostics(code, "Yango RouteStats request failed.", response.status, category, true);
        }
        let body;
        try { body = JSON.parse(text); } catch { throw clientErrorWithDiagnostics("PROVIDER_BAD_RESPONSE", "Yango returned malformed JSON.", response.status, "INVALID_RESPONSE", true); }
        const normalized = normalizeRouteStatsResponse(body);
        if (normalized?.status !== "available") {
          throw clientErrorWithDiagnostics(
            normalized?.error?.code || "PROVIDER_BAD_RESPONSE",
            normalized?.error?.message || "Yango returned no valid live tariffs.",
            response.status,
            normalized?.error?.code === "PROVIDER_NO_VALID_TARIFFS" ? "NO_VALID_TARIFFS" : "INVALID_RESPONSE",
            true,
          );
        }
        return normalized;
      } catch (error) {
        if (error?.name === "AbortError") throw clientErrorWithDiagnostics("PROVIDER_TIMEOUT", "Yango RouteStats request timed out.", null, "TIMEOUT", "unknown");
        if (error?.yangoDiagnostics) throw error;
        throw clientErrorWithDiagnostics(error?.code || "PROVIDER_UNAVAILABLE", "Yango RouteStats transport failed.", null, "NETWORK_ERROR", "unknown");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createYangoRouteStatsClient, inspectAccessToken, jwtExpired, inspectErrorBody, normalizeNearestDrivers, buildNearestDriversPayload };
