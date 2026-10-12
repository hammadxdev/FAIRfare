const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const {
  validateAutocompleteQuery,
  validatePlaceDetailsQuery,
  validateReverseGeocodeQuery,
  validateRouteRequest,
} = require("../utils/validators");
const mapsService = require("../services/maps");
const mapUsageService = require("../services/mapUsage.service");
const { decodePolyline, validateRouteCoordinates } = require("../services/polyline.service");
const {
  autocompleteCache,
  placeDetailsCache,
  reverseGeocodeCache,
  routeCache,
} = require("../services/cache.service");

const MIN_AUTOCOMPLETE_LENGTH = 3;

function logMapRequest(endpoint, meta) {
  console.log(`[maps] ${endpoint}`, { ...meta, at: new Date().toISOString() });
}

function assertUnderDailyLimit(requiredRequests = 1) {
  const usage = mapUsageService.getUsageSummary();
  if (usage.totalMapRequests + requiredRequests > usage.dailyLimit) {
    throw new AppError("Daily map provider request limit reached for demo safety.", 429);
  }
}

const autocompleteHandler = asyncHandler(async (req, res) => {
  const { input = "", sessionToken } = req.query;

  // Backend re-validates the 3-character minimum even though the frontend
  // already debounces/gates this — never trust the client alone.
  if (input.trim().length < MIN_AUTOCOMPLETE_LENGTH) {
    return success(res, { data: [] });
  }

  const errors = validateAutocompleteQuery(req.query);
  if (errors.length > 0) {
    throw new AppError("Validation failed", 400, errors);
  }

  const lat = req.query.lat === undefined || req.query.lat === "" ? null : Number(req.query.lat);
  const lng = req.query.lng === undefined || req.query.lng === "" ? null : Number(req.query.lng);
  const locationKey = lat == null ? "none" : `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cacheKey = `${input.trim().toLowerCase()}::${locationKey}`;
  const cached = autocompleteCache.get(cacheKey);
  if (cached) {
    logMapRequest("autocomplete", { queryLength: input.trim().length, cache: "hit" });
    return success(res, { data: cached });
  }

  assertUnderDailyLimit();

  const data = await mapsService.fetchAutocomplete({ input: input.trim(), sessionToken, lat, lng });
  mapUsageService.recordRequest("autocompleteRequests");
  autocompleteCache.set(cacheKey, data);
  logMapRequest("autocomplete", { queryLength: input.trim().length, cache: "miss" });

  return success(res, { data });
});

const placeDetailsHandler = asyncHandler(async (req, res) => {
  const { placeId, sessionToken } = req.query;

  const errors = validatePlaceDetailsQuery(req.query);
  if (errors.length > 0) {
    throw new AppError("Validation failed", 400, errors);
  }

  const cacheKey = placeId;
  const cached = placeDetailsCache.get(cacheKey);
  if (cached) {
    logMapRequest("place-details", { cache: "hit" });
    return success(res, { data: cached });
  }

  assertUnderDailyLimit();

  const data = await mapsService.fetchPlaceDetails({ placeId, sessionToken });
  mapUsageService.recordRequest("placeDetailsRequests");
  placeDetailsCache.set(cacheKey, data);
  logMapRequest("place-details", { cache: "miss" });

  return success(res, { data });
});

const reverseGeocodeHandler = asyncHandler(async (req, res) => {
  const errors = validateReverseGeocodeQuery(req.query);
  if (errors.length > 0) {
    throw new AppError("Validation failed", 400, errors);
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  // Round to ~1.1m precision so nearby taps reuse the same cache entry.
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) {
    logMapRequest("reverse-geocode", { cache: "hit" });
    return success(res, { data: cached });
  }

  assertUnderDailyLimit();

  const data = await mapsService.fetchReverseGeocode({ lat, lng });
  mapUsageService.recordRequest("reverseGeocodeRequests");
  reverseGeocodeCache.set(cacheKey, data);
  logMapRequest("reverse-geocode", { cache: "miss" });

  return success(res, { data });
});

const routeHandler = asyncHandler(async (req, res) => {
  const errors = validateRouteRequest(req.body);
  if (errors.length > 0) {
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
      console.warn("[maps] route validation failed", { fields: errors.map((error) => error.split(" ")[0]) });
    }
    throw new AppError("Validation failed", 400, errors);
  }

  const { origin, destination, vehicleType } = req.body;

  const routingProfile = vehicleType === "bike" ? "motorcycle" : "drive";
  const cacheKey = `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}|${routingProfile}|short`;
  const cached = routeCache.get(cacheKey);
  if (cached) {
    const cachedPoints = Array.isArray(cached.polylineCoordinates) ? cached.polylineCoordinates : decodePolyline(cached.encodedPolyline);
    const cachedValidation = validateRouteCoordinates(cachedPoints, origin, destination, cached.distanceMeters, cached.durationSeconds);
    if (cachedValidation.valid) {
      logMapRequest("route", { vehicleType, cache: "hit" });
      return success(res, { data: { ...cached, polylineCoordinates: cachedPoints } });
    }
    routeCache.delete(cacheKey);
  }

  assertUnderDailyLimit();

  const { distanceMeters, durationSeconds, encodedPolyline } = await mapsService.computeRoute({
    origin,
    destination,
    vehicleType,
  });
  mapUsageService.recordRequest("routeRequests");

  const data = {
    distanceMeters,
    distanceKm: Math.round((distanceMeters / 1000) * 10) / 10,
    durationSeconds,
    durationMin: Math.round(durationSeconds / 60),
    encodedPolyline,
    polylineCoordinates: decodePolyline(encodedPolyline),
  };

  const routeValidation = validateRouteCoordinates(
    data.polylineCoordinates,
    origin,
    destination,
    data.distanceMeters,
    data.durationSeconds
  );
  if (!routeValidation.valid) {
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
      console.warn("[maps] route response rejected", {
        vehicleType,
        reason: routeValidation.reason,
        pointCount: data.polylineCoordinates.length,
        startSnapMeters: routeValidation.startSnapMeters ?? null,
        endSnapMeters: routeValidation.endSnapMeters ?? null,
        toleranceMeters: routeValidation.toleranceMeters ?? null,
      });
    }
    throw new AppError("Route provider returned invalid road geometry.", 502);
  }
  if (!Number.isFinite(data.durationMin) || data.durationMin <= 0) {
    throw new AppError("Route provider returned invalid road duration.", 502);
  }

  routeCache.set(cacheKey, data);
  logMapRequest("route", { vehicleType, cache: "miss" });

  return success(res, { data });
});

const usageHandler = asyncHandler(async (req, res) => {
  return success(res, { data: mapUsageService.getUsageSummary() });
});

module.exports = {
  autocompleteHandler,
  placeDetailsHandler,
  reverseGeocodeHandler,
  routeHandler,
  usageHandler,
};
