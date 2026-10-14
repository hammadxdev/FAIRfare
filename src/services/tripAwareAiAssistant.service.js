const base = require("./ai/aiRideAssistant.service");
const { resolveTripForAssistant } = require("./tripResolution.service");
const { extractTripLocations } = require("./tripExtraction.service");
const conversations = require("./ai/conversation.service");
const qualityAwareAssistant = require("./qualityAwareAssistant.service");
const { buildConversationTripContext, publicTripContext } = require("./tripContext.service");
const defaultTripResolver = resolveTripForAssistant;
let tripResolver = defaultTripResolver;

function attachResponsePolicy(args, result) {
  if (!result || typeof result !== "object" || result.modelId == null) return result;
  return result;
}

function routeResponseLanguage(message) {
  return /\b(?:mujhe|mein|barish|sasti|sasta|paregi|jana|jaana|kar do|konsa|kaunsi|sab se|agar|pe|hai|ho)\b/i.test(String(message || "")) ? "roman_urdu" : "english";
}

function routeReply(trip, language = "english") {
  const pickup = trip.pickup?.name || trip.extracted?.pickup;
  const destination = trip.destination?.name || trip.extracted?.destination;
  if (language === "roman_urdu") {
    if (trip.status === "RESOLVED" && trip.route?.distanceMeters && trip.route?.durationSeconds) {
      const approximate = trip.pickup?.approximate || trip.destination?.approximate;
      const routeLabel = approximate ? "taqriban map-based road route" : "estimated road route";
      return `Maine ${pickup} se ${destination} ka ${routeLabel} dhoond liya: ${Math.round((trip.route.distanceMeters / 1000) * 10) / 10} km aur lagbhag ${Math.round(trip.route.durationSeconds / 60)} minutes. Fair Fare ke paas is message ke liye verified provider comparison nahi hai, is liye main fare ya availability invent nahi karunga.`;
    }
    if (trip.status === "CROSS_CITY") return `Maine ${pickup} aur ${destination} ko mukhtalif shehron mein resolve kiya. Local provider comparison se pehle confirm karein ke aap intercity safar chahte hain.`;
    if (trip.status === "ROUTE_UNAVAILABLE") return `Maine ${pickup} aur ${destination} resolve kar liye, lekin road route abhi available nahi hai. Main distance, fare ya provider result invent nahi karunga.`;
    if (trip.status === "UNRESOLVED") return `Maine ${trip.unresolved === "pickup" ? "destination" : "pickup"} samajh liya, lekin ${trip.unresolved || "doosri"} location confidently resolve nahi hui. Sirf wohi location clarify karein.`;
  }
  if (trip.status === "RESOLVED" && trip.route?.distanceMeters && trip.route?.durationSeconds) {
    const approximate = trip.pickup?.approximate || trip.destination?.approximate;
    const routeLabel = approximate ? "The approximate map-based road route" : "The estimated road route";
    return `I found ${pickup} to ${destination}. ${routeLabel} is ${Math.round((trip.route.distanceMeters / 1000) * 10) / 10} km and about ${Math.round(trip.route.durationSeconds / 60)} minutes. Fair Fare does not have a verified provider comparison for this message yet, so I will not invent a fare or availability.`;
  }
  if (trip.status === "CROSS_CITY") {
    if (trip.explicitIntercity && trip.route?.distanceMeters && trip.route?.durationSeconds) {
      return `I found ${pickup} and ${destination} as an intercity trip. The estimated road route is ${Math.round((trip.route.distanceMeters / 1000) * 10) / 10} km and about ${Math.round(trip.route.durationSeconds / 60)} minutes. Fair Fare does not have verified intercity provider coverage for this route, so I will not invent a fare or availability.`;
    }
    return `I found ${pickup} and ${destination}, but they resolve to different cities. Please confirm that you intend an intercity trip before comparing local provider coverage.`;
  }
  if (trip.status === "ROUTE_UNAVAILABLE") return `I found ${pickup} and ${destination}, but the road route is unavailable right now. I will not invent a distance, duration, fare, or provider result.`;
  if (trip.status === "UNRESOLVED") return `I found ${trip.unresolved === "pickup" ? "the destination" : "the pickup"}, but could not resolve the ${trip.unresolved || "other"} location confidently. Please clarify only that location.`;
  return null;
}

async function answer(args) {
  let trip;
  let resolverMessage = args.message;
  let recent = [];
  try {
    const current = extractTripLocations(args.message);
    recent = args.userId && args.conversationId ? await conversations.recentMessages(args.userId, args.conversationId) : [];
    trip = await buildConversationTripContext({ message: args.message, recentMessages: recent, tripResolver });
    if (trip.status === "NO_TRIP" && current.pickup && current.destination) trip = await tripResolver({ message: resolverMessage });
  }
  catch (error) { trip = { status: "UNRESOLVED", error: error.code || "TRIP_RESOLUTION_FAILED" }; }
  if (trip.status !== "NO_TRIP" && trip.extracted) {
    // An existing comparison is authoritative. Keep the established assistant
    // grounding path so fare facts and Book/Wait semantics are not replaced by
    // a route-only response.
    const structuredTrip = publicTripContext(trip);
    if (args.comparisonId) return qualityAwareAssistant.answer({ ...args, tripContext: structuredTrip });
    const current = extractTripLocations(args.message);
    const routeReplyAllowed = trip.source === "current_message" || (current.pickup && current.destination);
    const reply = routeReplyAllowed ? routeReply(trip, routeResponseLanguage(args.message)) : null;
    if (reply) return { reply, modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", context: { comparisonUsed: Boolean(args.comparisonId), comparisonFreshness: null, predictionAvailable: false, preferencesUsed: true, historyUsed: recent.length > 0, historyAvailable: recent.length > 0, trip: structuredTrip } };
    return qualityAwareAssistant.answer({ ...args, tripContext: structuredTrip });
  }
  return qualityAwareAssistant.answer({ ...args, tripContext: null });
}

function setTripResolverForTests(resolver) { tripResolver = resolver || defaultTripResolver; }

module.exports = { ...base, answer, routeReply, routeResponseLanguage, setTripResolverForTests };
