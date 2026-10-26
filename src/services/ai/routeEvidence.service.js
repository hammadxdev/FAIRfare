const { extractTripLocations } = require("../tripExtraction.service");

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:lgu)\b/g, "lahore garrison university")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function locationMatches(query, evidence) {
  const requested = normalize(query);
  const name = normalize(evidence?.name);
  const address = normalize(evidence?.address);
  if (!requested || !name) return false;
  if (/punjab university/.test(requested) && /(?:uet|engineering and technology|kala shah kaku)/.test(`${name} ${address}`)) return false;
  if (/lahore garrison university/.test(requested) && /grammar school|lgs/.test(`${name} ${address}`)) return false;
  const requestedTokens = requested.split(" ").filter((token) => token.length >= 3);
  const searchable = `${name} ${address}`;
  return requestedTokens.length > 0 && requestedTokens.every((token) => searchable.includes(token) || (token === "new" && /campus|quaid/.test(searchable)));
}

function routeEvidenceFromRun(run, now = Date.now(), ttlMs = Number(process.env.FAIRFARE_AI_ROUTE_EVIDENCE_TTL_MS) || DEFAULT_TTL_MS) {
  if (!run || run.status !== "COMPLETED") return null;
  const response = typeof run.response_json === "string" ? safeJson(run.response_json) : run.response_json;
  const execution = typeof run.tool_execution_json === "string" ? safeJson(run.tool_execution_json) : run.tool_execution_json;
  const trip = response?.context?.trip;
  const route = trip?.route;
  const pickup = trip?.pickup;
  const destination = trip?.destination;
  const completedAt = Date.parse(run.completed_at || run.updated_at || "");
  const toolResults = Array.isArray(execution?.results) ? execution.results : Array.isArray(execution) ? execution : [];
  const verifiedToolRoute = toolResults.some((item) => item?.name === "calculate_route" && item?.ok === true && item?.result?.sourceType === "verified_road_route");
  if (!verifiedToolRoute || trip?.status !== "RESOLVED" || !route || route.unavailable === true) return null;
  const pickupPoint = { lat: finiteCoordinate(pickup?.lat, -90, 90), lng: finiteCoordinate(pickup?.lng, -180, 180) };
  const destinationPoint = { lat: finiteCoordinate(destination?.lat, -90, 90), lng: finiteCoordinate(destination?.lng, -180, 180) };
  if (pickupPoint.lat == null || pickupPoint.lng == null || destinationPoint.lat == null || destinationPoint.lng == null) return null;
  if (!(Number(route.distanceMeters) > 0 && Number(route.durationSeconds) > 0)) return null;
  if (!Number.isFinite(completedAt) || now - completedAt < 0 || now - completedAt > Math.max(1000, ttlMs)) return null;
  return {
    source: "verified_road_route",
    completedAt: new Date(completedAt).toISOString(),
    freshness: `${Math.max(0, now - completedAt)}ms_old`,
    routingProfile: "driving",
    pickup: { name: pickup.name || null, address: pickup.query || null, placeId: pickup.placeId || null, ...pickupPoint },
    destination: { name: destination.name || null, address: destination.query || null, placeId: destination.placeId || null, ...destinationPoint },
    route: { distanceMeters: Number(route.distanceMeters), durationSeconds: Number(route.durationSeconds) },
  };
}

function matchRouteEvidence(message, evidence) {
  const extracted = extractTripLocations(message);
  if (!extracted.pickup || !extracted.destination || !evidence) return false;
  return locationMatches(extracted.pickup, evidence.pickup) && locationMatches(extracted.destination, evidence.destination);
}

function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }

module.exports = { routeEvidenceFromRun, matchRouteEvidence, locationMatches, normalize };
