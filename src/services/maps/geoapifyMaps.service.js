const AppError = require("../../utils/AppError");

const BASE_URL = "https://api.geoapify.com";
const REQUEST_TIMEOUT_MS = 10000;
const COUNTRY_FILTER = "countrycode:pk";
const PLACES_RADIUS_METERS = 25000;
const PLACES_LIMIT = 10;
const PLACES_CATEGORIES = [
  "commercial",
  "catering",
  "accommodation",
  "activity",
  "entertainment",
  "service",
].join(",");

function isValidLatitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function getApiKey() {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey || apiKey === "your_geoapify_api_key_here") {
    throw new AppError("Geoapify map services are not configured.", 500);
  }
  return apiKey;
}

function safeProviderMessage(body, fallback) {
  const message = body?.message || body?.error || body?.error_message;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 240) : fallback;
}

async function requestGeoapify(path, params, operation) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries({ ...params, apiKey: getApiKey() })) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let body;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    body = await response.json().catch(() => ({}));
  } catch (error) {
    if (error?.name === "AbortError") throw new AppError(`Geoapify ${operation} timed out.`, 504);
    throw new AppError(`Geoapify ${operation} is unavailable.`, 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AppError(`Geoapify ${operation} failed: ${safeProviderMessage(body, `HTTP ${response.status}`)}`, 502);
  }
  if (body?.error) {
    throw new AppError(`Geoapify ${operation} failed: ${safeProviderMessage(body, "provider error")}`, 502);
  }
  return body;
}

function normalizeFeature(feature) {
  const properties = feature?.properties || {};
  const lat = Number(properties.lat);
  const lng = Number(properties.lon);
  return {
    placeId: properties.place_id || null,
    description: properties.formatted || properties.address_line1 || properties.name || "",
    mainText: properties.name || properties.address_line1 || properties.formatted || "",
    secondaryText: properties.address_line2 || [properties.city, properties.state, properties.country].filter(Boolean).join(", "),
    address: properties.formatted || properties.address_line2 || properties.address_line1 || "",
    city: properties.city || properties.town || properties.municipality || "",
    locality: properties.suburb || properties.district || properties.neighbourhood || properties.city || "",
    distanceMeters: Number.isFinite(Number(properties.distance)) ? Number(properties.distance) : null,
    source: "geoapify-geocoder",
    lat: isValidLatitude(lat) ? lat : null,
    lng: isValidLongitude(lng) ? lng : null,
  };
}

function assertCoordinates(lat, lng) {
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    throw new AppError("Invalid coordinates for Geoapify map request.", 400);
  }
}

async function fetchAutocomplete({ input, sessionToken: _sessionToken, lat = null, lng = null }) {
  const params = { text: input, filter: COUNTRY_FILTER, limit: 5 };
  if (isValidLatitude(lat) && isValidLongitude(lng)) params.bias = `proximity:${lng},${lat}`;
  const body = await requestGeoapify("/v1/geocode/autocomplete", params, "autocomplete");
  return (body.features || [])
    .map(normalizeFeature)
    .filter((item) => item.description && item.lat !== null && item.lng !== null);
}

function haversineMeters(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function searchText(value) {
  return String(value || "").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchRelevance(item, input) {
  const query = searchText(input);
  const name = searchText(item.name || item.mainText || item.description);
  const address = searchText(item.address || item.secondaryText);
  if (!query) return 0;
  if (name === query) return 1000;
  if (name.startsWith(query)) return 800;
  if (name.includes(query)) return 650;
  if (address.includes(query)) return 250;
  return 0;
}

function normalizePlaceFeature(feature) {
  const normalized = normalizeFeature(feature);
  return {
    ...normalized,
    description: normalized.address || normalized.mainText,
    mainText: normalized.mainText || normalized.address,
    secondaryText: normalized.address,
    source: "geoapify-places",
  };
}

async function fetchNearbyNamedPlaces({ input, lat, lng }) {
  const body = await requestGeoapify("/v2/places", {
    categories: PLACES_CATEGORIES,
    name: input,
    filter: `circle:${lng},${lat},${PLACES_RADIUS_METERS}`,
    bias: `proximity:${lng},${lat}`,
    limit: PLACES_LIMIT,
    lang: "en",
  }, "places search");
  return (body.features || [])
    .map(normalizePlaceFeature)
    .filter((item) => item.mainText && item.lat !== null && item.lng !== null);
}

function mergeSearchResults(items, input, coordinates = {}) {
  const results = [];
  for (const item of items) {
    const distanceMeters = haversineMeters(coordinates, item) ?? item.distanceMeters;
    const normalizedName = searchText(item.mainText || item.name || item.description);
    const nearDuplicate = results.some((existing) => {
      const sameProviderId = item.placeId && existing.placeId && item.placeId === existing.placeId;
      const sameNamedPoint = normalizedName && normalizedName === searchText(existing.mainText || existing.name) && distanceMeters != null && existing.distanceMeters != null && Math.abs(distanceMeters - existing.distanceMeters) < 30;
      return sameProviderId || sameNamedPoint;
    });
    if (nearDuplicate) continue;
    results.push({
      ...item,
      name: item.mainText || item.name || item.description,
      primaryLabel: item.mainText || item.name || item.description,
      secondaryAddress: item.secondaryText || item.address || "",
      city: item.city || item.locality || "",
      locality: item.locality || item.city || "",
      latitude: item.lat,
      longitude: item.lng,
      distanceMeters,
      distanceKm: distanceMeters == null ? null : Math.round((distanceMeters / 1000) * 10) / 10,
      relevanceScore: searchRelevance(item, input),
    });
  }
  return results
    .sort((a, b) => b.relevanceScore - a.relevanceScore || (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY))
    .slice(0, 10)
    .map(({ relevanceScore, distanceMeters, ...item }) => ({ ...item, distanceMeters, distanceKm: item.distanceKm }));
}

async function fetchPlaceDetails({ placeId }) {
  if (!placeId || typeof placeId !== "string") throw new AppError("placeId is required", 400);
  const body = await requestGeoapify("/v2/place-details", { id: placeId }, "place details");
  const feature = body.features?.[0];
  if (!feature) throw new AppError("Geoapify place details returned no result.", 404);
  const normalized = normalizeFeature(feature);
  if (normalized.lat === null || normalized.lng === null) throw new AppError("Geoapify place details returned invalid coordinates.", 502);
  return {
    placeId: normalized.placeId || placeId,
    name: normalized.mainText || normalized.address,
    address: normalized.address,
    lat: normalized.lat,
    lng: normalized.lng,
  };
}

async function fetchReverseGeocode({ lat, lng }) {
  assertCoordinates(lat, lng);
  const body = await requestGeoapify("/v1/geocode/reverse", { lat, lon: lng }, "reverse geocoding");
  const feature = body.features?.[0];
  if (!feature) return { name: null, address: null, lat, lng };
  const normalized = normalizeFeature(feature);
  return { name: normalized.mainText || normalized.address, address: normalized.address, lat, lng };
}

function travelModeForVehicle(vehicleType) {
  return vehicleType === "bike" ? "motorcycle" : "drive";
}

function routeCoordinates(geometry) {
  if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) return [];
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  return lines.flat().filter((point) => Array.isArray(point) && point.length >= 2 && isValidLongitude(Number(point[0])) && isValidLatitude(Number(point[1])))
    .map(([lng, lat]) => ({ latitude: Number(lat), longitude: Number(lng) }));
}

function encodeCoordinate(value) {
  let current = Math.round(value * 1e5);
  current = current < 0 ? ~(current << 1) : current << 1;
  let encoded = "";
  while (current >= 0x20) {
    encoded += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
    current >>= 5;
  }
  return encoded + String.fromCharCode(current + 63);
}

function encodePolyline(coordinates) {
  let previousLat = 0;
  let previousLng = 0;
  return coordinates.map(({ latitude, longitude }) => {
    const lat = Math.round(latitude * 1e5);
    const lng = Math.round(longitude * 1e5);
    const encoded = encodeCoordinate(lat - previousLat) + encodeCoordinate(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
    return encoded;
  }).join("");
}

async function computeRoute({ origin, destination, vehicleType }) {
  assertCoordinates(origin?.lat, origin?.lng);
  assertCoordinates(destination?.lat, destination?.lng);
  const body = await requestGeoapify("/v1/routing", {
    waypoints: `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`,
    mode: travelModeForVehicle(vehicleType),
    type: "short",
    format: "geojson",
  }, "routing");
  const feature = body.features?.[0];
  const coordinates = routeCoordinates(feature?.geometry);
  const distanceMeters = Number(feature?.properties?.distance);
  const durationSeconds = Number(feature?.properties?.time);
  if (!feature || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || coordinates.length < 2) {
    throw new AppError("Geoapify routing returned no usable road route.", 502);
  }
  return { distanceMeters, durationSeconds, encodedPolyline: encodePolyline(coordinates) };
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  getApiKey,
  fetchAutocomplete,
  fetchPlaceDetails,
  fetchReverseGeocode,
  computeRoute,
  normalizeFeature,
  routeCoordinates,
  encodePolyline,
  travelModeForVehicle,
  fetchNearbyNamedPlaces,
  mergeSearchResults,
};
