const { query } = require("../config/postgres");

const PROVIDERS = new Set(["indrive", "yango"]);
const MODES = new Set(["simulated", "unavailable", "real", "authorized-live"]);
const BOOL = new Set([true, false]);
const DEFAULT_CACHE_MS = 60_000;

function activationRequested(env = process.env) {
  return String(env.PROVIDER_RUNTIME_CONFIG_ENABLED || "false").toLowerCase() === "true" &&
    String(env.PROVIDER_RUNTIME_CONFIG_ACTIVATED || "false").toLowerCase() === "true";
}

function liveCutoverRequested(env = process.env) {
  return activationRequested(env) && String(env.PROVIDER_RUNTIME_CONFIG_LIVE_CUTOVER || "false").toLowerCase() === "true";
}

function text(value, max, pattern = null) {
  if (typeof value !== "string" || !value.trim() || value.length > max) return null;
  const normalized = value.trim();
  return pattern && !pattern.test(normalized) ? null : normalized;
}

function finite(value, min, max, integer = false) {
  const number = Number(value);
  return Number.isFinite(number) && (!integer || Number.isInteger(number)) && number >= min && number <= max ? number : null;
}

function boolean(value) { return BOOL.has(value) ? value : null; }

function validateRuntimeConfig(row) {
  if (!row || !PROVIDERS.has(String(row.provider))) return { valid: false, errors: ["provider"] };
  const provider = String(row.provider);
  const errors = [];
  const normalized = {
    provider,
    enabled: boolean(row.enabled),
    active: boolean(row.active),
    mode: text(row.mode, 24),
    appVersion: text(row.app_version, 80),
    language: text(row.language, 20, /^[A-Za-z_-]+$/),
    osType: text(row.os_type, 30, /^[A-Za-z0-9_-]+$/),
    appFlavor: text(row.app_flavor, 40, /^[A-Za-z0-9_-]+$/),
    apiBaseUrl: text(row.api_base_url, 240),
    apiPath: text(row.api_path, 160, /^\/[A-Za-z0-9_./-]+$/),
    autocompletePath: text(row.autocomplete_path, 160, /^\/[A-Za-z0-9_./-]+$/),
    timeoutMs: finite(row.timeout_ms, 1000, 120000, true),
    refreshBufferSeconds: finite(row.refresh_buffer_seconds, 0, 86400, true),
    defaultZone: text(row.default_zone, 80, /^[a-z0-9_-]+$/i),
    defaultClass: text(row.default_class, 60, /^[A-Za-z0-9_.-]+$/),
    defaultPaymentType: text(row.default_payment_type, 30, /^[A-Za-z0-9_.-]+$/),
    authorizationVerified: boolean(row.authorization_verified),
    liveAuthorized: boolean(row.live_authorized),
    configVersion: finite(row.config_version ?? 1, 1, 2147483647, true),
  };
  if (!MODES.has(normalized.mode)) errors.push("mode");
  const required = provider === "indrive"
    ? ["enabled", "active", "mode", "appVersion", "language", "osType", "appFlavor", "apiBaseUrl", "apiPath", "autocompletePath", "timeoutMs", "refreshBufferSeconds", "authorizationVerified", "liveAuthorized"]
    : ["enabled", "active", "mode", "apiBaseUrl", "apiPath", "timeoutMs", "defaultZone", "defaultClass", "defaultPaymentType", "authorizationVerified", "liveAuthorized"];
  for (const key of required) if (normalized[key] === null) errors.push(key);
  if (provider === "yango" && normalized.apiBaseUrl) {
    try { if (new URL(normalized.apiBaseUrl).protocol !== "https:") errors.push("apiBaseUrl"); } catch { errors.push("apiBaseUrl"); }
  }
  if (provider === "indrive" && normalized.apiBaseUrl) {
    try { if (new URL(normalized.apiBaseUrl).protocol !== "https:") errors.push("apiBaseUrl"); } catch { errors.push("apiBaseUrl"); }
  }
  if (normalized.active && (normalized.mode === "real" || normalized.mode === "authorized-live")) {
    if (normalized.liveAuthorized !== true || normalized.authorizationVerified !== true) errors.push("live_authorization_gate");
  }
  return errors.length ? { valid: false, errors: [...new Set(errors)], config: normalized } : { valid: true, errors: [], config: normalized };
}

function cacheMs(env = process.env) {
  const value = Number(env.PROVIDER_RUNTIME_CONFIG_REFRESH_MS || DEFAULT_CACHE_MS);
  return Number.isFinite(value) ? Math.min(15 * 60 * 1000, Math.max(1000, Math.floor(value))) : DEFAULT_CACHE_MS;
}

let queryFn = query;
let cache = new Map();

async function loadProviderRuntimeConfig(provider, { force = false, env = process.env } = {}) {
  const id = String(provider || "").toLowerCase();
  if (!PROVIDERS.has(id) || !activationRequested(env)) return { source: "environment", active: false, config: null, reason: "activation_not_requested" };
  const cached = cache.get(id);
  if (!force && cached && Date.now() - cached.loadedAt < cacheMs(env)) return cached.value;
  try {
    const result = await queryFn("SELECT * FROM provider_runtime_config WHERE provider = $1 AND active = true", [id]);
    if (!result.rows.length) {
      const value = { source: "environment", active: false, config: null, reason: "no_active_configuration" };
      cache.set(id, { loadedAt: Date.now(), value });
      return value;
    }
    const validation = validateRuntimeConfig(result.rows[0]);
    if (!validation.valid) {
      const value = { source: "environment", active: false, config: null, reason: "invalid_configuration", errors: validation.errors };
      cache.set(id, { loadedAt: Date.now(), value });
      return value;
    }
    const value = { source: "supabase", active: true, config: validation.config, reason: null };
    cache.set(id, { loadedAt: Date.now(), value });
    return value;
  } catch (error) {
    const value = { source: "environment", active: false, config: null, reason: "database_unavailable", errorCode: error.code || "DATABASE_ERROR" };
    cache.set(id, { loadedAt: Date.now(), value });
    return value;
  }
}

async function resolveProviderConfig(provider, environmentConfig, options = {}) {
  const result = await loadProviderRuntimeConfig(provider, options);
  if (!result.active) return { source: "environment", activated: false, config: environmentConfig, reason: result.reason };
  const row = result.config;
  const environmentLiveGate = provider === "yango"
    ? environmentConfig.authorizationVerified === true
    : environmentConfig.simulationOnly === false;
  const liveAllowed = liveCutoverRequested(options.env || process.env) && environmentLiveGate && row.liveAuthorized === true && row.authorizationVerified === true;
  const merged = { ...environmentConfig };
  if (provider === "indrive") {
    merged.enabled = row.enabled;
    merged.pricingUrl = row.apiBaseUrl ? `${row.apiBaseUrl}${row.apiPath}` : environmentConfig.pricingUrl;
    merged.autocompleteUrl = row.apiBaseUrl ? `${row.apiBaseUrl}${row.autocompletePath}` : environmentConfig.autocompleteUrl;
    merged.appVersion = row.appVersion;
    merged.language = row.language;
    merged.osType = row.osType;
    merged.appFlavor = row.appFlavor;
    merged.timeoutMs = row.timeoutMs;
    merged.refreshBufferSeconds = row.refreshBufferSeconds;
    merged.mode = liveAllowed && row.mode === "real" ? "real" : row.mode === "simulated" ? "simulated" : "unavailable";
  } else if (provider === "yango") {
    merged.enabled = row.enabled;
    merged.baseUrl = row.apiBaseUrl || environmentConfig.baseUrl;
    merged.routeStatsPath = row.apiPath || environmentConfig.routeStatsPath;
    merged.zoneName = row.defaultZone;
    merged.selectedClass = row.defaultClass;
    merged.paymentType = row.defaultPaymentType;
    merged.timeoutMs = row.timeoutMs;
    merged.mode = liveAllowed && row.mode === "authorized-live" ? "authorized-live" : "unavailable";
    merged.authorizationVerified = liveAllowed && row.authorizationVerified === true && environmentConfig.authorizationVerified === true;
  }
  return { source: "supabase", activated: true, config: merged, reason: null, version: row.configVersion };
}

function runtimeConfigExportFromEnvironment({ indrive, yango } = {}) {
  const make = (provider, config) => provider === "indrive"
    ? { provider, enabled: Boolean(config.enabled), active: false, mode: ["simulated", "real"].includes(config.mode) ? config.mode : "unavailable", app_version: config.appVersion, language: config.language, os_type: config.osType, app_flavor: config.appFlavor, api_base_url: (() => { try { return new URL(config.pricingUrl).origin; } catch { return null; } })(), api_path: (() => { try { return new URL(config.pricingUrl).pathname; } catch { return null; } })(), autocomplete_path: (() => { try { return new URL(config.autocompleteUrl).pathname; } catch { return null; } })(), timeout_ms: config.timeoutMs, refresh_buffer_seconds: config.refreshBufferSeconds, default_zone: "lahore", default_class: "econom", default_payment_type: "cash", authorization_verified: false, live_authorized: false, config_version: 1 }
    : { provider, enabled: Boolean(config.enabled), active: false, mode: config.mode, app_version: null, language: "en-US", os_type: "android", app_flavor: "yango", api_base_url: config.baseUrl, api_path: config.routeStatsPath, autocomplete_path: null, timeout_ms: config.timeoutMs, refresh_buffer_seconds: 0, default_zone: config.zoneName, default_class: config.selectedClass, default_payment_type: config.paymentType, authorization_verified: false, live_authorized: false, config_version: 1 };
  return [make("indrive", indrive), make("yango", yango)];
}

function setQueryForTests(fn) { queryFn = fn || query; }
function resetForTests() { queryFn = query; cache = new Map(); }

module.exports = { activationRequested, liveCutoverRequested, validateRuntimeConfig, loadProviderRuntimeConfig, resolveProviderConfig, runtimeConfigExportFromEnvironment, setQueryForTests, resetForTests };
