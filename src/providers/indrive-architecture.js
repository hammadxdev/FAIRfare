const crypto = require("node:crypto");
const STATUS = Object.freeze({
  AVAILABLE: "available",
  NO_DRIVERS: "no_drivers",
  BUSY: "busy",
  TIMEOUT: "timeout",
  AUTH_ERROR: "auth_error",
  UNAVAILABLE: "unavailable",
  INVALID_REQUEST: "invalid_request",
  PROVIDER_ERROR: "provider_error",
});

const CODES = Object.freeze({
  AUTH_REQUIRED: "PROVIDER_AUTH_REQUIRED",
  TIMEOUT: "PROVIDER_TIMEOUT",
  UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  INVALID_REQUEST: "PROVIDER_INVALID_REQUEST",
  BAD_RESPONSE: "PROVIDER_BAD_RESPONSE",
  CONFLICT: "PROVIDER_SESSION_CONFLICT",
});

const CONFIG = Object.freeze({
  id: "indrive",
  displayName: "inDrive",
  region: process.env.INDRIVE_REGION || "PK",
  currency: process.env.INDRIVE_CURRENCY || "PKR",
  currencyMultiplier: Number(process.env.INDRIVE_CURRENCY_MULTIPLIER || 100),
  accessToken: "",
  refreshToken: "",
  timeoutMs: Number(process.env.INDRIVE_REQUEST_TIMEOUT_MS || 10000),
  expiryBufferSeconds: Number(process.env.INDRIVE_REFRESH_BUFFER_SECONDS || 300),
  mode: process.env.INDRIVE_AUTHORIZED_LIVE === "true" ? "authorized-live" : "unavailable",
  retryPolicy: Object.freeze({ maxAttempts: 1, retryInvalidCredentials: false }),
  rideTypes: Object.freeze([
    { id: "2", rideType: "ride_moto", name: "Moto" },
    { id: "33", rideType: "ride_mini", name: "Mini" },
    { id: "31", rideType: "ride_rickshaw", name: "Rickshaw" },
    { id: "29", rideType: "ride_ac", name: "Ride AC" },
    { id: "11", rideType: "ride_premium", name: "Premium" },
  ]),
});

class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.details = details;
    this.isProviderError = true;
    this.isOperational = true;
    this.statusCode = code === CODES.INVALID_REQUEST ? 400 : code === CODES.AUTH_REQUIRED ? 401 : code === CODES.TIMEOUT ? 504 : 502;
  }
}

function requestId() { return crypto.randomUUID(); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }

// Scheduling hint only; an unverified JWT payload is never treated as proof of auth.
function decodeJwtExpiry(token) {
  if (typeof token !== "string") return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return finite(Number(payload.exp)) && Number(payload.exp) > 0 ? Number(payload.exp) * 1000 : null;
  } catch (_) { return null; }
}

function normalizeLiveEstimate(estimate, currency, multiplier) {
  const minor = estimate?.fareMinor ?? estimate?.amountMinor;
  const rawFare = minor === undefined ? estimate?.fare : Number(minor) / multiplier;
  const fare = Number(rawFare);
  if (!finite(fare) || fare <= 0) return null;
  const declaredType = String(estimate?.priceType || estimate?.fareType || "").toLowerCase();
  const suggested = estimate?.negotiable === true || estimate?.isNegotiable === true || ["suggested", "negotiable", "recommended"].includes(declaredType);
  return {
    ...estimate,
    fare,
    currency,
    priceType: suggested ? "suggested" : ["fixed", "quote", "upfront"].includes(declaredType) ? "fixed" : "estimate",
    isNegotiable: suggested,
    quotedAt: estimate?.quotedAt || new Date().toISOString(),
    isEstimate: estimate?.isEstimate !== false,
  };
}

function coordinate(value, field, min, max) {
  const number = Number(value);
  if (!finite(number) || number < min || number > max) throw new ProviderError(CODES.INVALID_REQUEST, `${field} must be finite and in range`, { field });
  return number;
}

function location(value, field) {
  return {
    latitude: coordinate(value?.latitude ?? value?.lat, `${field}.latitude`, -90, 90),
    longitude: coordinate(value?.longitude ?? value?.lng, `${field}.longitude`, -180, 180),
  };
}

function normalizeError(error, id) {
  const code = error?.code || CODES.UNAVAILABLE;
  const status = code === CODES.TIMEOUT ? STATUS.TIMEOUT : code === CODES.AUTH_REQUIRED ? STATUS.AUTH_ERROR : code === CODES.INVALID_REQUEST ? STATUS.INVALID_REQUEST : code === CODES.RATE_LIMITED ? STATUS.BUSY : STATUS.UNAVAILABLE;
  return { provider: CONFIG.id, status, code, requestId: id, message: error?.isProviderError ? error.message : "Provider request failed" };
}

function createSessionManager({ store, refresh, initialSession = null, clock = () => Date.now(), expiryBufferSeconds = CONFIG.expiryBufferSeconds, logger = { log() {} } } = {}) {
  let session = null;
  let inFlight = null;

  async function load() {
    const loaded = store?.load ? await store.load() : session;
    if (loaded) return loaded;
    if (initialSession && (initialSession.accessToken || initialSession.refreshToken)) return { ...initialSession };
    return session;
  }
  async function saveSession(next, { expectedUpdatedAt = null } = {}) {
    const saved = { ...next, updatedAt: clock() };
    if (store?.save) await store.save(saved, { expectedUpdatedAt });
    session = saved;
    return saved;
  }
  async function clearSession() { await saveSession({ accessToken: null, refreshToken: null, accessExpiresAt: null, status: "CLEARED" }); }
  function expiryMillis(value) { return finite(Number(value?.accessExpiresAt)) ? Number(value.accessExpiresAt) : decodeJwtExpiry(value?.accessToken); }
  function isExpiringSoon(value) {
    const expiry = expiryMillis(value);
    return !value?.accessToken || !finite(expiry) || expiry <= clock() + expiryBufferSeconds * 1000;
  }
  async function getSessionStatus() {
    const current = await load();
    return { initialized: Boolean(current?.accessToken || current?.refreshToken), status: current?.status || "NOT_CONFIGURED", expiresAt: expiryMillis(current), expiringSoon: isExpiringSoon(current), refreshing: Boolean(inFlight) };
  }
  async function markReauthenticationRequired() {
    const current = await load() || {};
    await saveSession({ ...current, status: "AUTH_REQUIRED" }, { expectedUpdatedAt: current.updatedAt || null });
  }
  async function refreshSession() {
    if (!refresh) throw new ProviderError(CODES.AUTH_REQUIRED, "Provider refresh is not configured");
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const previous = await load();
      try {
        const replacement = await refresh({ refreshToken: previous?.refreshToken || null });
        const expiresIn = Number(replacement?.expiresIn ?? replacement?.expires_in);
        const accessToken = replacement?.accessToken || replacement?.access_token;
        const refreshToken = replacement?.refreshToken || replacement?.refresh_token || previous?.refreshToken || null;
        if (typeof accessToken !== "string" || !accessToken.trim()) throw new ProviderError(CODES.BAD_RESPONSE, "Provider refresh did not return an access token");
        if (!finite(expiresIn) || expiresIn <= 0) throw new ProviderError(CODES.BAD_RESPONSE, "Provider refresh returned an invalid expiry");
        if (refreshToken !== null && (typeof refreshToken !== "string" || !refreshToken.trim())) throw new ProviderError(CODES.BAD_RESPONSE, "Provider refresh returned an invalid refresh token");
        const next = { accessToken, refreshToken, accessExpiresAt: clock() + expiresIn * 1000, status: "READY" };
        await saveSession(next, { expectedUpdatedAt: previous?.updatedAt || null });
        return next.accessToken;
      } catch (error) {
        if (error?.code === 401 || error?.code === 403 || error?.code === CODES.AUTH_REQUIRED) {
          await markReauthenticationRequired();
          throw new ProviderError(CODES.AUTH_REQUIRED, "Provider reauthentication is required");
        }
        if (error?.code === CODES.TIMEOUT) throw error;
        throw error instanceof ProviderError ? error : new ProviderError(CODES.UNAVAILABLE, "Provider refresh is temporarily unavailable");
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function getValidAccessToken() {
    const current = await load();
    if (!isExpiringSoon(current)) return current.accessToken;
    return refreshSession();
  }
  const getAccessToken = getValidAccessToken;
  return {
    getValidAccessToken, getAccessToken, isExpiringSoon: async () => isExpiringSoon(await load()), refreshSession, saveSession, clearSession, getSessionStatus, markReauthenticationRequired,
    load, save: saveSession, ensureValidSession: getAccessToken, markAuthRequired: markReauthenticationRequired, getStatus: async () => (await getSessionStatus()).status,
    hasUsableAccess: (value) => !isExpiringSoon(value), logger,
  };
}

function createIndriveProvider({ config = CONFIG, sessionManager, transport } = {}) {
  const session = sessionManager || createSessionManager({
    initialSession: { accessToken: config.accessToken || "", refreshToken: config.refreshToken || "" },
    refresh: transport?.refreshSession,
  });
  const mockSuggestions = [{ id: "fixture-location-1", title: "Lahore General Hospital", address: "Lahore, Pakistan", latitude: 31.45, longitude: 74.35, source: "indrive-mock" }];
  const mockRoute = { distanceMeters: 9301, durationSeconds: 1139, encodedPolyline: null };
  const liveTransportEnabled = Boolean(transport && config.mode === "authorized-live");

  async function call(name, payload, fallback) {
    const id = requestId();
    try {
      if (transport?.[name]) return { ...await transport[name](payload), requestId: id };
      return { ...await fallback(payload), requestId: id };
    } catch (error) { return { ...normalizeError(error, id), error: true }; }
  }
  async function getSuggestions({ text, latitude, longitude, sessionId } = {}) {
    if (!String(text || "").trim()) return { ...normalizeError(new ProviderError(CODES.INVALID_REQUEST, "search text is required"), requestId()), suggestions: [] };
    if (latitude !== undefined) coordinate(latitude, "latitude", -90, 90);
    if (longitude !== undefined) coordinate(longitude, "longitude", -180, 180);
    return call("getSuggestions", { text: String(text).trim(), latitude, longitude, sessionId }, async () => ({ provider: config.id, status: STATUS.AVAILABLE, suggestions: mockSuggestions }));
  }
  async function getRoute({ pickup, destination } = {}) {
    const normalizedPickup = location(pickup, "pickup");
    const normalizedDestination = location(destination, "destination");
    return call("getRoute", { pickup: normalizedPickup, destination: normalizedDestination }, async () => ({ provider: config.id, status: STATUS.AVAILABLE, route: mockRoute }));
  }
  async function getFareEstimates({ pickup, destination, route } = {}) {
    location(pickup, "pickup"); location(destination, "destination");
    const distanceMeters = Number(route?.distanceMeters); const durationSeconds = Number(route?.durationSeconds);
    if (!finite(distanceMeters) || distanceMeters <= 0 || !finite(durationSeconds) || durationSeconds <= 0) throw new ProviderError(CODES.INVALID_REQUEST, "route distance and duration are required");
    if (!liveTransportEnabled || typeof transport.getFareEstimates !== "function") {
      return {
        provider: config.id,
        status: STATUS.UNAVAILABLE,
        source: "none",
        currency: config.currency,
        estimates: [],
        error: { code: "LIVE_INTEGRATION_NOT_CONFIGURED", message: "Live fare data is currently unavailable." },
        requestId: requestId(),
      };
    }
    const response = await call("getFareEstimates", { pickup, destination, route: { distanceMeters, durationSeconds } });
    if (response.status !== STATUS.AVAILABLE) return { ...response, source: "none", estimates: [] };
    if (response.expiresAt && Number.isFinite(Date.parse(response.expiresAt)) && Date.parse(response.expiresAt) <= Date.now()) {
      return { provider: config.id, status: STATUS.UNAVAILABLE, source: "none", currency: config.currency, estimates: [], error: { code: "STALE_PROVIDER_RESPONSE", message: "Live fare data is currently unavailable." }, requestId: response.requestId };
    }
    const estimates = Array.isArray(response.estimates)
      ? response.estimates.map((estimate) => normalizeLiveEstimate(estimate, response.currency, Number(config.currencyMultiplier) > 0 ? Number(config.currencyMultiplier) : 1)).filter(Boolean)
      : [];
    if (estimates.length === 0 || !response.currency) {
      return { provider: config.id, status: STATUS.PROVIDER_ERROR, source: "none", currency: config.currency, estimates: [], error: { code: CODES.BAD_RESPONSE, message: "Live provider returned no valid fare estimates." }, requestId: response.requestId };
    }
    return { ...response, status: STATUS.AVAILABLE, source: "live", estimates };
  }
  async function getNearbyDrivers({ latitude, longitude, rideType } = {}) {
    coordinate(latitude, "latitude", -90, 90); coordinate(longitude, "longitude", -180, 180);
    return call("getNearbyDrivers", { latitude, longitude, rideType }, async () => ({ provider: config.id, status: STATUS.UNAVAILABLE, code: "MOCK_ONLY", drivers: [], message: "Live driver availability is not queried" }));
  }
  async function getProviderStatus() {
    return { provider: config.id, displayName: config.displayName, mode: config.mode, status: liveTransportEnabled ? STATUS.AVAILABLE : STATUS.UNAVAILABLE, liveTransportEnabled, session: await session.getSessionStatus() };
  }
  async function getQuotes() {
    const error = new ProviderError("LIVE_INTEGRATION_NOT_CONFIGURED", "Live fare data is currently unavailable.");
    throw error;
  }
  return { id: config.id, name: config.id, displayName: config.displayName, mode: config.mode, liveTransportEnabled, config, session, getSuggestions, getRoute, getFareEstimates, getNearbyDrivers, getProviderStatus, getStatus: async () => liveTransportEnabled ? "READY" : "NOT_CONFIGURED", getQuotes };
}

module.exports = createIndriveProvider();
module.exports.CONFIG = CONFIG;
module.exports.STATUS = STATUS;
module.exports.CODES = CODES;
module.exports.ProviderError = ProviderError;
module.exports.createSessionManager = createSessionManager;
module.exports.createIndriveProvider = createIndriveProvider;
module.exports.normalizeLiveEstimate = normalizeLiveEstimate;
module.exports.decodeJwtExpiry = decodeJwtExpiry;
