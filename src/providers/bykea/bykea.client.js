const crypto = require("node:crypto");

function providerError(code, message, httpStatus = null) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function coordinate(value, label, min, max) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw providerError("PROVIDER_INVALID_REQUEST", `${label} must be a finite coordinate within its valid range.`);
  }
  return number;
}

function normalizeLocation(location, label) {
  const value = location || {};
  return {
    latitude: coordinate(value.latitude ?? value.lat, `${label}.latitude`, -90, 90),
    longitude: coordinate(value.longitude ?? value.lng ?? value.lon, `${label}.longitude`, -180, 180),
  };
}

function buildFareRequest({ pickup, destination } = {}) {
  const start = normalizeLocation(pickup, "pickup");
  const end = normalizeLocation(destination, "destination");
  return {
    s_lat: start.latitude,
    s_lng: start.longitude,
    e_lat: end.latitude,
    e_lng: end.longitude,
  };
}

function buildFareQuery({ pickup, destination, config, rideType = null } = {}) {
  const coordinates = buildFareRequest({ pickup, destination });
  const requestType = String(config?.requestType || "").trim();
  const hasConfiguredVehicleType = config && Object.prototype.hasOwnProperty.call(config, "vehicleType") && config.vehicleType !== null && config.vehicleType !== undefined;
  const vehicleType = hasConfiguredVehicleType ? String(config.vehicleType).trim() : rideType === null || rideType === undefined ? null : String(rideType).trim();
  const deviceId = String(config?.deviceId || "").trim();
  const codes = Array.isArray(config?.serviceCodes) ? config.serviceCodes : [];
  if (!deviceId || !requestType || vehicleType === null || !codes.length) {
    throw providerError("PROVIDER_INVALID_CONFIGURATION", "Bykea device ID, request type, vehicle type, and service codes are required.");
  }
  return {
    ...coordinates,
    device_id: deviceId,
    type: requestType,
    v_type: vehicleType,
    service_codes: JSON.stringify(codes.map((code) => /^\d+$/.test(String(code)) ? Number(code) : String(code))),
  };
}

function buildFareUrl({ config, pickup, destination, rideType = null, endpoint = null } = {}) {
  if (!config?.apiBaseUrl || !config?.fareEndpoint) {
    throw providerError("PROVIDER_INVALID_CONFIGURATION", "Bykea API base URL and fare endpoint are required.");
  }
  const url = new URL(endpoint || config.fareEndpoint, `${config.apiBaseUrl}/`);
  for (const [key, value] of Object.entries(buildFareQuery({ pickup, destination, config, rideType }))) url.searchParams.set(key, String(value));
  return url;
}

function mandatoryHeaders(config) {
  const latitude = Number(config?.headerLatitude);
  const longitude = Number(config?.headerLongitude);
  const altitude = Number(config?.headerAltitude);
  if (!String(config?.appUserType || "").trim()) throw providerError("PROVIDER_INVALID_CONFIGURATION", "BYKEA_APP_USER_TYPE is required.");
  if (!String(config?.headerLatitude || "").trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw providerError("PROVIDER_INVALID_CONFIGURATION", "BYKEA_HEADER_LATITUDE must be a finite latitude.");
  if (!String(config?.headerLongitude || "").trim() || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw providerError("PROVIDER_INVALID_CONFIGURATION", "BYKEA_HEADER_LONGITUDE must be a finite longitude.");
  if (!String(config?.headerAltitude || "").trim() || !Number.isFinite(altitude)) throw providerError("PROVIDER_INVALID_CONFIGURATION", "BYKEA_HEADER_ALTITUDE must be numeric.");
  if (!String(config?.appLanguage || "").trim()) throw providerError("PROVIDER_INVALID_CONFIGURATION", "BYKEA_APP_LANGUAGE is required.");
  if (!String(config?.userAgent || "").trim()) throw providerError("PROVIDER_INVALID_CONFIGURATION", "BYKEA_USER_AGENT is required.");
  return {
    "X-App-User-Type": String(config.appUserType).trim(),
    "X-Loc-Latitude": String(config.headerLatitude).trim(),
    "X-Loc-Longitude": String(config.headerLongitude).trim(),
    "X-Loc-Altitude": String(config.headerAltitude).trim(),
    "X-App-Language": String(config.appLanguage).trim(),
    "X-User-Agent": String(config.userAgent).trim(),
  };
}

function mergeHeaders(existing, required) {
  const merged = {};
  for (const [name, value] of Object.entries(existing || {})) {
    const duplicate = Object.keys(required).find((requiredName) => requiredName.toLowerCase() === name.toLowerCase());
    if (!duplicate) merged[name] = value;
  }
  return { ...merged, ...required };
}

function summarizeBykeaRequest(url, options = {}) {
  const parsed = new URL(url);
  const headers = options.headers || {};
  const headerNames = Object.keys(headers);
  const headerValue = (name) => {
    const actual = headerNames.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return actual ? headers[actual] : undefined;
  };
  const serviceCodes = parsed.searchParams.get("service_codes");
  let parsedServiceCodes = null;
  try { parsedServiceCodes = JSON.parse(serviceCodes); } catch { /* summary only */ }
  return {
    method: String(options.method || "GET").toUpperCase(),
    endpointPath: parsed.pathname,
    queryParameterNames: [...new Set([...parsed.searchParams.keys()])].sort(),
    query: {
      vTypePresent: parsed.searchParams.has("v_type"),
      vTypeEmpty: parsed.searchParams.has("v_type") && parsed.searchParams.get("v_type") === "",
      serviceCodesPresent: parsed.searchParams.has("service_codes"),
      serviceCodesIsJsonArray: Array.isArray(parsedServiceCodes),
      serviceCodesItemTypes: Array.isArray(parsedServiceCodes) ? parsedServiceCodes.map((item) => typeof item) : [],
    },
    headerNames: headerNames.map((name) => name.toLowerCase()).sort(),
    headersPresent: Object.fromEntries(["X-App-User-Id", "X-App-User-Token", "X-App-User-Type", "X-App-Language", "X-App-Version", "X-Loc-Latitude", "X-Loc-Longitude", "X-Loc-Altitude", "X-User-Agent", "X-Amzn-Trace-Id", "Accept-Encoding", "User-Agent"].map((name) => [name, headerValue(name) !== undefined])),
    authenticationFieldsPopulated: ["X-App-User-Id", "X-App-User-Token"].every((name) => String(headerValue(name) || "").length > 0),
  };
}

function classifyHttpFailure(status) {
  if (status === 401) return ["PROVIDER_AUTH_REQUIRED", "Bykea authorization is required."];
  if (status === 403) return ["PROVIDER_ACCESS_DENIED", "Bykea access was denied."];
  if (status === 429) return ["PROVIDER_RATE_LIMITED", "Bykea rate limit was reached."];
  if (status >= 500) return ["PROVIDER_UNAVAILABLE", "Bykea is temporarily unavailable."];
  return ["PROVIDER_ERROR", "Bykea fare request failed."];
}

function safeLog(logger, event) {
  if (typeof logger !== "function") return;
  try {
    logger({ provider: "bykea", ...event });
  } catch {
    // Diagnostics must never change provider behavior.
  }
}

/**
 * Build a transport only when an authorized Bykea contract is supplied.
 * `requestContract` must be provided by the documented integration and must
 * contain `buildHeaders({ config })` and `parseResponse(body, status)`. The
 * contract owns the exact authentication headers; this client never guesses
 * them from a captured request.
 */
function createBykeaHttpTransport({ config, requestContract = null, requestImpl = globalThis.fetch, logger = null, now = Date.now } = {}) {
  if (!config?.apiBaseUrl || config.mode !== "authorized-live" || !config.endpointContractConfigured || !config.mandatoryHeadersConfigured || !config.appUserToken || !requestContract) return null;
  const endpoint = requestContract.path || config.fareEndpoint;
  if (typeof endpoint !== "string" || !endpoint.trim()) return null;
  if (typeof requestContract.buildHeaders !== "function" || typeof requestContract.parseResponse !== "function") return null;
  if (typeof requestImpl !== "function") return null;

  return {
    async getFareEstimates({ pickup, destination, rideType } = {}) {
      const requiredHeaders = mandatoryHeaders(config);
      const url = buildFareUrl({ config, pickup, destination, rideType, endpoint });
      const requestId = crypto.randomUUID();
      const headers = requestContract.buildHeaders({
        config: { ...config, apiKey: undefined, appUserToken: undefined },
        appUserToken: config.appUserToken,
        deviceId: config.deviceId,
        appUserId: config.appUserId,
      });
      if (!headers || typeof headers !== "object") throw providerError("PROVIDER_INVALID_CONFIGURATION", "Bykea request headers are not configured.");
      const requestHeaders = mergeHeaders(headers, requiredHeaders);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      safeLog(logger, { operation: "fare_estimate", requestId, requestReachedUpstream: false, coordinateFieldsPresent: true });
      try {
        const response = await requestImpl(url.toString(), {
          method: String(requestContract.method || "GET").toUpperCase(),
          headers: { Accept: "application/json", ...requestHeaders },
          signal: controller.signal,
        });
        safeLog(logger, { operation: "fare_estimate", requestId, requestReachedUpstream: true, httpStatus: response.status });
        if (!response.ok) {
          const [code, message] = classifyHttpFailure(response.status);
          throw providerError(code, message, response.status);
        }
        let body;
        try {
          body = await response.json();
        } catch {
          throw providerError("PROVIDER_BAD_RESPONSE", "Bykea returned malformed JSON.", response.status);
        }
        return requestContract.parseResponse(body, response.status);
      } catch (error) {
        if (error?.name === "AbortError") throw providerError("PROVIDER_TIMEOUT", "Bykea fare request timed out.");
        if (error?.httpStatus || error?.code === "PROVIDER_BAD_RESPONSE") throw error;
        throw providerError(error?.code || "PROVIDER_UNAVAILABLE", "Bykea fare transport failed.");
      } finally {
        clearTimeout(timer);
        void now;
      }
    },
  };
}

module.exports = {
  buildFareRequest,
  buildFareQuery,
  buildFareUrl,
  mandatoryHeaders,
  mergeHeaders,
  summarizeBykeaRequest,
  classifyHttpFailure,
  createBykeaHttpTransport,
  normalizeLocation,
};
