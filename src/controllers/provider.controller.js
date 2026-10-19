const { query } = require("../config/postgres");
const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { getProviderStatus, getAdapter } = require("../providers/provider.registry");

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
  const result = await indrive().getNearbyDrivers({ latitude: req.query.latitude ?? req.query.lat, longitude: req.query.longitude ?? req.query.lng, rideType: req.query.rideType });
  return success(res, { data: providerData(result) });
});

const getIndriveStatus = asyncHandler(async (req, res) => success(res, { data: await indrive().getProviderStatus() }));

module.exports = { getProviders, getProviderStatuses, getIndriveSuggestions, getIndriveRoute, getIndriveFares, getIndriveDrivers, getIndriveStatus };
