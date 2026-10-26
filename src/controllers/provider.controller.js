const { query } = require("../config/postgres");
const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { getProviderStatus, getAdapter } = require("../providers/provider.registry");
const { persistNearbyProviderObservation } = require("../services/nearbyObservation.service");

const nearbyPersistenceLogTimes = new Map();
const NEARBY_PERSISTENCE_LOG_INTERVAL_MS = 60_000;

function logNearbyPersistenceFailure(provider, error, stage = "insert") {
  const safeProvider = ["indrive", "yango", "bykea"].includes(provider) ? provider : "unknown";
  const safeStage = ["cleanup", "insert"].includes(stage) ? stage : "persistence";
  const safeCode = typeof error?.code === "string" && (/^[0-9A-Z]{5}$/.test(error.code) || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(error.code)) ? error.code : "DATABASE_ERROR";
  const key = `${safeProvider}:${safeStage}:${safeCode}`;
  const now = Date.now();
  if (now - (nearbyPersistenceLogTimes.get(key) || 0) < NEARBY_PERSISTENCE_LOG_INTERVAL_MS) return;
  if (!nearbyPersistenceLogTimes.has(key) && nearbyPersistenceLogTimes.size >= 32) nearbyPersistenceLogTimes.delete(nearbyPersistenceLogTimes.keys().next().value);
  nearbyPersistenceLogTimes.set(key, now);
  console.warn("[nearby-observation] persistence failed", { provider: safeProvider, stage: safeStage, code: safeCode });
}

const getProviders = asyncHandler(async (req, res) => {
  // Prepared fresh per request rather than once at module load — see the
  // comment in app.js's readiness middleware for why a module-load-time
  // prepared statement isn't safe to trust on this platform.
  const providers = (await query(`SELECT id, name, display_name, logo_url, deep_link_url FROM providers WHERE is_active = true ORDER BY id`)).rows
    .map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.display_name,
      logoUrl: p.logo_url,
      deepLinkUrl: p.deep_link_url,
    }));

  return success(res, { message: "Providers fetched successfully", data: providers });
});

const getProviderStatuses = asyncHandler(async (req, res) => {
  return success(res, { message: "Provider statuses fetched successfully", data: { providers: await getProviderStatus() } });
});

const indrive = () => getAdapter("indrive");
const providerData = (result) => ({ provider: "indrive", ...result });
function persistNearbyInBackground(provider, query, result, requestStartedAt, receivedAt) {
  const latitude = Number(query.latitude ?? query.lat);
  const longitude = Number(query.longitude ?? query.lng);
  setImmediate(() => {
    persistNearbyProviderObservation({ provider, latitude, longitude, result, requestStartedAt, receivedAt, onPersistenceDiagnostic: (error, stage) => logNearbyPersistenceFailure(provider, error, stage) })
      .catch((error) => logNearbyPersistenceFailure(provider, error, "insert")); // Best-effort and detached from provider response.
  });
}

const getIndriveSuggestions = asyncHandler(async (req, res) => {
  const result = await indrive().getSuggestions({ text: req.query.text || req.query.input, latitude: req.query.latitude ?? req.query.lat, longitude: req.query.longitude ?? req.query.lng, sessionId: req.query.sessionId || req.query.sessionToken });
  return success(res, { data: providerData(result) });
});

const getIndriveRoute = asyncHandler(async (req, res) => {
  const result = await indrive().getRoute({ pickup: req.body?.pickup, destination: req.body?.destination });
  return success(res, { data: providerData(result) });
});

const getIndriveFares = asyncHandler(async (req, res) => {
  const result = await indrive().getFareEstimates(req.body || {});
  return success(res, { data: providerData(result) });
});

const getIndriveDrivers = asyncHandler(async (req, res) => {
  const requestStartedAt = new Date().toISOString();
  const result = await indrive().getNearbyDrivers({ latitude: req.query.latitude ?? req.query.lat, longitude: req.query.longitude ?? req.query.lng, rideType: req.query.rideType });
  const receivedAt = new Date().toISOString();
  persistNearbyInBackground("indrive", req.query, result, requestStartedAt, receivedAt);
  return success(res, { data: { ...providerData(result), requestStartedAt, receivedAt } });
});

const yango = () => getAdapter("quickride");
const getYangoDrivers = asyncHandler(async (req, res) => {
  const requestStartedAt = new Date().toISOString();
  const result = await yango().getNearbyDrivers({
    latitude: req.query.latitude ?? req.query.lat,
    longitude: req.query.longitude ?? req.query.lng,
    rideType: req.query.rideType,
  });
  if (result.status === "invalid_request") return res.status(400).json({ success: false, message: result.error?.message || "Invalid nearby request", data: { provider: "yango", ...result } });
  const receivedAt = new Date().toISOString();
  persistNearbyInBackground("yango", req.query, { ...result, requestedCategory: String(req.query.rideType || "").toLowerCase() }, requestStartedAt, receivedAt);
  return success(res, { data: { provider: "yango", ...result, requestStartedAt, receivedAt } });
});

const bykea = () => getAdapter("urbancab");
const getBykeaDrivers = asyncHandler(async (req, res) => {
  const requestStartedAt = new Date().toISOString();
  const result = await bykea().getNearbyDrivers({
    latitude: req.query.latitude ?? req.query.lat,
    longitude: req.query.longitude ?? req.query.lng,
    serviceCode: req.query.serviceCode ?? req.query.service_code,
  });
  if (result.status === "invalid_request") return res.status(400).json({ success: false, message: result.error?.message || "Invalid nearby request", data: { provider: "bykea", ...result } });
  const receivedAt = new Date().toISOString();
  persistNearbyInBackground("bykea", req.query, result, requestStartedAt, receivedAt);
  return success(res, { data: { provider: "bykea", ...result, requestStartedAt, receivedAt } });
});

const getIndriveStatus = asyncHandler(async (req, res) => success(res, { data: await indrive().getProviderStatus() }));

module.exports = { getProviders, getProviderStatuses, getIndriveSuggestions, getIndriveRoute, getIndriveFares, getIndriveDrivers, getIndriveStatus, getBykeaDrivers, getYangoDrivers };
