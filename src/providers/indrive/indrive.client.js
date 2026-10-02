const crypto = require("crypto");
const { TOKEN_RENEW_URL, PRICING_URL } = require("./indrive.constants");
const { IndriveError, CODES } = require("./indrive.errors");

function headers(config, accessToken) {
  const result = {
    Accept: "application/json",
    Referer: "order_form",
    "Accept-Language": config.language,
    "X-Os-Type": config.osType,
    "X-App-Flavor": config.appFlavor,
    "X-App": config.appVersion,
    "X-Device-Fingerprint": config.deviceFingerprint,
    "X-Fingerprint": config.fingerprint,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "okhttp/5.3.0",
  };
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

function createIndriveClient({ config, fetchImpl = global.fetch, logger = console } = {}) {
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
      assertConfigured(config);
      return requestJson(PRICING_URL, {
        method: "POST",
        headers: { ...headers(config, accessToken), "X-Local-Req-Id": crypto.randomUUID() },
        body: JSON.stringify(payload),
      }, config, fetchImpl);
    },
  };
}

module.exports = { createIndriveClient, headers, assertConfigured };
