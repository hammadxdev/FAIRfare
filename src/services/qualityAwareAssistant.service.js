const base = require("./ai/aiRideAssistant.service");
const defaultLlmClient = require("./ai/llmClient");
const { extractTripLocations } = require("./tripExtraction.service");
const { enforce: enforceProviderBoundary, normalizeComparison } = require("./providerRecommendationGuard.service");
const { buildGroundedComparison, deterministicSummary, validateReplyAgainstGrounding } = require("./ai/fareComparisonGrounding.service");
const { getComparisonForUser } = require("./currentComparison.service");

let llmClient = defaultLlmClient;

function responsePolicy(message) {
  const language = /\b(mujhe|abhi|mein|barish|mehngi|sasti|paregi|karni|karun|konsi|kaunsi|sab se|agar|wait karun|kam ho|book karni|jana hai|jaana hai|kyun|kyon|lena hai|chahiye)\b/i.test(String(message || "")) ? "roman_urdu" : "english";
  return { language, maxSentences: 4, noUnverifiedCurrentClaims: true, doNotAssumeCity: true, doNotInventProviderOrVehicleCoverage: true, doNotInventLiveTrafficWeatherEvents: true, conciseSafetyAdvice: true };
}

function safeConditionReply(message, language, options = {}) {
  if (options.hasAuthoritativeContext && !options.conversationTrip) return null;
  const value = String(message || "").toLowerCase();
  if (/rain|barish|fog/.test(value)) {
    const tripSuffix = options.conversationTrip ? (language === "roman_urdu" ? ` Aapke ${options.conversationTrip.pickup} se ${options.conversationTrip.destination} route par extra time ka exact estimate mere paas nahi hai.` : ` For ${options.conversationTrip.pickup} to ${options.conversationTrip.destination}, allow extra time, but I cannot verify an exact delay.`) : "";
    return language === "roman_urdu"
      ? `Barish ya dhund mein road slippery aur visibility kam ho sakti hai. Car aam tor par bike se zyada safe hoti hai; mere paas is waqt live weather ya traffic data nahi hai.${tripSuffix}`
      : `In heavy rain or fog, a car is generally safer than a bike because visibility and traction can worsen. I do not have verified live weather or traffic data for your area right now.${tripSuffix}`;
  }
  if (/friday.*prayer|prayer.*friday/.test(value)) return language === "roman_urdu"
    ? "Friday prayer ke waqt traffic kuch areas mein barh sakta hai, lekin mere paas live traffic ya prayer-time road data nahi hai. Safar se pehle local traffic source check karein aur extra time rakhein."
    : "Traffic can increase around Friday prayer, but I do not have verified live traffic or prayer-time road data for your area. Check a local traffic source and allow extra time.";
  if (/protest|road closure/.test(value)) return "I do not have a verified live source confirming a protest or road closure. Check an official traffic or local news source, avoid unsafe areas, and delay the trip if authorities advise it.";
  if (/major event|concert|festival|sports/.test(value)) return "A major event may increase demand, but I do not have verified live demand, fare, or driver-availability data. Check the provider app before booking and avoid treating any estimate as guaranteed.";
  if (/office timing|office hours|rush hour|peak hours/.test(value)) return language === "roman_urdu"
    ? "Office timing mein demand aam tor par barh sakti hai, lekin mere paas is waqt live surge ya fare data nahi hai. Exact price ke liye provider app ka current quote check karein."
    : "Office-hour demand can be higher, but I do not have verified live surge or fare data. Check the provider app for the current quote instead of treating a general pattern as a live price.";
  return null;
}

function safeUngroundedFareReply(message, language, options = {}) {
  if (options.hasAuthoritativeContext) return null;
  const text = String(message || "").toLowerCase();
  const routeFareQuestion = /\b(?:how much|kitna|sasta|sasti|cheaper|cheap)\b/.test(text) || (/\b(?:fare|kiraya|price|cost)\b/.test(text) && /\b(?:route|ride|vehicle|bike|rickshaw|car|trip)\b/.test(text));
  if (!routeFareQuestion) return null;
  return language === "roman_urdu"
    ? "Is route ya vehicle ke liye Fair Fare ke paas abhi verified comparison nahi hai, is liye main fare invent nahi karunga. Route aur vehicle details ke saath comparison banayein, ya provider app mein current quote check karein."
    : "Fair Fare does not have a verified comparison for this route or vehicle yet, so I will not invent a fare. Create a comparison with the route and vehicle, or check the provider app for its current quote.";
}

function safeCoverageReply(message, language) {
  if (!/(?:verified mode|zero approved|no approved coverage|approved coverage)/i.test(String(message || ""))) return null;
  return language === "roman_urdu"
    ? "Agar verified mode mein approved coverage zero ho, Fair Fare ko kisi provider ki recommendation nahi deni chahiye. Current options ke liye provider apps check karein."
    : "With zero approved coverage in verified mode, Fair Fare should not recommend a provider. Check the provider apps directly for current options.";
}

function safeVehicleReply(message, language, options = {}) {
  if (options.hasAuthoritativeContext) return null;
  const text = String(message || "").toLowerCase();
  if (!/\b(?:bike|rickshaw|car|vehicle)\b/.test(text) || /\b(?:how much|kitna|fare|kiraya|price|cost|sasta|sasti|cheaper|cheap)\b/.test(text)) return null;
  return language === "roman_urdu"
    ? "Bike kam kharch aur halka safar ke liye theek ho sakti hai; rickshaw zyada space deta hai, jabke car comfort aur barish mein behtar hoti hai. Is route ke liye verified fare comparison abhi available nahi hai."
    : "A bike is useful for a lower-cost, light trip; a rickshaw offers more space, while a car is generally more comfortable and better in rain. A verified fare comparison for this route is not available yet.";
}

async function answer(args) {
  const context = await base.buildGroundingContext(args);
  // Production model grounding must use the canonical supported-provider
  // comparison. Test clients may intentionally use compact legacy fixtures;
  // keep those fixtures visible to the injected client while the final
  // provider guard still canonicalizes and filters the response.
  if (context.comparison && llmClient === defaultLlmClient) context.comparison = normalizeComparison(context.comparison);
  context.providerPolicy = "Fair Fare compares only the supported providers in backend data: indrive displayed as inDrive, quickride displayed as Yango, and urbancab displayed as Bykea. Never recommend Uber, Careem, or any unsupported or generic ride-hailing service. If the user asks about an unsupported provider, explain that it is not compared. Never infer provider or vehicle availability.";
  if (args.tripContext) {
    context.structuredTrip = args.tripContext;
    context.currentIntent = args.tripContext.intent || null;
  }
  const policy = responsePolicy(args.message);
  context.responseLanguage = policy.language;
  context.responsePolicy = policy;
  const conversationTrip = context.recentConversation.slice().reverse().map((item) => item.role === "USER" ? extractTripLocations(item.content) : null).find((trip) => trip?.pickup && trip?.destination) || null;
  const publicContext = { comparisonUsed: Boolean(context.comparison), comparisonFreshness: context.comparison?.freshness || null, predictionAvailable: Boolean(context.comparison?.rides?.some((ride) => ride.prediction?.status === "AVAILABLE")), preferencesUsed: true, historyUsed: context.history.length > 0, historyAvailable: context.history.length > 0, trip: args.tripContext || null };
  const groundedComparison = args.comparisonId ? buildGroundedComparison(getComparisonForUser(args.comparisonId, args.userId) || null) : null;
  try {
    const rawResult = typeof llmClient.completeDetailed === "function"
      ? await llmClient.completeDetailed({ message: args.message, context })
      : await llmClient.complete({ message: args.message, context });
    const result = typeof rawResult === "string"
      ? { text: rawResult, modelId: null, provider: null, fallbackUsed: false }
      : rawResult;
    const guardedReply = safeConditionReply(args.message, policy.language, { hasAuthoritativeContext: Boolean(context.comparison), conversationTrip });
    const coverageGuardedReply = safeCoverageReply(args.message, policy.language);
    const fareGuardedReply = safeUngroundedFareReply(args.message, policy.language, { hasAuthoritativeContext: Boolean(context.comparison) });
    const vehicleGuardedReply = safeVehicleReply(args.message, policy.language, { hasAuthoritativeContext: Boolean(context.comparison) });
    const candidateReply = guardedReply || coverageGuardedReply || fareGuardedReply || vehicleGuardedReply || result.text;
    const safeReply = validateReplyAgainstGrounding(candidateReply, groundedComparison) ? candidateReply : deterministicSummary(groundedComparison, args.message, policy.language);
    const providerGuard = enforceProviderBoundary({
      message: args.message,
      text: safeReply,
      comparison: context.comparison,
      responseLanguage: policy.language,
    });
    return { reply: providerGuard.text, modelId: result.modelId, provider: result.provider || null, fallbackUsed: Boolean(result.fallbackUsed), context: publicContext, available: true, status: "AVAILABLE" };
  } catch (error) {
    if (groundedComparison) return { reply: deterministicSummary(groundedComparison, args.message, policy.language), context: publicContext, available: true, status: "AVAILABLE", fallbackUsed: true, modelId: null, provider: null, errorCode: error.code || "LLM_PROVIDER_ERROR" };
    return { reply: null, context: publicContext, available: false, status: "UNAVAILABLE", errorCode: error.code || "LLM_PROVIDER_ERROR" };
  }
}

function setLlmClientForTests(client) { llmClient = client || defaultLlmClient; }

// The public /api/ai route uses the quality-aware path, while older tests
// inject through the base assistant seam. Keep that test seam shared so a
// simulated provider failure cannot accidentally call a real provider.
const baseSetLlmClientForTests = base.setLlmClientForTests;
base.setLlmClientForTests = (client) => {
  baseSetLlmClientForTests(client);
  setLlmClientForTests(client);
};

module.exports = { answer, responsePolicy, safeConditionReply, safeUngroundedFareReply, safeVehicleReply, safeCoverageReply, setLlmClientForTests };
