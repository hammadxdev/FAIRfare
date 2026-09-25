const crypto = require("crypto");
const { TOKEN_RENEW_URL, PRICING_URL } = require("./indrive.constants");
const { IndriveError, CODES } = require("./indrive.errors");

function headers(config, accessToken) {
  const result = {
    Accept: "application/json",
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

async function requestJson(url, options, config, fetchImpl = global.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { throw new IndriveError(CODES.BAD_RESPONSE, "inDrive returned malformed JSON", { status: response.status }); }
    }
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof IndriveError) throw error;
    if (error.name === "AbortError") throw new IndriveError(CODES.TIMEOUT, "inDrive request timed out");
    throw new IndriveError(CODES.UNAVAILABLE, "inDrive request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function createIndriveClient({ config, fetchImpl = global.fetch } = {}) {
  return {
    async renew(refreshToken) {
      assertConfigured(config);
      return requestJson(TOKEN_RENEW_URL, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, config, fetchImpl);
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
