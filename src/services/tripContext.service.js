const { extractTripLocations } = require("./tripExtraction.service");

const VEHICLE_ALIASES = [
  { type: "bike", pattern: /\b(?:bike|bicycle|motorbike|motorcycle|scooty|scooter)\b/i },
  { type: "rickshaw", pattern: /\b(?:rickshaw|riksaw|qinqi)\b/i },
  { type: "car", pattern: /\b(?:car|sedan|auto)\b/i },
];

function detectVehiclePreference(message) {
  const text = String(message || "");
  return VEHICLE_ALIASES.find((item) => item.pattern.test(text))?.type || null;
}

function detectIntent(message) {
  const text = String(message || "").toLowerCase();
  if (/(?:cheapest|cheaper|sasti|sasta|compare|comparison|versus|\bvs\b|kitna|fare|price|cost|mehngi)/.test(text)) return "fare_comparison";
  if (/(?:rain|barish|fog|dhund|safe|safety|weather)/.test(text)) return "safety_weather";
  if (/(?:morning|evening|office|friday|timing|time|rush|surge|event|protest)/.test(text)) return "travel_conditions";
  if (/(?:book|booking|wait|intezar)/.test(text)) return "book_wait";
  if (/(?:change|switch|update)\s+(?:the\s+)?(?:pickup|destination)|\bfrom\b.+\bto\b|\b.+\s+se\s+.+\s+(?:jana|jaana|go|going|travel)\b|\bto\b.+\bfrom\b/.test(text)) return "trip_planning";
  if (/(?:how do|help|use fair fare|app|account|login|register)/.test(text)) return "app_help";
  return "general_assistant";
}

function completeTripFromHistory(current, recentMessages) {
  // An explicit rejection means the old endpoint is no longer valid. Do not
  // silently complete this correction with stale conversation state.
  if (current?.rejected) return null;
  const users = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((item) => item?.role === "USER")
    .map((item) => extractTripLocations(item.content));
  const previous = [...users].reverse().find((trip) => trip.pickup && trip.destination);
  if (!previous) return null;
  return {
    pickup: current.pickup || previous.pickup,
    destination: current.destination || previous.destination,
    pattern: current.pattern || "conversation_context",
  };
}

async function buildConversationTripContext({ message, recentMessages = [], tripResolver }) {
  const current = extractTripLocations(message);
  const complete = current.pickup && current.destination ? current : completeTripFromHistory(current, recentMessages);
  const vehiclePreference = detectVehiclePreference(message);
  const intent = detectIntent(message);
  if (!complete || typeof tripResolver !== "function") {
    if (current.rejected && current.pickup) {
      return { status: "UNRESOLVED", extracted: current, unresolved: "destination", vehiclePreference, intent, pendingClarification: "destination", source: "current_message" };
    }
    return { status: "NO_TRIP", extracted: current, vehiclePreference, intent, pendingClarification: null, source: "none" };
  }
  const trip = await tripResolver({ message: `from ${complete.pickup} to ${complete.destination}` });
  return {
    ...trip,
    extracted: { ...trip.extracted, pickup: complete.pickup, destination: complete.destination, pattern: complete.pattern },
    vehiclePreference,
    intent,
    source: current.pickup || current.destination ? "current_message" : "conversation_history",
    pendingClarification: trip.status === "UNRESOLVED" ? trip.unresolved || "location" : null,
  };
}

function publicTripContext(trip) {
  if (!trip || trip.status === "NO_TRIP") return null;
  const location = (item) => item ? {
    query: item.query || null,
    name: item.name || null,
    placeId: item.placeId || null,
    city: item.city || null,
    county: item.county || null,
    state: item.state || null,
    lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
    lng: Number.isFinite(Number(item.lng)) ? Number(item.lng) : null,
    approximate: item.approximate === true,
  } : null;
  return {
    status: trip.status,
    intent: trip.intent || null,
    source: trip.source || null,
    pickup: location(trip.pickup),
    destination: location(trip.destination),
    city: trip.city || null,
    cityMismatch: trip.cityMismatch === true,
    vehiclePreference: trip.vehiclePreference || null,
    pendingClarification: trip.pendingClarification || null,
    route: trip.route ? {
      distanceMeters: trip.route.distanceMeters ?? null,
      durationSeconds: trip.route.durationSeconds ?? null,
      unavailable: trip.route.unavailable === true,
      compareFaresEligible: trip.route.compareFaresEligible,
      eligibilityReason: trip.route.eligibilityReason || null,
    } : null,
  };
}

module.exports = { detectVehiclePreference, detectIntent, completeTripFromHistory, buildConversationTripContext, publicTripContext };
