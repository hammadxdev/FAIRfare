const { query } = require("../config/postgres");

const PROVIDERS = new Set(["indrive", "yango"]);
const OPERATIONS = new Set(["pricing", "route_stats"]);
const SENSITIVE_KEY = /(authorization|access[_-]?token|refresh[_-]?token|cookie|session|api[_-]?key|secret|password|credential|fingerprint|device|userid|user[_-]?id|account|profile|phone|email|location|latency|ip|user-agent|mob[_-]?id|ongoing)/i;
const MAX_TEXT = 240;

let enabledOverride = null;
function enabled() { return enabledOverride === null ? process.env.PROVIDER_API_PAYLOAD_STORAGE_ENABLED === "true" : enabledOverride; }

function retentionDays() {
  const value = Number(process.env.PROVIDER_API_PAYLOAD_RETENTION_DAYS || 7);
  return Number.isFinite(value) ? Math.min(30, Math.max(1, Math.floor(value))) : 7;
}

function safeText(value, limit = MAX_TEXT) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text || SENSITIVE_KEY.test(text)) return null;
  return text.slice(0, limit);
}

function safeNumber(value, { integer = false, min = null } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || (min !== null && number < min)) return null;
  return number;
}

function coordinate(value) {
  if (!value || typeof value !== "object") return null;
  const latitude = safeNumber(value.latitude ?? value.lat, { min: -90 });
  const longitude = safeNumber(value.longitude ?? value.lng, { min: -180 });
  if (latitude === null || latitude > 90 || longitude === null || longitude > 180) return null;
  return { latitude, longitude };
}

function routePoint(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const longitude = safeNumber(value[0], { min: -180 });
  const latitude = safeNumber(value[1], { min: -90 });
  return longitude !== null && longitude <= 180 && latitude !== null && latitude <= 90 ? [longitude, latitude] : null;
}

function sanitizeInDriveRequest(value) {
  const input = value && typeof value === "object" ? value : {};
  const route = Array.isArray(input.route) ? input.route.map(routePoint).filter(Boolean).slice(0, 2) : [];
  const geo = input.geo && typeof input.geo === "object" ? {
    distance_meters: safeNumber(input.geo.distance_meters, { min: 0 }),
    duration_seconds: safeNumber(input.geo.duration_seconds, { min: 0 }),
    toll_cost: safeNumber(input.geo.toll_cost, { min: 0 }),
  } : null;
  return {
    order_type_ids: Array.isArray(input.order_type_ids) ? input.order_type_ids.map((item) => safeNumber(item, { integer: true, min: 0 })).filter((item) => item !== null).slice(0, 20) : [],
    route,
    ...(geo ? { geo } : {}),
  };
}

function sanitizeInDriveResponse(value) {
  const input = value && typeof value === "object" ? value : {};
  const currency = input.currency && typeof input.currency === "object" ? {
    code: safeText(input.currency.code, 8),
    multiplier: safeNumber(input.currency.multiplier, { min: 1 }),
  } : safeText(input.currency, 8);
  const item = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    const output = {};
    for (const key of ["order_type_id", "orderTypeId", "type_id"]) {
      const value = safeNumber(entry[key], { integer: true, min: 0 });
      if (value !== null) { output.order_type_id = value; break; }
    }
    for (const key of ["autofill_price", "recommended_price", "price", "price_min", "price_max"]) {
      const raw = entry[key] && typeof entry[key] === "object" ? entry[key].value : entry[key];
      const value = safeNumber(raw, { min: 0 });
      if (value !== null) output[key] = value;
    }
    const rush = entry.is_rush ?? entry.rush_hour?.is_rush;
    if (typeof rush === "boolean") output.is_rush = rush;
    const ttl = safeNumber(entry.ttl, { min: 0 });
    if (ttl !== null) output.ttl = ttl;
    return output;
  };
  const candidates = [input.calculations, input.quotes, input.prices, input.data].find(Array.isArray) || [];
  return {
    ...(currency ? { currency } : {}),
    items: candidates.map(item).filter(Boolean).slice(0, 50),
    ...(safeText(input.status, 40) ? { status: safeText(input.status, 40) } : {}),
  };
}

function sanitizeYangoRequest(value) {
  const input = value && typeof value === "object" ? value : {};
  const output = {
    zone_name: safeText(input.zone_name, 80),
    selected_class: safeText(input.selected_class, 40),
    route: Array.isArray(input.route) ? input.route.map(routePoint).filter(Boolean).slice(0, 2) : [],
    tariff_requirements: Array.isArray(input.tariff_requirements) ? input.tariff_requirements.map((item) => ({ class: safeText(item?.class, 40) })).filter((item) => item.class).slice(0, 20) : [],
    payment: { type: safeText(input.payment?.type, 30) },
    supported_verticals: Array.isArray(input.supported_verticals) ? input.supported_verticals.map((item) => safeText(item, 40)).filter(Boolean).slice(0, 10) : [],
  };
  if (input.state && typeof input.state === "object") {
    output.state = {
      fields: Array.isArray(input.state.fields) ? input.state.fields.map((field) => ({
        type: safeText(field?.type, 10),
        position: routePoint(field?.position),
      })).filter((field) => field.type && field.position).slice(0, 2) : [],
    };
  }
  return output;
}

function sanitizeYangoResponse(value) {
  const input = value && typeof value === "object" ? value : {};
  const currency = input.currency_rules?.code || input.currency;
  const levels = input.service_levels || input.data?.service_levels || input.tariffs || input.data?.tariffs || input.classes || input.data?.classes || input.options || input.data?.options;
  const item = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    const output = {};
    for (const key of ["class", "name", "description"]) {
      const text = safeText(entry[key], 100);
      if (text) output[key] = text;
    }
    for (const key of ["price", "max_price_as_decimal"]) {
      const raw = entry[key] && typeof entry[key] === "object" ? entry[key].value ?? entry[key].amount : entry[key];
      const number = safeNumber(raw, { min: 0 });
      if (number !== null) output[key] = number;
    }
    const finalPrice = safeNumber(entry.prices?.raw?.final_price, { min: 0 });
    if (finalPrice !== null) output.final_price = finalPrice;
    const waiting = safeNumber(entry.estimated_waiting?.seconds, { min: 0 });
    if (waiting !== null) output.waiting_seconds = waiting;
    for (const key of ["available", "is_available", "supported", "unavailable"]) if (typeof entry[key] === "boolean") output[key] = entry[key];
    if (entry.tariff_unavailable && typeof entry.tariff_unavailable === "object") {
      output.unavailable = {
        code: safeText(entry.tariff_unavailable.code, 80),
        message: safeText(entry.tariff_unavailable.message, 160),
      };
    }
    return output;
  };
  return {
    ...(safeText(currency, 8) ? { currency: safeText(currency, 8) } : {}),
    ...(safeNumber(input.distance, { min: 0 }) !== null ? { distance: safeNumber(input.distance, { min: 0 }) } : {}),
    ...(safeNumber(input.time, { min: 0 }) !== null ? { duration: safeNumber(input.time, { min: 0 }) } : {}),
    items: Array.isArray(levels) ? levels.map(item).filter(Boolean).slice(0, 50) : [],
    ...(safeText(input.status, 40) ? { status: safeText(input.status, 40) } : {}),
  };
}

function sanitizePayload(provider, operation, value, direction = "request") {
  if (provider === "indrive" && operation === "pricing") return direction === "request" ? sanitizeInDriveRequest(value) : sanitizeInDriveResponse(value);
  if (provider === "yango" && operation === "route_stats") return direction === "request" ? sanitizeYangoRequest(value) : sanitizeYangoResponse(value);
  return {};
}

let queryFn = query;
let lastCleanupAt = 0;

async function cleanupExpiredProviderApiPayloads() {
  if (!enabled()) return { deleted: 0, skipped: true };
  try {
    const result = await queryFn("DELETE FROM provider_api_payloads WHERE expires_at <= NOW()", []);
    return { deleted: Number(result.rowCount || 0), skipped: false };
  } catch (error) {
    console.warn("[provider-payloads] cleanup failed", { code: error.code || "DATABASE_ERROR" });
    return { deleted: 0, skipped: false, failed: true };
  }
}

async function recordProviderApiPayload({ provider, operation, comparisonId = null, requestPayload, responsePayload, httpStatus = null, createdAt = new Date(), expiresAt = null } = {}) {
  if (!enabled() || !PROVIDERS.has(provider) || !OPERATIONS.has(operation)) return { stored: false, reason: "disabled_or_invalid" };
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const expiry = expiresAt ? new Date(expiresAt) : new Date(created.getTime() + retentionDays() * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(expiry.getTime())) return { stored: false, reason: "invalid_timestamps" };
  try {
    const result = await queryFn(
      `INSERT INTO provider_api_payloads (provider, operation, comparison_id, request_payload, response_payload, http_status, created_at, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
      [provider, operation, comparisonId ? String(comparisonId) : null, JSON.stringify(sanitizePayload(provider, operation, requestPayload, "request")), JSON.stringify(sanitizePayload(provider, operation, responsePayload, "response")), safeNumber(httpStatus, { integer: true, min: 100 }), created.toISOString(), expiry.toISOString()],
    );
    if (Date.now() - lastCleanupAt > 60 * 60 * 1000) {
      lastCleanupAt = Date.now();
      void cleanupExpiredProviderApiPayloads();
    }
    return { stored: true, rowCount: result.rowCount || 0 };
  } catch (error) {
    console.warn("[provider-payloads] persistence failed", { provider, operation, code: error.code || "DATABASE_ERROR" });
    return { stored: false, reason: "storage_failed" };
  }
}

function setQueryForTests(fn) { queryFn = fn || query; }
function setEnabledForTests(value) { enabledOverride = typeof value === "boolean" ? value : null; }
function resetStorageStateForTests() { queryFn = query; lastCleanupAt = 0; enabledOverride = null; }

module.exports = { sanitizePayload, sanitizeInDriveRequest, sanitizeInDriveResponse, sanitizeYangoRequest, sanitizeYangoResponse, recordProviderApiPayload, cleanupExpiredProviderApiPayloads, retentionDays, setQueryForTests, setEnabledForTests, resetStorageStateForTests };
