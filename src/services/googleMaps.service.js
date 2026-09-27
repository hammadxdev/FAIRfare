// Thin wrapper around the raw Google Maps Platform HTTP APIs. Every function
// here makes a real network call — callers (map.controller.js) are
// responsible for checking the cache and the daily usage limit first so we
// never hit Google more than necessary.
const AppError = require("../utils/AppError");

const DEFAULT_REGION = "pk";

function classifyMapsFailure({ body, response, error } = {}) {
  const networkCode = error?.code || error?.cause?.code;
  if (networkCode === "EACCES" || networkCode === "ENETUNREACH" || networkCode === "ECONNREFUSED" || networkCode === "ETIMEDOUT" || error?.message === "fetch failed") return "MAPS_NETWORK_ERROR";
  const status = body?.status || body?.error?.status;
  if (status === "REQUEST_DENIED" || response?.status === 401 || response?.status === 403) return "MAPS_UPSTREAM_DENIED";
  if (status === "OVER_QUERY_LIMIT" || response?.status === 429) return "MAPS_QUOTA_ERROR";
  if (status === "INVALID_REQUEST" || response?.status === 400) return "MAPS_INVALID_REQUEST";
  if (status === "ZERO_RESULTS") return "MAPS_NO_RESULTS";
  return "MAPS_UPSTREAM_ERROR";
}

function logGoogleFailure(apiName, { response, body, error } = {}) {
  if (process.env.NODE_ENV === "production") return;

  const reason = body?.error_message || body?.error?.message || error?.message || error?.code || "unknown upstream error";
  const googleStatus = body?.status || body?.error?.status || null;
  console.error(`[maps] ${apiName} upstream failure`, {
    classification: classifyMapsFailure({ response, body, error }),
    httpStatus: response?.status || null,
    googleStatus,
    reason: String(reason).slice(0, 300),
  });
}

function getApiKey() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your_google_maps_api_key_here") {
    if (process.env.NODE_ENV !== "production") console.error("[maps] configuration failure", { classification: "MAPS_CONFIG_ERROR" });
    throw new AppError(
      "Google Maps API key is missing. Set GOOGLE_MAPS_API_KEY in backend/.env to enable map features.",
      500
    );
  }
  return apiKey;
}

async function fetchAutocomplete({ input, sessionToken, lat = null, lng = null }) {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    input,
    key: apiKey,
    sessiontoken: sessionToken,
    components: `country:${DEFAULT_REGION}`,
  });
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    params.set("location", `${lat},${lng}`);
    params.set("radius", "50000");
  }

  let response;
  let body;
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`);
    body = await response.json();
  } catch (error) {
    logGoogleFailure("Places Autocomplete", { response, error });
    throw error;
  }

  if (body.status === "REQUEST_DENIED") {
    logGoogleFailure("Places Autocomplete", { response, body });
    throw new AppError(
      "Google Places API request denied. Check Places API enablement and API key restrictions.",
      502
    );
  }
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    logGoogleFailure("Places Autocomplete", { response, body });
    throw new AppError(`Google Places Autocomplete failed: ${body.status}`, 502);
  }

  const predictions = body.predictions || [];
  return predictions.map((prediction) => ({
    placeId: prediction.place_id,
    description: prediction.description,
    mainText: prediction.structured_formatting?.main_text || prediction.description,
    secondaryText: prediction.structured_formatting?.secondary_text || "",
  }));
}

async function fetchPlaceDetails({ placeId, sessionToken }) {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    place_id: placeId,
    key: apiKey,
    sessiontoken: sessionToken,
    fields: "place_id,name,formatted_address,geometry/location",
  });

  let response;
  let body;
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    body = await response.json();
  } catch (error) {
    logGoogleFailure("Place Details", { response, error });
    throw error;
  }

  if (body.status === "REQUEST_DENIED") {
    logGoogleFailure("Place Details", { response, body });
    throw new AppError(
      "Google Places API request denied. Check Places API enablement and API key restrictions.",
      502
    );
  }
  if (body.status !== "OK") {
    logGoogleFailure("Place Details", { response, body });
    throw new AppError(`Google Place Details failed: ${body.status}`, 502);
  }

  const result = body.result;
  return {
    placeId: result.place_id,
    name: result.name,
    address: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
  };
}

async function fetchReverseGeocode({ lat, lng }) {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: apiKey,
  });

  let response;
  let body;
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    body = await response.json();
  } catch (error) {
    logGoogleFailure("Reverse Geocoding", { response, error });
    throw error;
  }

  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    logGoogleFailure("Reverse Geocoding", { response, body });
    throw new AppError(`Google Reverse Geocoding failed: ${body.status}`, 502);
  }

  const result = body.results?.[0];
  if (!result) {
    return { name: null, address: null, lat, lng };
  }

  const readableName = result.address_components?.find((component) =>
    component.types?.some((type) => ["point_of_interest", "establishment", "premise", "route", "locality", "sublocality"].includes(type)),
  )?.long_name || result.formatted_address;

  return {
    name: readableName,
    address: result.formatted_address,
    lat,
    lng,
  };
}

// bike = TWO_WHEELER where supported, otherwise DRIVE. car/mini/rickshaw = DRIVE.
function getTravelModeForVehicle(vehicleType) {
  return vehicleType === "bike" ? "TWO_WHEELER" : "DRIVE";
}

async function computeRouteWithTravelMode({ origin, destination, travelMode }) {
  const apiKey = getApiKey();

  const requestBody = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode,
    routingPreference: travelMode === "TWO_WHEELER" ? "TRAFFIC_UNAWARE" : "TRAFFIC_AWARE",
  };

  let response;
  let body;
  try {
    response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(requestBody),
    });

    body = await response.json();
  } catch (error) {
    logGoogleFailure("Routes", { response, error });
    throw error;
  }

  if (!response.ok || !body.routes?.length) {
    const message = body.error?.message || "no route found";
    logGoogleFailure("Routes", { response, body });
    throw new AppError(`Google Routes API failed: ${message}`, 502);
  }

  const route = body.routes[0];
  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: Number(String(route.duration).replace("s", "")),
    encodedPolyline: route.polyline?.encodedPolyline || "",
  };
}

// bike prefers TWO_WHEELER but that mode is only supported in a handful of
// regions — silently retry with DRIVE rather than failing the whole request.
async function computeRoute({ origin, destination, vehicleType }) {
  const travelMode = getTravelModeForVehicle(vehicleType);

  try {
    return await computeRouteWithTravelMode({ origin, destination, travelMode });
  } catch (err) {
    if (travelMode === "TWO_WHEELER") {
      return computeRouteWithTravelMode({ origin, destination, travelMode: "DRIVE" });
    }
    throw err;
  }
}

module.exports = {
  classifyMapsFailure,
  getApiKey,
  fetchAutocomplete,
  fetchPlaceDetails,
  fetchReverseGeocode,
  computeRoute,
  getTravelModeForVehicle,
};
