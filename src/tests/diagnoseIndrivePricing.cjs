require("../config/env");
const crypto = require("node:crypto");
const { query } = require("../config/postgres");
const { CONFIG, STATUS } = require("../providers/indrive-architecture");
const { mapIndrivePricingRequest } = require("../providers/indrive-pricing.contract");
const { mapPricingResponse } = require("../providers/indrive/indrive.mapper");

// Postman test fixture supplied for this diagnostic; not a verified live route.
const pickup = { latitude: 31.4742052, longitude: 74.4163286 };
const destination = { latitude: 31.4640061, longitude: 74.4426299 };
const route = { pickup, destination, distanceMeters: 9301, durationSeconds: 1139 };

function safeKeys(value) { return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : []; }
function estimateKeys(estimates) { return [...new Set((Array.isArray(estimates) ? estimates : []).flatMap((estimate) => safeKeys(estimate)))].sort(); }
function mapHttpFailure(status) {
  if (status === 401 || status === 403) return { status: STATUS.AUTH_ERROR, code: "AUTHORIZED_TRANSPORT_REJECTED" };
  if (status === 408 || status === 504) return { status: STATUS.TIMEOUT, code: "AUTHORIZED_TRANSPORT_TIMEOUT" };
  if (status === 429) return { status: STATUS.BUSY, code: "AUTHORIZED_TRANSPORT_RATE_LIMITED" };
  return { status: STATUS.PROVIDER_ERROR, code: "AUTHORIZED_TRANSPORT_HTTP_ERROR" };
}
function jwtExpiry(token) {
  try {
    const payload = token.split(".")[1];
    const exp = Number(JSON.parse(Buffer.from(payload, "base64url")).exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch (_) { return null; }
}

function configuredHeader(name, fallback) {
  return String(process.env[name] || fallback || "").trim();
}

function pricingHeaders(accessToken) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    Authorization: `Bearer ${accessToken}`,
    Referer: "order_form",
    "X-Local-Req-Id": crypto.randomUUID(),
  };
  const configured = [
    ["Accept-Language", "INDRIVE_ACCEPT_LANGUAGE"],
    ["X-App", "INDRIVE_X_APP"],
    ["X-App-Flavor", "INDRIVE_X_APP_FLAVOR"],
    ["X-Os-Type", "INDRIVE_X_OS_TYPE"],
    ["User-Agent", "INDRIVE_USER_AGENT"],
    ["X-Device-Fingerprint", "INDRIVE_DEVICE_FINGERPRINT"],
    ["X-Fingerprint", "INDRIVE_X_FINGERPRINT"],
  ];
  for (const [header, envName] of configured) {
    const value = configuredHeader(envName);
    if (value) headers[header] = value;
  }
  return headers;
}

function sanitizedProviderCode(body) {
  const value = body && typeof body === "object" ? (body.code || body.error_code || body.errorCode || body.error) : null;
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null;
}

const SENSITIVE_FIELD = /(token|authorization|cookie|fingerprint|device|credential|secret|password|account|profile|phone|signature)/i;
function validationDetails(body) {
  const details = { codes: [], messages: [], fields: [] };
  const add = (bucket, value) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const text = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
    if (!text || SENSITIVE_FIELD.test(text) || details[bucket].includes(text) || details[bucket].length >= 20) return;
    details[bucket].push(text);
  };
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_FIELD.test(key)) continue;
      if (/code|error_code|errorcode/i.test(key)) add("codes", child);
      else if (/message|detail|description|reason/i.test(key)) add("messages", child);
      else if (/field|path|parameter|param/i.test(key)) add("fields", child);
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(body);
  return details;
}

function buildPostmanPricingPayload() {
  const mapped = mapIndrivePricingRequest({
    pickup,
    destination,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
  });
  return {
    order_type_ids: mapped.order_type_ids,
    route: mapped.route.map(({ lat, lng }) => ({ latitude: lat, longitude: lng })),
    geo: { ...mapped.geo, provider: "" },
  };
}

async function fetchAuthorizedPricing(url, accessToken, timeoutMs, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers: pricingHeaders(accessToken), body: JSON.stringify(payload), signal: controller.signal });
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 1024 * 1024) return { httpStatus: response.status, body: {}, transportError: "AUTHORIZED_RESPONSE_TOO_LARGE" };
    const text = await response.text();
    if (text.length > 1024 * 1024) return { httpStatus: response.status, body: {}, transportError: "AUTHORIZED_RESPONSE_TOO_LARGE" };
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { return { httpStatus: response.status, body: {}, transportError: "AUTHORIZED_MALFORMED_JSON" }; }
    return { httpStatus: response.status, body };
  } catch (error) {
    return { httpStatus: null, body: {}, transportError: error?.name === "AbortError" ? "AUTHORIZED_TRANSPORT_TIMEOUT" : "AUTHORIZED_TRANSPORT_UNAVAILABLE" };
  } finally { clearTimeout(timer); }
}
async function diagnose() {
  const endpoint = String(process.env.INDRIVE_AUTHORIZED_PRICING_URL || "").trim();
  const session = (await query("SELECT access_token, access_expires_at FROM provider_sessions WHERE provider = $1", ["indrive"])).rows[0] || null;
  const accessToken = String(session?.access_token || "").trim();
  const timeoutMs = Number(process.env.INDRIVE_REQUEST_TIMEOUT_MS || 10000);
  const exp = Number.isFinite(Number(session?.access_expires_at)) ? Math.floor(Number(session.access_expires_at) / 1000) : jwtExpiry(accessToken);
  const endpointIsV6 = /\/recprice-gateway-backend\/api\/pricing\/v6\/price(?:\?|$)/i.test(endpoint);
  const base = { provider: "indrive", authorizedEndpointConfigured: Boolean(endpoint), endpointIsV6, authorizedCredentialConfigured: Boolean(accessToken), accessTokenLocallyExpired: exp === null ? null : Math.floor(Date.now() / 1000) >= exp, requestAttempted: false };
  if (!endpoint || !endpointIsV6) return console.log(JSON.stringify({ ...base, status: STATUS.UNAVAILABLE, source: "none", errorCode: "AUTHORIZED_V6_ENDPOINT_NOT_CONFIGURED" }));
  if (!accessToken || exp === null) return console.log(JSON.stringify({ ...base, status: STATUS.AUTH_ERROR, source: "none", errorCode: "AUTHORIZED_ACCESS_TOKEN_INVALID" }));
  if (base.accessTokenLocallyExpired) return console.log(JSON.stringify({ ...base, status: STATUS.AUTH_ERROR, source: "none", errorCode: "AUTHORIZED_ACCESS_TOKEN_EXPIRED" }));

  const payload = buildPostmanPricingPayload();
  const networkResult = await fetchAuthorizedPricing(endpoint, accessToken, timeoutMs, payload);
  const resultBase = { ...base, requestAttempted: true, httpStatus: networkResult.httpStatus, payloadValidated: true, outgoingPayload: payload };
  if (networkResult.transportError) return console.log(JSON.stringify({ ...resultBase, responseValidation: false, status: STATUS.PROVIDER_ERROR, source: "none", errorCode: networkResult.transportError }));
  if (networkResult.httpStatus < 200 || networkResult.httpStatus >= 300) {
    const failure = mapHttpFailure(networkResult.httpStatus);
    return console.log(JSON.stringify({ ...resultBase, responseValidation: false, status: failure.status, source: "none", errorCode: sanitizedProviderCode(networkResult.body) || failure.code, providerValidation: validationDetails(networkResult.body) }));
  }
  const quotes = mapPricingResponse(networkResult.body, route);
  const validQuotes = quotes.filter((quote) => quote.categoryId && Number.isFinite(quote.fare) && quote.fare > 0 && quote.currency);
  const currency = validQuotes[0]?.currency || null;
  const normalizedPricing = validQuotes.map((quote) => ({ categoryId: quote.categoryId, fare: quote.fare, fareMin: quote.fareMin, fareMax: quote.fareMax, currency: quote.currency, ttlSeconds: quote.metadata?.providerTtlSeconds ?? null }));
  return console.log(JSON.stringify({ ...resultBase, responseValidation: validQuotes.length > 0, status: validQuotes.length > 0 ? STATUS.AVAILABLE : STATUS.PROVIDER_ERROR, source: validQuotes.length > 0 ? "live" : "none", currency, vehicleCategoryIds: validQuotes.map((quote) => quote.categoryId), normalizedPricing, errorCode: validQuotes.length > 0 ? null : "PROVIDER_BAD_RESPONSE" }));
}
if (require.main === module) diagnose().catch(() => { console.log(JSON.stringify({ requestAttempted: false, status: STATUS.PROVIDER_ERROR, errorCode: "DIAGNOSTIC_FAILED" })); process.exitCode = 1; });
module.exports = { diagnose, safeKeys, estimateKeys, fetchAuthorizedPricing, jwtExpiry, validationDetails, buildPostmanPricingPayload };
