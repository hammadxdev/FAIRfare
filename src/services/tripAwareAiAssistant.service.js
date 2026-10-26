const base = require("./ai/aiRideAssistant.service");
const { resolveTripForAssistant } = require("./tripResolution.service");
const { extractTripLocations } = require("./tripExtraction.service");
const conversations = require("./ai/conversation.service");
const qualityAwareAssistant = require("./qualityAwareAssistant.service");
const { buildConversationTripContext, publicTripContext } = require("./tripContext.service");
const { getPersistedComparisonForUser } = require("./currentComparison.service");
const { compareFares, isLiveFareResult } = require("./fare.service");
const { DECISIONS, decideGrounding } = require("./ai/groundingDecision.service");
const { lookupProviderService, parseServiceQuestion } = require("./ai/serviceIdentityResolver.service");
const { classifyDomain, outOfScopeReply } = require("./ai/domainPolicy.service");
const { buildServerIntent, routeIntent } = require("./ai/intentRouter.service");
const { executeToolCalls, runBoundedToolAgent } = require("./ai/toolExecutor.service");
const { listTools } = require("./ai/toolRegistry");
const { planTrip } = require("./ai/tripPlanner.service");
const { forecastFare, compareTimeBuckets } = require("./ai/fareForecast.service");
const { readHistoricalFareEvidence, deriveTimeFeatures } = require("./fareObservation.service");
const providers = require("../providers/provider.registry");
const { getMemory, resolveComparisonReference, savePlanningContext } = require("./ai/conversationMemory.service");
const defaultLlmClient = require("./ai/llmClient");
const { understand } = require("./ai/semanticUnderstanding.service");
const { FAIRFARE_POLICY } = require("./ai/fairFarePolicy");
const defaultTripResolver = resolveTripForAssistant;
let tripResolver = defaultTripResolver;
let comparisonBuilder = compareFares;

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

function serviceIdentityReply(result, message) {
  const language = routeResponseLanguage(message);
  if (result.status === "AMBIGUOUS_PROVIDER") return language === "roman_urdu"
    ? `Service ${result.serviceCode} ek se zyada providers mein mila. Provider ka naam batayein, jaise inDrive, Yango ya Bykea.`
    : `Service ${result.serviceCode} appears under more than one provider. Which provider do you mean: inDrive, Yango or Bykea?`;
  if (result.status === "AMBIGUOUS_SERVICE") return language === "roman_urdu"
    ? "Is conversation mein ek se zyada services hain. Service code ya provider ka naam batayein."
    : "This comparison contains more than one service. Please provide the service code or provider name.";
  if (result.status === "COMPARISON_NOT_FOUND" || result.status === "UNKNOWN_SERVICE" && !result.comparisonId) return language === "roman_urdu"
    ? "Mujhe aapki authorized recent fare comparison nahi mili, is liye service identity verify nahi kar sakta. Pehle fare comparison banayein ya provider ka naam batayein."
    : "I could not find an authorized recent fare comparison, so I cannot verify that service identity. Create a fare comparison or tell me the provider.";
  if (result.status === "UNKNOWN_SERVICE") {
    const provider = result.provider?.displayName || "the provider";
    const fare = result.fare?.value == null ? "" : ` The observed fare was ${result.fare.value} ${result.fare.currency || ""}.`;
    return language === "roman_urdu"
      ? `Service ${result.serviceCode} ${provider} ka code mila, lekin FareRide ke paas iski verified vehicle identity nahi hai.${fare}`
      : `Service ${result.serviceCode} was observed for ${provider}, but FareRide does not have a verified vehicle identity for it.${fare}`;
  }
  const name = result.service.name || result.service.originalLabel || `service ${result.service.code}`;
  const provider = result.provider.displayName || result.provider.id || "the provider";
  const category = result.service.vehicleCategory ? ` (${result.service.vehicleCategory})` : " (vehicle category unknown)";
  const fare = result.fare.value == null ? "" : ` The observed fare was ${result.fare.value} ${result.fare.currency || ""}.`;
  const freshness = result.evidence.freshness === "fresh" ? " This quote is still within its recorded validity window." : " This is a stored comparison observation, not a new live quote.";
  return language === "roman_urdu"
    ? `Service ${result.service.code} ${provider} ki ${name}${category} hai.${fare}${freshness}`
    : `Service ${result.service.code} is ${name} from ${provider}${category}.${fare}${freshness}`;
}

function toolsEnabled() { return String(process.env.FAIRFARE_AI_TOOL_AGENT_ENABLED || "false").toLowerCase() === "true"; }
function modelToolsEnabled() { return toolsEnabled() && String(process.env.FAIRFARE_AI_MODEL_TOOLS_ENABLED || "false").toLowerCase() === "true"; }
function liveComparisonEnabled() { return String(process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED || "false").toLowerCase() === "true"; }
function plannerEnabled() { return String(process.env.FAIRFARE_AI_TRIP_PLANNER_ENABLED || process.env.FAIRRIDE_AI_TRIP_PLANNER_ENABLED || "false").toLowerCase() === "true"; }
function forecastEnabled() { return String(process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED || process.env.FAIRRIDE_AI_FARE_FORECAST_ENABLED || "false").toLowerCase() === "true"; }
function routeResolutionEnabled() { return String(process.env.FAIRFARE_AI_ROUTE_RESOLUTION_ENABLED || "false").toLowerCase() === "true"; }
function observationForecastEnabled() { return String(process.env.FAIRFARE_AI_HISTORICAL_FORECAST_ENABLED || "false").toLowerCase() === "true"; }
function modelFirstEnabled() { return String(process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED || "false").toLowerCase() === "true"; }
function planningContext(recent = []) {
  const messages = recent.filter((item) => String(item?.role || "").toUpperCase() === "USER");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = planTrip({ message: messages[index].content, context: {} });
    if (parsed.pickup || parsed.destination) return parsed;
  }
  return {};
}
function plannerReply(plan, forecast, message) {
  const roman = routeResponseLanguage(message) === "roman_urdu";
  if (plan.status === "NEEDS_CLARIFICATION") return roman ? `Planning ke liye ${plan.missingFields.join(" aur ")} chahiye. Main location ya fare invent nahi karunga.` : `I need ${plan.missingFields.join(" and ")} to plan this trip. I will not invent a location or fare.`;
  if (forecast?.status === "INSUFFICIENT_DATA") return roman ? "Is route aur time ke liye reliable historical calibration nahi mili, is liye future fare estimate nahi de sakta. Ride booked nahi hui." : "There is not enough comparable historical calibration for a reliable future fare estimate. No ride was booked.";
  return { type: "trip_plan", status: plan.status, trip: plan, forecast: forecast || null, booking: { created: false } };
}
function requestedProviders(message) { const text = String(message || ""); return ["yango", "bykea", "indrive"].filter((name) => new RegExp(`\\b${name}\\b`, "i").test(text)); }
function fareRoutePayload(route) {
  if (!route) return null;
  return {
    distanceKm: route.distanceKm ?? (Number.isFinite(Number(route.distanceMeters)) ? Number(route.distanceMeters) / 1000 : null),
    durationMin: route.durationMin ?? (Number.isFinite(Number(route.durationSeconds)) ? Number(route.durationSeconds) / 60 : null),
    distanceMeters: route.distanceMeters ?? null,
    durationSeconds: route.durationSeconds ?? null,
    compareFaresEligible: route.compareFaresEligible,
    eligibilityReason: route.eligibilityReason || null,
  };
}
function hasVerifiedForecastRoute(trip) {
  const route = trip?.route || {};
  const pickup = trip?.pickup || {};
  const destination = trip?.destination || {};
  const validCoordinate = (value, minimum, maximum) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
  const validPositiveNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
  return trip?.status === "RESOLVED"
    && typeof trip.city === "string" && trip.city.trim().length > 0
    && validCoordinate(pickup.lat, -90, 90) && validCoordinate(pickup.lng, -180, 180)
    && validCoordinate(destination.lat, -90, 90) && validCoordinate(destination.lng, -180, 180)
    && validPositiveNumber(route.distanceMeters) && validPositiveNumber(route.durationSeconds);
}
function liveComparisonReply(trip, comparison, message) {
  const language = routeResponseLanguage(message);
  const pickup = trip.pickup?.name || trip.extracted?.pickup;
  const destination = trip.destination?.name || trip.extracted?.destination;
  const distance = trip.route?.distanceMeters == null ? null : `${Math.round(Number(trip.route.distanceMeters) / 100) / 10} km`;
  const duration = trip.route?.durationSeconds == null ? null : `${Math.round(Number(trip.route.durationSeconds) / 60)} minutes`;
  const rawQuotes = comparison?.quotes || comparison?.results || [];
  const quotes = rawQuotes.filter((item) => isLiveFareResult(item));
  const unavailable = rawQuotes.filter((item) => item && !isLiveFareResult(item));
  const providerName = (item) => item.providerDisplayName || item.provider?.displayName || item.provider?.name || item.provider || "Provider";
  const lines = quotes.map((item) => `${providerName(item)}: ${item.fare} ${item.currency || "PKR"}`);
  const unavailableLines = unavailable.map((item) => `${providerName(item)}: ${item.availabilityReason || item.reason || item.error || "no usable live fare"}`);
  const intro = language === "roman_urdu" ? `Maine ${pickup} se ${destination} ka verified route dhoond liya${distance && duration ? `: ${distance}, taqriban ${duration}` : ""}.` : `I found your verified route from ${pickup} to ${destination}${distance && duration ? `: ${distance}, about ${duration}` : ""}.`;
  if (!lines.length) return `${intro}\n\n${language === "roman_urdu" ? "Is request ke liye koi usable live fare nahi mila; main historical ya simulated amount ko live nahi bataunga." : "No usable live fare was returned for this request; I will not present historical or simulated amounts as live fares."}${unavailableLines.length ? `\n${unavailableLines.join("\n")}` : ""}`;
  return `${intro}\n\n${language === "roman_urdu" ? "Current verified live fares:" : "Current verified live fares:"}\n${lines.join("\n")}${unavailableLines.length ? `\n\n${unavailableLines.join("\n")}` : ""}`;
}
function liveFareToolReply(toolExecution, message) {
  const language = routeResponseLanguage(message);
  const item = toolExecution?.results?.find((result) => result.name === "compare_live_fares");
  const result = item?.ok ? item.result : null;
  const quotes = result?.status === "OK" && Array.isArray(result.quotes) ? result.quotes : [];
  if (!quotes.length) return language === "roman_urdu"
    ? "Is request ke liye current verified provider fare available nahi hai. Main simulated ya purane fare ko live nahi bataunga."
    : "No current verified provider fare is available for this request. I will not present a simulated or historical fare as live.";
  const lines = quotes.map((quote) => `${quote.provider}: ${quote.fare} ${quote.currency || "PKR"}${quote.fareSemantics ? ` — ${quote.fareSemantics}` : ""}`);
  return `${language === "roman_urdu" ? "Current verified provider fares:" : "Current verified provider fares:"}\n${lines.join("\n")}`;
}
async function oneShotFuturePlan({ args, plan, message, resolvedTrip }) {
  if (!routeResolutionEnabled()) return { status: "PARTIAL", trip: plan, route: null, estimates: [], cheapestTime: null, limitations: ["Verified route resolution is disabled."], booking: { created: false } };
  const resolved = resolvedTrip === undefined ? await tripResolver({ message }) : resolvedTrip;
  if (!hasVerifiedForecastRoute(resolved)) return { status: "PARTIAL", trip: plan, route: resolved?.route || null, estimates: [], cheapestTime: null, limitations: [resolved?.status === "UNRESOLVED" ? "Pickup or destination could not be verified." : "Verified road routing is unavailable."], booking: { created: false } };
  if (!forecastEnabled() || !observationForecastEnabled()) return { status: "PARTIAL", trip: { ...plan, pickup: resolved.pickup, destination: resolved.destination, city: resolved.city }, route: { ...resolved.route, verified: true, source: "geoapify" }, estimates: [], cheapestTime: null, limitations: ["Historical forecasting is disabled."], booking: { created: false } };
  const vehicleCategory = plan.vehicleType || "car";
  const names = requestedProviders(message); const estimateResults = [];
  for (const requested of names.length ? names : ["yango", "bykea", "indrive"]) {
    const providerId = providers.canonicalProviderId(requested);
    const marketTime = deriveTimeFeatures(plan.departureAt);
    const evidence = await readHistoricalFareEvidence({ providerId, vehicleCategory, city: resolved.city || plan.city, hourOfDay: marketTime.hourOfDay, dayOfWeek: marketTime.dayOfWeek, distanceMeters: resolved.route.distanceMeters, durationSeconds: resolved.route.durationSeconds, dataCutoff: new Date(), limit: 100 });
    const forecast = forecastFare({ observations: evidence.evidence, providerId, vehicleType: vehicleCategory, city: resolved.city || plan.city, forecastAt: plan.departureAt || new Date(), dataCutoff: new Date() });
    estimateResults.push({ providerId, providerName: requested, ...forecast, reason: evidence.reason || null });
  }
  const ready = estimateResults.filter((item) => ["CALIBRATED", "LIMITED_CALIBRATION"].includes(item.status));
  const limitations = ready.length ? estimateResults.some((item) => item.status === "LIMITED_CALIBRATION") ? ["Some provider estimates have limited calibration and should not be treated as reliable quotations."] : [] : ["No provider has sufficient comparable historical evidence."];
  return { status: ready.length ? "READY" : "INSUFFICIENT_DATA", trip: { ...plan, pickup: resolved.pickup, destination: resolved.destination, city: resolved.city }, route: { ...resolved.route, verified: true, source: "geoapify" }, estimates: estimateResults, cheapestTime: compareTimeBuckets([]), limitations, booking: { created: false } };
}
function toolResultReply(intent, result, message) {
  const language = routeResponseLanguage(message);
  const first = result?.results?.find((item) => item.ok)?.result;
  if (!first) return null;
  if (intent === "provider_status") return language === "roman_urdu" ? `Provider status: ${(first.providers || []).map((item) => `${item.id} ${item.status}`).join(", ") || "koi verified status nahi mila"}.` : `Provider status: ${(first.providers || []).map((item) => `${item.id} ${item.status}`).join(", ") || "no verified provider status was available"}.`;
  if (intent === "latest_comparison") return first.comparison ? (language === "roman_urdu" ? "Aapki latest stored fare comparison mil gayi hai. Isay current live booking price na samjhein." : "I found your latest stored fare comparison. Do not treat it as a current booking price.") : (language === "roman_urdu" ? "Aapki koi authorized fare comparison nahi mili." : "I could not find an authorized fare comparison.");
  if (intent === "current_trip") return first.trip ? JSON.stringify(first.trip) : (language === "roman_urdu" ? "Current pickup ya destination context nahi mili." : "I could not find a current pickup or destination context.");
  if (intent === "route_information") return first.route?.distanceMeters != null ? (language === "roman_urdu" ? `Road route taqriban ${Math.round(Number(first.route.distanceMeters) / 100) / 10} km aur ${Math.round(Number(first.route.durationSeconds || 0) / 60)} minutes hai.` : `The road route is approximately ${Math.round(Number(first.route.distanceMeters) / 100) / 10} km and ${Math.round(Number(first.route.durationSeconds || 0) / 60)} minutes.`) : null;
  if (["compare_fares", "cheapest_ride"].includes(intent)) {
    const comparison = first.comparison || first;
    const quotes = Array.isArray(comparison.results || comparison.quotes) ? (comparison.results || comparison.quotes).filter((item) => item && item.isAvailable !== false && Number.isFinite(Number(item.fare))) : [];
    if (!quotes.length) return language === "roman_urdu" ? "Verified available fare quote nahi mili." : "No verified available fare quote was returned.";
    const cheapest = quotes.reduce((best, item) => Number(item.fare) < Number(best.fare) ? item : best);
    return language === "roman_urdu" ? `${cheapest.provider?.displayName || cheapest.provider || "Available option"} sab se sasti verified option hai: ${cheapest.fare} ${cheapest.currency || "PKR"}.` : `${cheapest.provider?.displayName || cheapest.provider || "The available option"} is the cheapest verified option at ${cheapest.fare} ${cheapest.currency || "PKR"}.`;
  }
  return null;
}
function runtimeDiagnostics(intent, toolExecution, trip) {
  const results = Array.isArray(toolExecution?.results) ? toolExecution.results : [];
  return {
    intentType: intent?.intent || null,
    contextMode: trip?.source === "current_message" ? "new" : trip?.source === "conversation_history" ? "follow_up" : "unknown",
    toolsSelected: results.map((item) => item.name).filter(Boolean),
    toolExecution: results.map((item) => ({ name: item.name || null, success: item.ok === true, error: item.ok === true ? null : item.error?.code || "TOOL_FAILED" })),
    disambiguationReason: trip?.status === "UNRESOLVED" ? trip.unresolved || "location" : null,
    liveComparison: results.some((item) => item.name === "compare_live_fares") ? (results.some((item) => item.result?.status === "LIVE_COMPARISON_DISABLED") ? "disabled" : "attempted") : "not_requested",
    responseProvenance: results.some((item) => item.result?.results?.some?.((quote) => quote?.dataSource === "REAL" || quote?.sourceType === "live")) ? "verified_live" : trip?.status === "RESOLVED" ? "verified_route" : "unresolved",
  };
}

async function deterministicToolPath({ intent, args, recent, futurePlan, futureResolvedTrip }) {
  if ((!toolsEnabled() && !["future_fare_plan", "future_fare_follow_up", "current_trip"].includes(intent.intent)) || ["service_identity", "app_help", "follow_up", "ambiguous"].includes(intent.intent)) return null;
  const context = { userId: args.userId, conversationId: args.conversationId, comparisonId: args.comparisonId || null, explicitComparisonIntent: intent.explicitComparisonIntent === true, liveComparisonEnabled: liveComparisonEnabled(), deadlineAt: Date.now() + 12000 };
  if (["future_fare_plan", "future_fare_follow_up"].includes(intent.intent)) {
    if (!plannerEnabled()) return { reply: "Future trip planning is not enabled for this FareRide environment.", result: null };
    const prior = planningContext(recent);
    const plan = futurePlan || planTrip({ message: args.message, requestTimestamp: args.requestTimestamp || new Date(), timezone: "Asia/Karachi", context: prior });
    if (plan.status === "READY" && futureResolvedTrip?.status === "UNRESOLVED") {
      const clarification = routeDecisionResponse({ trip: futureResolvedTrip, decision: DECISIONS.LOCATION_UNRESOLVED, message: args.message });
      return { reply: clarification.reply, trip: futureResolvedTrip, result: null };
    }
    const result = plan.status === "READY" ? await oneShotFuturePlan({ args, plan, message: args.message, resolvedTrip: futureResolvedTrip }) : { status: "NEEDS_CLARIFICATION", trip: plan, route: null, estimates: [], cheapestTime: null, limitations: [], booking: { created: false } };
    return { reply: result, result: { results: [{ ok: true, name: "plan_trip", result }] } };
  }
  if (["current_trip", "latest_comparison", "provider_status"].includes(intent.intent)) {
    if (intent.intent === "current_trip" && !args.comparisonId) {
      const trip = args.semanticUnderstanding?.pickup && args.semanticUnderstanding?.destination ? await tripResolver({ message: args.message, semantic: args.semanticUnderstanding }) : await buildConversationTripContext({ message: args.message, recentMessages: recent, tripResolver });
      if (trip.status === "RESOLVED") {
        // resolveTripForAssistant already performed the verified Geoapify route
        // lookup. Reuse it for this request instead of routing the same pair a
        // second time before comparing fares.
        const routeCall = { results: [{ ok: true, name: "calculate_route", reused: true, result: { route: trip.route } }] };
        const routeResult = trip.route;
        {
          const comparisonCall = await executeToolCalls([{ name: "compare_live_fares", arguments: { pickup: { lat: trip.pickup.lat, lng: trip.pickup.lng, placeId: trip.pickup.placeId || null, name: trip.pickup.name || null }, dropoff: { lat: trip.destination.lat, lng: trip.destination.lng, placeId: trip.destination.placeId || null, name: trip.destination.name || null }, vehicleType: trip.vehiclePreference || "car", route: fareRoutePayload(routeResult), explicitComparisonIntent: true } }], { ...context, explicitComparisonIntent: true });
          const comparisonItem = comparisonCall.results.find((item) => item.ok && item.result?.status !== "LIVE_COMPARISON_DISABLED" && Array.isArray(item.result?.results));
          if (comparisonItem) return { reply: liveComparisonReply({ ...trip, route: routeResult }, comparisonItem.result, args.message), trip, result: { results: [...routeCall.results, ...comparisonCall.results] } };
          const disabled = comparisonCall.results.find((item) => item.ok && item.result?.status === "LIVE_COMPARISON_DISABLED");
          const language = routeResponseLanguage(args.message);
          const reason = disabled ? (language === "roman_urdu" ? "Current live fare comparison disabled hai (FAIRFARE_AI_LIVE_COMPARISON_ENABLED=false)." : "Current live fare comparison is disabled (FAIRFARE_AI_LIVE_COMPARISON_ENABLED=false).") : (language === "roman_urdu" ? "Maine live fares check kiye, lekin koi verified quote available nahi tha." : "I checked current provider fares, but no verified live quote was available.");
          return { reply: `${routeReply({ ...trip, route: routeResult }, language)}\n\n${reason}`, trip, result: { results: [...routeCall.results, ...comparisonCall.results] } };
        }
        return { reply: routeReply({ ...trip, route: routeResult }, routeResponseLanguage(args.message)), trip, result: { results: routeCall.results } };
      }
      return { reply: routeDecisionResponse({ trip, decision: DECISIONS.LOCATION_UNRESOLVED, message: args.message }).reply, trip, result: null };
    }
    const name = intent.intent === "current_trip" ? "get_current_trip" : intent.intent === "latest_comparison" ? "get_latest_comparison" : "get_provider_status";
    const toolArgs = name === "get_current_trip" ? { conversationId: args.conversationId || null } : name === "get_latest_comparison" ? { comparisonId: args.comparisonId || null, includeHistorical: true } : {};
    const result = await executeToolCalls([{ name, arguments: toolArgs }], context);
    return { reply: toolResultReply(intent.intent, result, args.message), result };
  }
  if (["route_information", "compare_fares", "cheapest_ride"].includes(intent.intent)) {
    const trip = args.semanticUnderstanding?.pickup && args.semanticUnderstanding?.destination ? await tripResolver({ message: args.message, semantic: args.semanticUnderstanding }) : await buildConversationTripContext({ message: args.message, recentMessages: recent, tripResolver });
    if (trip.status !== "RESOLVED") return { trip };
    const result = intent.intent === "route_information"
      ? { results: [{ ok: true, name: "calculate_route", reused: true, result: { route: trip.route } }] }
      : await executeToolCalls([{ name: "compare_live_fares", arguments: { pickup: { lat: trip.pickup.lat, lng: trip.pickup.lng, placeId: trip.pickup.placeId || null, name: trip.pickup.name || null }, dropoff: { lat: trip.destination.lat, lng: trip.destination.lng, placeId: trip.destination.placeId || null, name: trip.destination.name || null }, vehicleType: trip.vehiclePreference || null, route: trip.route || null, explicitComparisonIntent: intent.explicitComparisonIntent === true } }], context);
    return { trip, result };
  }
  return null;
}

// Retained only for legacy callers/tests during migration. Repository search
// confirms the active chat endpoint does not call this path; remove it only
// after downstream callers and the legacy planner regression suite are retired.
async function legacyAnswer(args) {
  let trip;
  let resolverMessage = args.message;
  let recent = [];
  let semantic = null;
  let semanticDiagnostics = { attempted: false, succeeded: false, errorCategory: null };
  try {
    recent = args.userId && args.conversationId ? await conversations.recentMessages(args.userId, args.conversationId) : [];
    let memory = null;
    if (String(process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED || "false").toLowerCase() === "true" && String(process.env.FAIRFARE_AI_MEMORY_ENABLED || "false").toLowerCase() === "true" && args.conversationId) {
      try { memory = await getMemory({ userId: args.userId, conversationId: args.conversationId }); } catch (error) {
        if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.warn("[AI] conversation memory unavailable", { code: error.code || "MEMORY_UNAVAILABLE" });
      }
      const candidateComparisonId = await resolveComparisonReference({ userId: args.userId, explicitComparisonId: args.comparisonId, memory });
      if (!args.comparisonId && candidateComparisonId) args = { ...args, comparisonId: candidateComparisonId };
    }
    const intentMessages = [...recent, ...(memory?.summaries || []).map((summary) => ({ role: "SYSTEM_MEMORY", content: summary.summary_text }))];
    const hasTrustedConversationContext = Boolean(args.comparisonId || recent.some((item) => { const locations = extractTripLocations(item?.content); return locations.pickup && locations.destination; }) || memory?.comparisonRefs?.length);
    const deterministicIntent = routeIntent(String(args.message || "").replace(/\bfair\s*fare\b/gi, " "), { hasFareRideContext: hasTrustedConversationContext, hasComparison: Boolean(args.comparisonId) });
    const bookingDecision = /\b(?:book|booking)\b/i.test(String(args.message || ""));
    const hasExplicitTripLocations = Boolean(extractTripLocations(args.message).pickup && extractTripLocations(args.message).destination);
    if (bookingDecision && !hasTrustedConversationContext && !hasExplicitTripLocations) {
      const roman = routeResponseLanguage(args.message) === "roman_urdu";
      return { reply: roman ? "Booking ka mashwara dene se pehle pickup, destination aur current ride options chahiye. Main bina verified context ke book karne ka mashwara nahi dunga." : "I need your pickup, destination, and current ride options before advising whether to book. I won’t recommend booking without verified trip context.", modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", context: { semanticUnderstanding: null, semanticUnderstandingDiagnostics: { attempted: false, succeeded: false, errorCategory: null } } };
    }
    const clearHelpQuestion = /\b(?:help|how\s+do\s+i|how\s+can\s+i|how\s+to\s+use)\b/i.test(String(args.message || "").replace(/\bfair\s*fare\b/gi, " "))
      && !/\b(?:fare|ride|route|provider|book|booking|compare|cheapest)\b/i.test(String(args.message || "").replace(/\bfair\s*fare\b/gi, " "));
    const skipSemanticForClearHelp = (deterministicIntent.intent === "app_help" || clearHelpQuestion) && !hasTrustedConversationContext;
    if (modelFirstEnabled() && !skipSemanticForClearHelp) {
      const understood = await understand({ llmClient: defaultLlmClient, message: args.message, context: { recentConversation: recent } });
      semantic = understood.understanding;
      semanticDiagnostics = understood.diagnostics || { attempted: true, succeeded: Boolean(understood.ok), errorCategory: understood.error || null };
      if (semantic.scope === "unsafe" || semantic.scope === "out_of_scope") return { reply: outOfScopeReply(args.message), modelId: understood.modelId || null, provider: understood.provider || null, fallbackUsed: false, available: true, status: "AVAILABLE", context: { domainDecision: semantic.scope, semanticUnderstanding: semantic, semanticUnderstandingDiagnostics: semanticDiagnostics } };
    }
    const policy = skipSemanticForClearHelp
      ? { intent: "app_help", allowed: true, reason: "CLEAR_APP_HELP" }
      : classifyDomain(args.message, { hasFareRideContext: hasTrustedConversationContext, semanticUnderstanding: semantic });
    if (!policy.allowed) return { reply: outOfScopeReply(args.message), modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", context: { domainDecision: policy.reason } };
    if (skipSemanticForClearHelp) {
      const direct = await qualityAwareAssistant.answer({ ...args, tripContext: null });
      return { ...direct, context: { ...(direct.context || {}), responseSource: direct.fallbackUsed ? "safe_fallback" : "llm_direct", semanticUnderstanding: null, semanticUnderstandingDiagnostics: semanticDiagnostics } };
    }
    const serviceQuestion = parseServiceQuestion(args.message, intentMessages);
    if (serviceQuestion) {
      const result = await lookupProviderService({ userId: args.userId, comparisonId: args.comparisonId || null, provider: null, serviceCode: serviceQuestion.serviceCode });
      return { reply: serviceIdentityReply(result, args.message), modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", comparisonId: result.comparisonId || args.comparisonId || null, context: { comparisonUsed: Boolean(result.comparisonId), comparisonFreshness: result.evidence?.freshness || null, serviceIdentity: result } };
    }
    const routedIntent = buildServerIntent(args.message, { hasFareRideContext: hasTrustedConversationContext, hasComparison: Boolean(args.comparisonId), semanticUnderstanding: semantic, userExplicitlyRequestedComparison: semantic?.intent === "fare_comparison" || /\b(?:compare|cheapest|cheaper|sasti|sasta|sab\s+se\s+sasti|which\s+ride)\b/i.test(String(args.message || "")) });
    const intent = bookingDecision && hasTrustedConversationContext
      ? { ...routedIntent, intent: "current_trip" }
      : skipSemanticForClearHelp ? { ...routedIntent, intent: "app_help" } : routedIntent;
    if (semantic) args = { ...args, semanticUnderstanding: semantic };
    let resolvedToolTrip = null;
    let futurePlan = null;
    let futureResolvedTrip;
    const futureFareIntent = ["future_fare_plan", "future_fare_follow_up"].includes(intent.intent);
    const nearbyHistoryRequest = /\b(?:nearby|around\s+(?:me|pickup)|near\s+(?:me|pickup)|historical|past\s+drivers?|driver\s+activity)\b/i.test(String(args.message || ""));
    const routeToolIntent = ["route_information", "compare_fares", "cheapest_ride", "current_trip"].includes(intent.intent);
    const requiresVerifiedToolTrip = routeToolIntent || futureFareIntent;
    const futureForecastEligible = futureFareIntent && plannerEnabled() && routeResolutionEnabled() && forecastEnabled() && observationForecastEnabled();
    if (futureFareIntent) {
      futurePlan = planTrip({ message: args.message, requestTimestamp: args.requestTimestamp || new Date(), timezone: "Asia/Karachi", context: planningContext(recent) });
      if (futureForecastEligible && futurePlan.status === "READY") {
        try {
          futureResolvedTrip = await tripResolver({ message: args.message, semantic: { ...semantic, pickup: { query: futurePlan.pickup }, destination: { query: futurePlan.destination } } });
        } catch {
          futureResolvedTrip = { status: "ROUTE_UNAVAILABLE" };
        }
      }
    }
    if (modelToolsEnabled() && routeToolIntent) {
      const extracted = extractTripLocations(args.message);
      const pickup = semantic?.pickup?.query || extracted.pickup;
      const destination = semantic?.destination?.query || extracted.destination;
      if (pickup && destination) {
        resolvedToolTrip = await tripResolver({ message: args.message, semantic: { ...semantic, pickup: { query: pickup }, destination: { query: destination } } });
      }
    }
    // Keep policy and explicit service-identity guards ahead of the model, but
    // give eligible requests to the genuine model tool loop before legacy
    // keyword-based tool dispatch.
    const directOnlyIntent = new Set(["app_help", "general_travel", "follow_up", "vehicle_recommendation", "travel_timing"]);
    const canRunModelTools = modelToolsEnabled()
      && (!directOnlyIntent.has(intent.intent) || futureFareIntent || nearbyHistoryRequest)
      && (!routeToolIntent || resolvedToolTrip?.status === "RESOLVED")
      && (!futureFareIntent || futureForecastEligible && hasVerifiedForecastRoute(futureResolvedTrip));
    if (canRunModelTools) {
      const grounding = await base.buildGroundingContext({ userId: args.userId, message: args.message, comparisonId: args.comparisonId, conversationId: args.conversationId });
      const toolTrip = futureFareIntent ? futureResolvedTrip : resolvedToolTrip;
      const trustedToolTrip = futureFareIntent
        ? hasVerifiedForecastRoute(toolTrip) ? toolTrip : null
        : toolTrip?.status === "RESOLVED" ? toolTrip : null;
      const context = trustedToolTrip ? { ...grounding, verifiedRoute: { pickup: trustedToolTrip.pickup, destination: trustedToolTrip.destination, route: fareRoutePayload(trustedToolTrip.route), source: "geoapify" } } : grounding;
      const agent = await runBoundedToolAgent({ llmClient: defaultLlmClient, message: args.message, context, serverContext: { userId: args.userId, conversationId: args.conversationId, comparisonId: args.comparisonId, explicitComparisonIntent: intent.explicitComparisonIntent === true, liveComparisonEnabled: liveComparisonEnabled(), requiresResolvedTrip: requiresVerifiedToolTrip, resolvedTrip: trustedToolTrip, deadlineAt: Date.now() + 12000 }, tools: listTools() });
      if (agent.handled && agent.toolResults?.length) {
        if (agent.toolResults.some((item) => item.name === "compare_live_fares")) return { reply: liveFareToolReply({ results: agent.toolResults }, args.message), modelId: agent.result?.modelId || null, provider: agent.result?.provider || null, fallbackUsed: Boolean(agent.result?.fallbackUsed), available: true, status: "AVAILABLE", toolExecution: agent.toolResults, context: { toolCallingMode: "model_selected", toolIntent: intent.intent } };
        if (agent.status === "UNAVAILABLE" || !agent.result?.text) return { reply: routeResponseLanguage(args.message) === "roman_urdu" ? "Verified Fair Fare data abhi available nahi hai. Main simulated ya historical result ko current nahi bataunga." : "Verified Fair Fare data is unavailable right now. I will not present simulated or historical results as current.", modelId: agent.result?.modelId || null, provider: agent.result?.provider || null, fallbackUsed: Boolean(agent.result?.fallbackUsed), available: false, status: "UNAVAILABLE", errorCode: agent.errorCode || "LLM_PROVIDER_ERROR", providerDiagnostics: agent.providerDiagnostics || null, toolExecution: agent.toolResults, context: { toolCallingMode: "model_selected", toolIntent: intent.intent } };
        return { reply: agent.result.text, modelId: agent.result.modelId || null, provider: agent.result.provider || null, fallbackUsed: Boolean(agent.result.fallbackUsed), available: true, status: "AVAILABLE", toolExecution: agent.toolResults, comparisonId: agent.toolResults.find((item) => item.ok && item.result?.comparisonId)?.result.comparisonId || null, context: { toolCallingMode: "model_selected", toolIntent: intent.intent } };
      }
    }

    const toolPath = await deterministicToolPath({ intent, args, recent, futurePlan, futureResolvedTrip });
    if (toolPath?.reply) {
      const structured = toolPath.reply && typeof toolPath.reply === "object" ? toolPath.reply : null;
      let planningPersistence = { status: "NOT_ATTEMPTED", durable: false };
      if (structured?.trip && args.userId && args.conversationId) {
        planningPersistence = await savePlanningContext({ userId: args.userId, conversationId: args.conversationId, planningIntent: intent.intent, departureAt: structured.trip.departureAt || null, departureTimezone: structured.trip.timezone || "Asia/Karachi", vehiclePreference: structured.trip.vehicleType || null, providerPreferences: requestedProviders(args.message), forecastSource: structured.estimates?.some((item) => item.sourceType === "forecast") ? "forecast" : "unavailable", forecastModelVersion: structured.estimates?.find((item) => item.modelVersion)?.modelVersion || null });
      }
      return { reply: toolPath.reply, modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", comparisonId: toolPath.result?.results?.find((item) => item.ok && item.result?.comparisonId)?.result?.comparisonId || null, toolExecution: toolPath.result, context: { toolCallingMode: "server_deterministic", toolIntent: intent.intent, planningPersistence, semanticUnderstanding: semantic, semanticUnderstandingDiagnostics: semanticDiagnostics, diagnostics: runtimeDiagnostics(intent, toolPath.result, toolPath.trip) } };
    }
    if (toolPath?.result && toolPath.result.results?.some((item) => item.ok)) return { reply: toolResultReply(intent.intent, toolPath.result, args.message) || routeReply(toolPath.trip, routeResponseLanguage(args.message)), modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", toolExecution: toolPath.result, context: { toolCallingMode: "server_deterministic", toolIntent: intent.intent, semanticUnderstanding: semantic, semanticUnderstandingDiagnostics: semanticDiagnostics, diagnostics: runtimeDiagnostics(intent, toolPath.result, toolPath.trip) } };
    // Once semantic understanding has classified a non-live request, let the
    // LLM answer it directly. The legacy trip branch is intentionally reserved
    // for requests that need verified route/fare/provider data.
    const directIntents = new Set(["follow_up", "app_help", "vehicle_recommendation", "travel_timing", "general_travel", "ambiguous"]);
    const liveIntents = new Set(["route_information", "compare_fares", "cheapest_ride", "current_trip", "provider_status", "latest_comparison", "location_lookup", "service_identity", "future_fare_plan", "future_fare_follow_up"]);
    if (modelFirstEnabled() && directIntents.has(intent.intent) && !liveIntents.has(intent.intent)) {
      const direct = await qualityAwareAssistant.answer({ ...args, tripContext: null });
      return { ...direct, context: { ...(direct.context || {}), responseSource: direct.fallbackUsed ? "safe_fallback" : "llm_direct", fallbackReason: direct.fallbackUsed ? direct.errorCode || "llm_fallback" : null, semanticUnderstanding: semantic, semanticUnderstandingDiagnostics: semanticDiagnostics } };
    }
    const current = extractTripLocations(args.message);
    const recoveredSemantic = {
      ...(args.semanticUnderstanding || {}),
      pickup: current.pickup ? { query: current.pickup } : args.semanticUnderstanding?.pickup || null,
      destination: current.destination ? { query: current.destination } : args.semanticUnderstanding?.destination || null,
    };
    trip = recoveredSemantic.pickup && recoveredSemantic.destination
      ? await tripResolver({ message: resolverMessage, semantic: recoveredSemantic })
      : await buildConversationTripContext({ message: args.message, recentMessages: recent, tripResolver });
    if (trip.status === "NO_TRIP" && current.pickup && current.destination) trip = await tripResolver({ message: resolverMessage });
  }
  catch (error) { trip = { status: "UNRESOLVED", error: error.code || "TRIP_RESOLUTION_FAILED" }; }
  let comparison = null;
  if (args.comparisonId) comparison = await getPersistedComparisonForUser(args.comparisonId, args.userId);
  let grounding = decideGrounding({ trip, comparison });
  if (grounding.decision === DECISIONS.FARES_UNAVAILABLE && trip?.status === "NO_TRIP" && !grounding.comparisonId) {
    grounding = { decision: null, comparisonId: null };
  }
  if (grounding.decision === DECISIONS.LOCATION_UNRESOLVED) {
    const response = routeDecisionResponse({ trip, decision: grounding.decision, message: args.message, hadPreviousComparison: Boolean(args.comparisonId) });
    response.context = { ...(response.context || {}), semanticUnderstanding: semantic, semanticUnderstandingDiagnostics: semanticDiagnostics };
    return response;
  }
  if (grounding.decision === DECISIONS.ROUTE_CHANGED && args.comparisonId) {
    try {
      const vehicleType = trip.vehiclePreference || comparison?.vehicleType || "car";
      const fresh = await comparisonBuilder({
        userId: args.userId,
        pickup: trip.pickup,
        dropoff: trip.destination,
        vehicleType,
        route: trip.route,
      });
      if (fresh?.comparisonId) {
        grounding = { decision: DECISIONS.NEW_COMPARISON_READY, comparisonId: fresh.comparisonId };
        args = { ...args, comparisonId: fresh.comparisonId };
        comparison = fresh;
      } else {
        grounding = { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null };
      }
    } catch (error) {
      grounding = { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null, errorCode: error.code || "COMPARISON_UNAVAILABLE" };
    }
  } else if (grounding.decision === DECISIONS.ROUTE_CHANGED) {
    grounding = { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null };
  }
  if (grounding.decision === DECISIONS.FARES_UNAVAILABLE) {
    return routeDecisionResponse({ trip, decision: grounding.decision, message: args.message, hadPreviousComparison: Boolean(args.comparisonId) });
  }
  if (trip.status !== "NO_TRIP" && trip.extracted) {
    // An existing comparison is authoritative. Keep the established assistant
    // grounding path so fare facts and Book/Wait semantics are not replaced by
    // a route-only response.
    const structuredTrip = publicTripContext(trip);
    if (args.comparisonId) {
      const result = await qualityAwareAssistant.answer({ ...args, tripContext: structuredTrip });
      return withGroundingDecision(result, grounding);
    }
    const current = extractTripLocations(args.message);
    const routeReplyAllowed = trip.source === "current_message" || (current.pickup && current.destination);
    const reply = routeReplyAllowed ? routeReply(trip, routeResponseLanguage(args.message)) : null;
    if (reply) return withGroundingDecision({ reply, modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", context: { comparisonUsed: Boolean(args.comparisonId), comparisonFreshness: null, predictionAvailable: false, preferencesUsed: true, historyUsed: recent.length > 0, historyAvailable: recent.length > 0, trip: structuredTrip } }, grounding);
    return withGroundingDecision(await qualityAwareAssistant.answer({ ...args, tripContext: structuredTrip }), grounding);
  }
  return withGroundingDecision(await qualityAwareAssistant.answer({ ...args, tripContext: null }), grounding);
}

function setTripResolverForTests(resolver) { tripResolver = resolver || defaultTripResolver; }
function setComparisonBuilderForTests(builder) { comparisonBuilder = builder || compareFares; }
function withGroundingDecision(result, grounding) { return { ...result, comparisonId: grounding.comparisonId || null, groundingDecision: grounding.decision, context: { ...(result.context || {}), comparisonId: grounding.comparisonId || null, groundingDecision: grounding.decision } }; }
function routeDecisionResponse({ trip, decision, message, hadPreviousComparison = false }) {
  const language = routeResponseLanguage(message);
  const route = trip?.pickup && trip?.destination ? routeReply(trip, language) : null;
  const unresolvedField = trip?.unresolved === "pickup" ? "pickup" : trip?.unresolved === "destination" ? "destination" : "location";
  const unresolvedQuery = trip?.extracted?.[unresolvedField] || null;
  const unresolvedReason = trip?.unresolvedReason || null;
  const ambiguous = unresolvedReason === "AMBIGUOUS";
  const missing = language === "roman_urdu"
    ? ambiguous ? `Mujhe ${unresolvedQuery || unresolvedField} ke multiple matches mile. Iski city ya area bata dein.`
      : unresolvedReason ? `${unresolvedQuery || unresolvedField} ko map par verify nahi kar saka. Is location ka city ya area bata dein.`
      : unresolvedField === "pickup" ? "Kaunsi pickup location ya city use karun?"
        : unresolvedField === "destination" ? "Kaunsi destination location ya city use karun?"
        : "Aap kis location ya shehar mein travel kar rahe hain?"
    : ambiguous ? `I found multiple matches for ${unresolvedQuery || unresolvedField}. Which city or area do you mean?`
      : unresolvedReason ? `I couldn't verify ${unresolvedQuery || unresolvedField} on the map. Which city or area should I use?`
      : unresolvedField === "pickup" ? "Which pickup location or city do you mean?"
        : unresolvedField === "destination" ? "Which destination location or city do you mean?"
        : "Which location or city do you mean?";
  const fallback = decision === DECISIONS.LOCATION_UNRESOLVED
    ? missing
    : hadPreviousComparison
      ? (language === "roman_urdu" ? "Nayi route ke liye verified fares abhi available nahi hain. Purani comparison is route par apply nahi hoti." : "Verified fares are not available for this new route yet. The previous comparison does not apply to it.")
      : (language === "roman_urdu" ? "Is route ke liye verified fares abhi available nahi hain." : "Verified fares are not available for this route yet.");
  return { reply: route && decision === DECISIONS.FARES_UNAVAILABLE ? `${route}\n\n${fallback}` : fallback, modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", groundingDecision: decision, context: { comparisonUsed: false, comparisonFreshness: null, predictionAvailable: false, preferencesUsed: true, historyUsed: false, historyAvailable: false, groundingDecision: decision, trip: trip ? publicTripContext(trip) : null } };
}

module.exports = { ...base, answer: require("./ai/chatOrchestrator.service").answer, legacyAnswer, oneShotFuturePlan, routeReply, routeResponseLanguage, serviceIdentityReply, liveFareToolReply, setTripResolverForTests, setComparisonBuilderForTests, routeDecisionResponse, fareRoutePayload, modelFirstEnabled, modelToolsEnabled, FAIRFARE_POLICY };
