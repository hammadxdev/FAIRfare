const { getPreferences } = require("../userPreference.service");
const { getHistory, getHistoryById } = require("../history.service");
const { getComparisonForUser } = require("../currentComparison.service");
const defaultLlmClient = require("./llmClient");
const conversationService = require("./conversation.service");
const { retrieveFairFareKnowledge } = require("./fairFareKnowledge.service");

let llmClient = defaultLlmClient;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY = 5;

function responseLanguage(message) {
  const value = String(message || "").toLowerCase();
  if (/\b(mujhe|abhi|karni|karun|konsi|kaunsi|sab se|sasti|agar|wait karun|kam ho|book karni)\b/.test(value)) return "roman_urdu";
  return "english";
}

function derivedFacts(rides) {
  const available = rides.filter((ride) => ride.availability === "available");
  const fareCandidates = available.filter((ride) => typeof ride.fare === "number" && Number.isFinite(ride.fare));
  const etaCandidates = available.filter((ride) => typeof ride.pickupEtaMin === "number" && Number.isFinite(ride.pickupEtaMin));
  const flaggedCheapest = fareCandidates.filter((ride) => ride.isCheapest);
  const flaggedFastest = etaCandidates.filter((ride) => ride.isFastest);
  const cheapest = (flaggedCheapest.length ? flaggedCheapest : fareCandidates.filter((ride) => ride.fare === Math.min(...fareCandidates.map((item) => item.fare))))[0] || null;
  const fastest = (flaggedFastest.length ? flaggedFastest : etaCandidates.filter((ride) => ride.pickupEtaMin === Math.min(...etaCandidates.map((item) => item.pickupEtaMin))))[0] || null;
  const recommendationStatuses = [...new Set(rides.map((ride) => ride.bookWait?.status).filter((status) => status && status !== "INSUFFICIENT_DATA"))];
  return {
    cheapest: cheapest ? { provider: cheapest.provider, fare: cheapest.fare, currency: cheapest.currency } : null,
    pickupEstimate: fastest ? { provider: fastest.provider, pickupEtaMin: fastest.pickupEtaMin, verified: false } : null,
    bookWaitStatus: recommendationStatuses.length === 1 ? recommendationStatuses[0] : null,
  };
}

async function safePreferences(userId) { return getPreferences(userId); }

function comparisonContext(comparison) {
  if (!comparison) return null;
  return {
    comparisonId: comparison.comparisonId || null,
    freshness: comparison.comparisonId ? "current_enriched_comparison" : "history_snapshot",
    route: { pickup: comparison.pickup?.name || comparison.pickup?.label, dropoff: comparison.dropoff?.name || comparison.dropoff?.label, distanceKm: comparison.distanceKm ?? (comparison.route?.distanceMeters == null ? null : comparison.route.distanceMeters / 1000), durationMin: comparison.durationMin ?? (comparison.route?.durationSeconds == null ? null : comparison.route.durationSeconds / 60) },
    weather: comparison.weather ? { condition: comparison.weather.condition || "UNKNOWN", severity: comparison.weather.weatherSeverity || "UNKNOWN", precipitationMm: comparison.weather.precipitationMm ?? null, temperatureC: comparison.weather.temperatureC ?? null, source: comparison.weather.source || "UNKNOWN" } : null,
    rides: (comparison.results || comparison.quotes || []).map((ride) => ({
      provider: ride.provider?.displayName || ride.provider?.name || ride.provider,
      vehicleType: ride.vehicleType || ride.category || ride.categoryName || ride.quotes?.[0]?.categoryName || null,
      fare: ride.fare ?? null,
      fareMin: ride.fareMin ?? null,
      fareMax: ride.fareMax ?? null,
      currency: ride.currency || "PKR",
      fareType: ride.fareType || ride.quotes?.[0]?.fareType || null,
      pickupEtaMin: ride.etaMin ?? (ride.pickupEtaSeconds == null ? (ride.quotes?.[0]?.pickupEtaSeconds == null ? null : ride.quotes[0].pickupEtaSeconds / 60) : ride.pickupEtaSeconds / 60),
      availability: ride.isAvailable === false || ride.availability === "unavailable" ? "unavailable" : "available",
      prediction: ride.prediction ? { status: ride.prediction.status, predictedFare: ride.prediction.predictedFare ?? null, dataSource: ride.prediction.dataSource || null, model: ride.prediction.model || null } : null,
      bookWait: ride.recommendation ? { status: ride.recommendation.status, currentFare: ride.recommendation.currentFare ?? null, expectedFare: ride.recommendation.expectedFare ?? null, reason: ride.recommendation.reason || null, modelDataSource: ride.recommendation.modelDataSource || null } : null,
      isCheapest: ride.isCheapest === true,
      isFastest: ride.isFastest === true,
      personalization: ride.personalization ? { eligible: ride.personalization.eligible, isTopRecommendation: ride.personalization.isTopRecommendation, withinBudget: ride.personalization.withinBudget, preferredVehicleMatch: ride.personalization.preferredVehicleMatch, reasons: ride.personalization.reasons || [], exclusionReason: ride.personalization.exclusionReason || null } : null,
    })),
  };
}

async function buildGroundingContext({ userId, message, comparisonId, conversationId } = {}) {
  let comparison = null;
  if (comparisonId) { comparison = getComparisonForUser(comparisonId, userId); if (!comparison) comparison = await getHistoryById(comparisonId, userId); }
  const preferences = await safePreferences(userId);
  const lower = String(message || "").toLowerCase();
  const history = await getHistory({ userId, limit: lower.includes("recent") || lower.includes("usually") || lower.includes("compare") ? MAX_HISTORY : 3 });
  const recentConversation = conversationId ? await conversationService.recentMessages(userId, conversationId) : [];
  if (recentConversation.at(-1)?.role === "USER" && recentConversation.at(-1).content === message) recentConversation.pop();
  const comparisonData = comparisonContext(comparison);
  return { responseLanguage: responseLanguage(message), comparison: comparisonData ? { ...comparisonData, derivedFacts: derivedFacts(comparisonData.rides) } : null, preferences: { preferredVehicleType: preferences.preferredVehicleType, avoidedVehicleTypes: preferences.avoidedVehicleTypes, typicalBudget: preferences.typicalBudget, ridePriority: preferences.ridePriority, currency: preferences.currency }, history: history.map((item) => ({ id: item.id, searchedAt: item.searchedAt, pickup: item.pickup.label, dropoff: item.destination.label, quotes: item.quotes.map((quote) => ({ provider: quote.provider, category: quote.category, fare: quote.fare, fareMin: quote.fareMin, fareMax: quote.fareMax, currency: quote.currency, fareType: quote.fareType, pickupEtaSeconds: quote.pickupEtaSeconds, availability: quote.availability })) })), recentConversation, fairFareKnowledge: retrieveFairFareKnowledge(message) };
}

async function answer({ userId, message, comparisonId, conversationId }) {
  const context = await buildGroundingContext({ userId, message, comparisonId, conversationId });
  const publicContext = { comparisonUsed: Boolean(context.comparison), comparisonFreshness: context.comparison?.freshness || null, predictionAvailable: Boolean(context.comparison?.rides?.some((ride) => ride.prediction?.status === "AVAILABLE")), preferencesUsed: true, historyUsed: context.history.length > 0, historyAvailable: context.history.length > 0 };
  try {
    const result = typeof llmClient.completeDetailed === "function" ? await llmClient.completeDetailed({ message, context }) : await llmClient.complete({ message, context });
    return { reply: typeof result === "string" ? result : result.text, modelId: typeof result === "string" ? null : result.modelId, provider: typeof result === "string" ? null : result.provider || null, fallbackUsed: typeof result === "string" ? false : Boolean(result.fallbackUsed), context: publicContext, available: true, status: "AVAILABLE" };
  }
  catch (error) {
    const code = error.code || "LLM_PROVIDER_ERROR";
    const reason = error.safeReason || error.message || "unknown AI error";
    console.warn("[AI] request failed", { model: defaultLlmClient.config().model, httpStatus: error.statusCode || null, providerCode: code, reason: String(reason).slice(0, 300) });
    return { reply: null, context: publicContext, available: false, status: "UNAVAILABLE", errorCode: error.code || "LLM_PROVIDER_ERROR" };
  }
}

function setLlmClientForTests(client) { llmClient = client; }
function validateMessage(message) { if (typeof message !== "string" || !message.trim()) return "message is required"; if (message.length > MAX_MESSAGE_LENGTH) return `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`; return null; }

module.exports = { answer, buildGroundingContext, comparisonContext, derivedFacts, responseLanguage, validateMessage, setLlmClientForTests, MAX_MESSAGE_LENGTH };
