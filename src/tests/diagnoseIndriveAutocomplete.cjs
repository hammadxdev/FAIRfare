require("../config/env");
const crypto = require("node:crypto");
const { query } = require("../config/postgres");

// Postman diagnostic fixture only; production callers must provide dynamic values.
const POSTMAN_FIXTURE = Object.freeze({
  text: "lgu",
  cityId: 5388,
  orderTypeId: 2,
  latitude: 31.4742052,
  longitude: 74.4163286,
});

function jwtExpiry(token) {
  try {
    const payload = token.split(".")[1];
    const exp = Number(JSON.parse(Buffer.from(payload, "base64url")).exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch (_) { return null; }
}

function validLatitude(value) { return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= -90 && Number(value) <= 90; }
function validLongitude(value) { return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= -180 && Number(value) <= 180; }

function buildAutocompleteRequest(input = POSTMAN_FIXTURE) {
  if (typeof input.text !== "string" || input.text.trim().length < 1 || input.text.length > 120) throw new TypeError("autocomplete text is invalid");
  if (!Number.isInteger(Number(input.cityId)) || Number(input.cityId) <= 0) throw new TypeError("cityId is invalid");
  if (!Number.isInteger(Number(input.orderTypeId)) || Number(input.orderTypeId) <= 0) throw new TypeError("orderTypeId is invalid");
  if (!validLatitude(input.latitude) || !validLongitude(input.longitude)) throw new TypeError("reference coordinates are invalid");
  const endpoint = String(process.env.INDRIVE_AUTHORIZED_AUTOCOMPLETE_URL || "").trim();
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ locale: "en_US", cid: String(input.cityId), requester: "mobile", route_point_type: "to" }).toString();
  const body = new URLSearchParams({
    text: input.text,
    cid: String(input.cityId),
    order_type_id: String(input.orderTypeId),
    latitude: String(input.latitude),
    longitude: String(input.longitude),
    need_address_type: "true",
    with_raw: "true",
  });
  return { url: url.toString(), body: body.toString() };
}

function configuredHeader(name) { return String(process.env[name] || "").trim(); }
function requestHeaders(accessToken) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Bearer ${accessToken}`,
    "X-Local-Req-Id": crypto.randomUUID(),
  };
  for (const [header, envName] of [
    ["Accept-Language", "INDRIVE_ACCEPT_LANGUAGE"],
    ["X-App", "INDRIVE_X_APP"],
    ["X-App-Flavor", "INDRIVE_X_APP_FLAVOR"],
    ["X-Os-Type", "INDRIVE_X_OS_TYPE"],
    ["User-Agent", "INDRIVE_USER_AGENT"],
    ["X-Device-Fingerprint", "INDRIVE_DEVICE_FINGERPRINT"],
    ["X-Fingerprint", "INDRIVE_X_FINGERPRINT"],
  ]) {
    const value = configuredHeader(envName);
    if (value) headers[header] = value;
  }
  return headers;
}

function sanitizeScalar(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text && !/(token|authorization|cookie|fingerprint|device|credential|secret|password|signature)/i.test(text) ? text.slice(0, 200) : null;
}

function sanitizeError(body) {
  const source = body && typeof body === "object" ? body : {};
  const code = sanitizeScalar(source.code || source.error_code || source.errorCode || source.error);
  const message = sanitizeScalar(source.message || source.error_description || source.error_message || source.detail);
  return { code, message };
}

function mapSuggestion(item) {
  return {
    suggestId: item?.suggest_id ?? null,
    placeId: item?.place_id ?? null,
    address: item?.address ?? null,
    description: item?.description ?? null,
    latitude: item?.latitude ?? null,
    longitude: item?.longitude ?? null,
    locality: item?.locality ?? null,
    postalCode: item?.postal_code ?? null,
    addressType: item?.address_type ?? null,
  };
}

function validSuggestionCoordinates(item) {
  return validLatitude(item?.latitude) && validLongitude(item?.longitude);
}

function normalizeResponse(body) {
  const items = body?.response?.items;
  if (!Array.isArray(items)) return { valid: false, suggestions: [], invalidItemCount: 0, errorCode: "PROVIDER_RESPONSE_ITEMS_MISSING" };
  const suggestions = items.filter(validSuggestionCoordinates).map(mapSuggestion);
  return { valid: true, suggestions, invalidItemCount: items.length - suggestions.length };
}

async function fetchAutocomplete(request, accessToken, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request.url, { method: "POST", headers: requestHeaders(accessToken), body: request.body, signal: controller.signal });
    const length = Number(response.headers.get("content-length") || 0);
    const contentType = String(response.headers.get("content-type") || "").slice(0, 120) || null;
    if (length > 1024 * 1024) return { httpStatus: response.status, contentType, responseBytes: length, body: {}, errorCode: "RESPONSE_TOO_LARGE" };
    const text = await response.text();
    const responseBytes = Buffer.byteLength(text, "utf8");
    if (responseBytes > 1024 * 1024) return { httpStatus: response.status, contentType, responseBytes, body: {}, errorCode: "RESPONSE_TOO_LARGE" };
    try { return { httpStatus: response.status, contentType, responseBytes, body: text ? JSON.parse(text) : {} }; }
    catch (_) { return { httpStatus: response.status, contentType, responseBytes, body: {}, errorCode: "MALFORMED_JSON" }; }
  } catch (error) {
    return { httpStatus: null, contentType: null, responseBytes: 0, body: {}, errorCode: error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "TRANSPORT_UNAVAILABLE" };
  } finally { clearTimeout(timer); }
}

function responseShape(body) {
  const topLevelKeys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : [];
  const wrapped = body && typeof body === "object" && body.response && typeof body.response === "object" && !Array.isArray(body.response) ? body.response : null;
  return {
    topLevelKeys,
    responseKeys: wrapped ? Object.keys(wrapped).sort() : [],
    responseItemsIsArray: Array.isArray(wrapped?.items),
    itemsIsArray: Array.isArray(body?.items),
    applicationError: sanitizeError(body?.response?.error || body?.error || body?.response?.errors || body?.errors),
  };
}

async function diagnose() {
  const session = (await query("SELECT access_token, access_expires_at FROM provider_sessions WHERE provider = $1", ["indrive"])).rows[0] || null;
  const accessToken = String(session?.access_token || "").trim();
  const endpoint = String(process.env.INDRIVE_AUTHORIZED_AUTOCOMPLETE_URL || "").trim();
  const exp = Number.isFinite(Number(session?.access_expires_at)) ? Math.floor(Number(session.access_expires_at) / 1000) : jwtExpiry(accessToken);
  const base = { provider: "indrive", endpointConfigured: Boolean(endpoint), credentialConfigured: Boolean(accessToken), accessTokenLocallyExpired: exp === null ? null : Math.floor(Date.now() / 1000) >= exp, requestAttempted: false };
  if (!endpoint) return console.log(JSON.stringify({ ...base, status: "unavailable", errorCode: "ENDPOINT_NOT_CONFIGURED" }));
  if (!accessToken || exp === null) return console.log(JSON.stringify({ ...base, status: "auth_error", errorCode: "ACCESS_TOKEN_INVALID" }));
  if (base.accessTokenLocallyExpired) return console.log(JSON.stringify({ ...base, status: "auth_error", errorCode: "ACCESS_TOKEN_EXPIRED" }));
  const request = buildAutocompleteRequest();
  const result = await fetchAutocomplete(request, accessToken, Number(process.env.INDRIVE_REQUEST_TIMEOUT_MS || 10000));
  const shape = responseShape(result.body);
  if (result.errorCode) return console.log(JSON.stringify({ ...base, requestAttempted: true, httpStatus: result.httpStatus, contentType: result.contentType, responseBytes: result.responseBytes, responseValidation: false, status: "provider_error", errorCode: result.errorCode, ...shape }));
  if (result.httpStatus < 200 || result.httpStatus >= 300) return console.log(JSON.stringify({ ...base, requestAttempted: true, httpStatus: result.httpStatus, contentType: result.contentType, responseBytes: result.responseBytes, responseValidation: false, status: result.httpStatus === 401 || result.httpStatus === 403 ? "auth_error" : "provider_error", error: sanitizeError(result.body), ...shape }));
  const normalized = normalizeResponse(result.body);
  return console.log(JSON.stringify({ ...base, requestAttempted: true, httpStatus: result.httpStatus, contentType: result.contentType, responseBytes: result.responseBytes, responseValidation: normalized.valid, status: normalized.valid ? "available" : "provider_error", suggestionCount: normalized.suggestions.length, ...shape, suggestions: normalized.suggestions }));
}

if (require.main === module) diagnose().catch(() => { console.log(JSON.stringify({ requestAttempted: false, status: "provider_error", errorCode: "DIAGNOSTIC_FAILED" })); process.exitCode = 1; });
module.exports = { POSTMAN_FIXTURE, buildAutocompleteRequest, jwtExpiry, mapSuggestion, normalizeResponse, sanitizeError, fetchAutocomplete, responseShape, validSuggestionCoordinates };
