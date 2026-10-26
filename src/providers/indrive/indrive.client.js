const crypto = require("crypto");
const { TOKEN_RENEW_URL, PRICING_URL, LOCATIONS_URL, ROUTE_URL } = require("./indrive.constants");
const { IndriveError, CODES } = require("./indrive.errors");
const { recordProviderApiPayload } = require("../../services/providerApiPayloadStorage.service");

function headers(config, accessToken) {
  const result = {
    Accept: "application/json",
    Referer: "order_form",
    "Accept-Language": config.language,
    "X-Os-Type": config.osType,
    "X-App-Flavor": config.appFlavor,
    "X-App": config.appVersion,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "okhttp/5.3.0",
  };
  if (config.deviceFingerprint) result["X-Device-Fingerprint"] = config.deviceFingerprint;
  if (config.fingerprint) result["X-Fingerprint"] = config.fingerprint;
  if (accessToken) result.Authorization = `Bearer ${accessToken}`;
  return result;
}

function assertConfigured(config) {
  if (!config.deviceFingerprint || !config.fingerprint) {
    throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive authentication configuration is unavailable");
  }
}

function safeContentType(value) {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || null;
}

function safeProviderScalar(value, limit) {
  if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") || value === "") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text || /(token|authorization|fingerprint|did|shield|account|device|credential)/i.test(text)) return null;
  return text.slice(0, limit) || null;
}

function safeProviderCode(value) {
  if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") || value === "") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(text) ? text : null;
}

function providerErrorMetadata(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { providerErrorCode: null, providerErrorMessage: null };
  const scalar = (keys, limit, sanitizer = safeProviderScalar) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        const value = sanitizer(body[key], limit);
        if (value !== null) return value;
      }
    }
    return null;
  };
  return {
    providerErrorCode: scalar(["error_code", "errorCode", "code", "error"], 80, safeProviderCode),
    providerErrorMessage: scalar(["error_description", "message", "error_message", "errorMessage"], 200),
  };
}

function responseContentType(response) {
  return safeContentType(response?.headers?.get?.("content-type") || response?.headers?.["content-type"] || null);
}

async function requestJson(url, options, config, fetchImpl = global.fetch, onResponse = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const contentType = responseContentType(response);
    const text = await response.text();
    let body = null;
    let jsonDetected = false;
    if (text) {
      try { body = JSON.parse(text); jsonDetected = true; } catch {
        onResponse?.({ status: response.status, contentType, jsonDetected: false, body: null });
        throw new IndriveError(CODES.BAD_RESPONSE, "inDrive returned malformed JSON", { status: response.status });
      }
    }
    onResponse?.({ status: response.status, contentType, jsonDetected, body });
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof IndriveError) throw error;
    if (error.name === "AbortError") throw new IndriveError(CODES.TIMEOUT, "inDrive request timed out");
    throw new IndriveError(CODES.UNAVAILABLE, "inDrive request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function createIndriveClient({ config, fetchImpl = global.fetch, logger = console, payloadRecorder = recordProviderApiPayload } = {}) {
  const record = (operation, requestPayload) => (response) => {
    if (operation === "pricing" && typeof payloadRecorder === "function") void payloadRecorder({ provider: "indrive", operation, requestPayload, responsePayload: response.body, httpStatus: response.status });
  };
  return {
    async renew(refreshToken) {
      assertConfigured(config);
      const localRequestId = crypto.randomUUID();
      const renewHeaders = { ...headers(config), "X-Local-Req-Id": localRequestId };
      logger.log("[inDrive] renew request", {
        endpoint: TOKEN_RENEW_URL,
        refreshTokenPresent: Boolean(refreshToken),
        deviceFingerprintPresent: Boolean(config.deviceFingerprint),
        fingerprintPresent: Boolean(config.fingerprint),
        localRequestIdSent: true,
        appVersion: config.appVersion,
        language: config.language,
        osType: config.osType,
        appFlavor: config.appFlavor,
      });
      return requestJson(TOKEN_RENEW_URL, {
        method: "POST",
        headers: renewHeaders,
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, config, fetchImpl, (response) => {
        if (response.status >= 200 && response.status < 300) return;
        const error = providerErrorMetadata(response.body);
        logger.log("[inDrive] renew response", {
          httpStatus: response.status,
          contentType: response.contentType,
          jsonDetected: response.jsonDetected,
          ...error,
          accessTokenReturned: Boolean(response.body?.access_token),
          refreshTokenReturned: Boolean(response.body?.refresh_token),
        });
      });
    },
    async getPricing(accessToken, payload) {
      if (!accessToken) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive access token is required");
      const requestPayload = payload;
      return requestJson(config.pricingUrl || "https://api-gw-cf.sa.apse1.aws.indriverapp.com/recprice-gateway-backend/api/pricing/v5/price", {
        method: "POST",
        headers: { ...headers(config, accessToken), "X-Local-Req-Id": crypto.randomUUID() },
        body: JSON.stringify(requestPayload),
      }, config, fetchImpl, record("pricing", requestPayload));
    },
    // inDrive's own geo service returns the route distance/duration that the
    // app itself feeds into pricing (request_source below mirrors the app).
    async getRoute(accessToken, { pickup, destination } = {}) {
      if (!accessToken) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive access token is required");
      const url = new URL(config.routeUrl || ROUTE_URL);
      url.search = new URLSearchParams({ locale: config.language || "en_US", cid: String(config.cityId), requester: "mobile" }).toString();
      const body = new URLSearchParams({
        route: JSON.stringify([
          { latitude: Number(pickup.latitude), longitude: Number(pickup.longitude) },
          { latitude: Number(destination.latitude), longitude: Number(destination.longitude) },
        ]),
        order_id: "",
        request_source: "client_order_form_rec_price_data_from_geo",
        heading: "0.0",
      });
      return requestJson(url.toString(), {
        method: "POST",
        headers: { ...headers(config, accessToken), "Content-Type": "application/x-www-form-urlencoded", "X-Local-Req-Id": crypto.randomUUID() },
        body: body.toString(),
      }, config, fetchImpl);
    },
    async getAutocomplete(accessToken, request) {
      if (!accessToken) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive access token is required");
      return requestJson(request.url, {
        method: "POST",
        headers: { ...headers(config, accessToken), "Content-Type": "application/x-www-form-urlencoded", "X-Local-Req-Id": crypto.randomUUID() },
        body: request.body,
      }, config, fetchImpl);
    },
    async getLocations(accessToken, { latitude, longitude, orderTypeId = 2 } = {}) {
      if (!accessToken) throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive access token is required");
      const url = new URL(config.locationsUrl || LOCATIONS_URL);
      url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), source: "orderform", order_type_id: String(orderTypeId) }).toString();
      return requestJson(url.toString(), {
        method: "GET",
        headers: { ...headers(config, accessToken), "X-Local-Req-Id": crypto.randomUUID() },
      }, config, fetchImpl);
    },
  };
}

module.exports = { createIndriveClient, headers, assertConfigured };
