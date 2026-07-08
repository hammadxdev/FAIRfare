// Thin wrapper around the raw Google Maps Platform HTTP APIs. Every function
// here makes a real network call — callers (map.controller.js) are
// responsible for checking the cache and the daily usage limit first so we
// never hit Google more than necessary.
const AppError = require("../utils/AppError");

// Sialkot, Pakistan — used to bias/locate results so short queries like
// "university" resolve to the right country/city instead of a random match
// worldwide.
const DEFAULT_BIAS_LOCATION = { lat: 32.4945, lng: 74.5229 };
const DEFAULT_BIAS_RADIUS_METERS = 50000;
const DEFAULT_REGION = "pk";

function getApiKey() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your_google_maps_api_key_here") {
    throw new AppError(
      "Google Maps API key is missing. Set GOOGLE_MAPS_API_KEY in backend/.env to enable map features.",
      500
    );
  }
  return apiKey;
}

async function fetchAutocomplete({ input, sessionToken }) {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    input,
    key: apiKey,
    sessiontoken: sessionToken,
    components: `country:${DEFAULT_REGION}`,
    location: `${DEFAULT_BIAS_LOCATION.lat},${DEFAULT_BIAS_LOCATION.lng}`,
    radius: String(DEFAULT_BIAS_RADIUS_METERS),
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`);
  const body = await response.json();

  if (body.status === "REQUEST_DENIED") {
    throw new AppError(
      "Google Places API request denied. Check Places API enablement and API key restrictions.",
      502
    );
  }
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
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

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  const body = await response.json();

  if (body.status === "REQUEST_DENIED") {
    throw new AppError(
      "Google Places API request denied. Check Places API enablement and API key restrictions.",
      502
    );
  }
  if (body.status !== "OK") {
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

  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  const body = await response.json();

  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new AppError(`Google Reverse Geocoding failed: ${body.status}`, 502);
  }

  const result = body.results?.[0];
  if (!result) {
    return { name: "Selected Location", address: "Selected location", lat, lng };
  }

  return {
    name: "Selected Location",
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

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.json();

  if (!response.ok || !body.routes?.length) {
    const message = body.error?.message || "no route found";
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
  getApiKey,
  fetchAutocomplete,
  fetchPlaceDetails,
  fetchReverseGeocode,
  computeRoute,
  getTravelModeForVehicle,
};
