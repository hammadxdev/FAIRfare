const { schemas } = require("./toolSchemas");
const { getHistory } = require("../history.service");
const { getPersistedComparisonForUser } = require("../currentComparison.service");
const { lookupProviderService } = require("./serviceIdentityResolver.service");
const conversations = require("./conversation.service");
const { extractTripLocations } = require("../tripExtraction.service");
const maps = require("../maps/geoapifyMaps.service");
const { compareFares } = require("../fare.service");
const providers = require("../../providers/provider.registry");
const { retrieveKnowledge } = require("./knowledgeRetrieval.service");
const { planTrip } = require("./tripPlanner.service");
const { forecastFare } = require("./fareForecast.service");
const { normalizeVehicleType } = require("../vehicleType.service");
const { readHistoricalFareEvidence, deriveTimeFeatures } = require("../fareObservation.service");
const { readNearbyObservationContext } = require("../nearbyObservation.service");
const { normalizeCandidate, selectCandidate } = require("../tripResolution.service");
const { planLahoreTransit } = require("../transit/lahoreTransit.service");

let deps = { getHistory, getPersistedComparisonForUser, lookupProviderService, conversations, extractTripLocations, maps, compareFares, providers, retrieveKnowledge, readNearbyObservationContext, readHistoricalFareEvidence, deriveFareTimeFeatures: deriveTimeFeatures };
const MAX_RESULT_ITEMS = 20;
function phase3SchemaVerified() { return String(process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED || "false").toLowerCase() === "true"; }
function knowledgeEnabled() { return phase3SchemaVerified() && String(process.env.FAIRFARE_AI_KNOWLEDGE_ENABLED || "false").toLowerCase() === "true"; }
function nearbyHistoryEnabled() { return String(process.env.FAIRFARE_AI_NEARBY_HISTORY_ENABLED || "false").toLowerCase() === "true"; }

function currentRealQuote(result, now = Date.now()) {
  if (!result || result.dataSource !== "REAL" || String(result.source || "").toLowerCase() !== "live" || result.isAvailable !== true) return null;
  const fare = Number(result.fare);
  if (!Number.isFinite(fare) || fare <= 0) return null;
  const metadata = result.metadata || {};
  const expiry = metadata.providerExpiresAt == null ? NaN : Date.parse(metadata.providerExpiresAt);
  const created = metadata.providerCreatedAt == null ? NaN : Date.parse(metadata.providerCreatedAt);
  const ttl = Number(metadata.providerTtlSeconds);
  const derivedExpiry = Number.isFinite(created) && Number.isFinite(ttl) && ttl >= 0 ? created + ttl * 1000 : NaN;
  const expiresAt = Number.isFinite(expiry) ? expiry : derivedExpiry;
  const explicitlyCurrent = String(metadata.providerFreshness || "").toLowerCase() === "current";
  if (Number.isFinite(expiresAt) ? expiresAt <= now : !explicitlyCurrent) return null;
  if (String(metadata.providerFreshness || "").toLowerCase() === "expired") return null;
  const providerName = String(result.provider?.name || result.provider?.id || "").toLowerCase();
  const providerLabel = String(result.provider?.displayName || "").toLowerCase();
  return {
    provider: result.provider?.displayName || result.provider?.name || result.provider?.id || "Provider",
    providerId: result.provider?.name || result.provider?.id || null,
    serviceName: result.providerServiceName || result.quotes?.[0]?.providerServiceName || null,
    serviceCode: result.service_code || result.quotes?.[0]?.service_code || null,
    category: result.vehicleCategory || result.quotes?.[0]?.vehicleCategory || result.quotes?.[0]?.categoryName || null,
    fare,
    currency: result.currency || result.quotes?.[0]?.currency || "PKR",
    // For inDrive this is inDrive's own route, which can differ slightly from our road route.
    ...(Number(result.quotes?.[0]?.distanceMeters) > 0 && Number(result.quotes?.[0]?.tripDurationSeconds) > 0 ? { providerRoute: { distanceMeters: Number(result.quotes[0].distanceMeters), durationSeconds: Number(result.quotes[0].tripDurationSeconds) } } : {}),
    source: "REAL",
    freshness: "current",
    ...(Number.isFinite(expiresAt) ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    ...(providerName === "indrive" || providerLabel.includes("indrive") ? { fareSemantics: "Suggested fare — not an offer from an inDrive driver." } : {}),
  };
}

function currentRealComparison(comparison) {
  const rawResults = Array.isArray(comparison?.results) ? comparison.results : [];
  const quotes = rawResults.map((item) => currentRealQuote(item)).filter(Boolean);
  const safeProviderMode = (value) => {
    const mode = String(value || "unknown").toLowerCase();
    return ["simulated", "real", "authorized-live", "unavailable", "unknown"].includes(mode) ? mode : "unknown";
  };
  const safeProviderStatus = (value) => {
    const status = String(value || "unknown").toLowerCase();
    return ["available", "ready", "unavailable", "not_configured", "auth_required", "temporarily_unavailable", "unknown"].includes(status) ? status : "unknown";
  };
  const diagnostics = {
    realLiveCurrentQuoteCount: quotes.length,
    simulatedQuoteCount: rawResults.filter((item) => String(item?.dataSource || item?.source || "").toUpperCase() === "SIMULATED").length,
    unavailableQuoteCount: rawResults.filter((item) => item?.isAvailable !== true || !currentRealQuote(item)).length,
    providerModesStatuses: (Array.isArray(comparison?.providerModesStatuses) ? comparison.providerModesStatuses : rawResults.map((item) => ({
      provider: String(item?.provider?.name || item?.provider?.id || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "unknown",
      mode: safeProviderMode(item?.mode || item?.provider?.mode || (item?.dataSource === "REAL" ? "real" : item?.dataSource === "SIMULATED" ? "simulated" : "unavailable")),
      status: safeProviderStatus(item?.status || (item?.isAvailable === true ? "available" : "unavailable")),
    }))).map((item) => ({ provider: String(item.provider || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "unknown", mode: safeProviderMode(item.mode), status: safeProviderStatus(item.status) })),
  };
  return quotes.length ? { status: "OK", source: "REAL_PROVIDER_QUOTES", comparisonId: comparison.comparisonId || null, searchedAt: comparison.searchedAt || null, quotes, diagnostics } : { status: "UNAVAILABLE", reason: "NO_CURRENT_VERIFIED_REAL_PROVIDER_QUOTES", quotes: [], diagnostics };
}

function unavailableForecast(status, reason, evidenceCount = 0) {
  return { status, sourceType: "unavailable", quoteType: "HISTORICAL_ESTIMATE_NOT_LIVE_QUOTE", evidenceCount, reason, limitations: ["Historical evidence may not represent current provider pricing.", "No future provider fare is guaranteed."] };
}

function forecastFromHistoricalEvidence(args, ctx = {}) {
  return (async () => {
    const trip = ctx.resolvedTrip;
    const city = typeof trip?.city === "string" ? trip.city.trim() : "";
    const distanceMeters = Number(trip?.route?.distanceMeters);
    const durationSeconds = Number(trip?.route?.durationSeconds);
    const forecastTime = Date.parse(args.forecastAt);
    if (trip?.status !== "RESOLVED" || !city || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return unavailableForecast("INSUFFICIENT_DATA", "VERIFIED_ROUTE_CONTEXT_REQUIRED");
    }
    if (!Number.isFinite(forecastTime)) return unavailableForecast("INSUFFICIENT_DATA", "VALID_FORECAST_TIME_REQUIRED");

    const providerId = String(args.providerId).toLowerCase();
    if (!["indrive", "yango", "bykea"].includes(providerId)) return unavailableForecast("INSUFFICIENT_DATA", "SUPPORTED_PROVIDER_REQUIRED");
    const vehicleCategory = normalizeVehicleType({ provider: providerId, requestedVehicleType: args.vehicleType });
    if (!vehicleCategory || vehicleCategory === "UNKNOWN") return unavailableForecast("INSUFFICIENT_DATA", "SUPPORTED_VEHICLE_CATEGORY_REQUIRED");

    const forecastAt = new Date(forecastTime).toISOString();
    const dataCutoff = new Date();
    const { hourOfDay, dayOfWeek } = deps.deriveFareTimeFeatures(forecastAt);
    let evidence;
    try {
      evidence = await deps.readHistoricalFareEvidence({ providerId, vehicleCategory, city, hourOfDay, dayOfWeek, distanceMeters, durationSeconds, dataCutoff, limit: 100 });
    } catch {
      return unavailableForecast("UNAVAILABLE", "HISTORICAL_EVIDENCE_QUERY_FAILED");
    }
    if (!evidence || evidence.status === "UNAVAILABLE") return unavailableForecast("UNAVAILABLE", evidence?.reason || "HISTORICAL_EVIDENCE_UNAVAILABLE");
    if (evidence.status !== "OK") return unavailableForecast("INSUFFICIENT_DATA", evidence.reason || "INSUFFICIENT_COMPARABLE_REAL_OBSERVATIONS", Array.isArray(evidence.evidence) ? evidence.evidence.length : 0);
    const cutoffMs = dataCutoff.getTime();
    const earliestMs = cutoffMs - 180 * 86_400_000;
    const eligible = (Array.isArray(evidence.evidence) ? evidence.evidence : []).filter((item) => {
      const observedAt = Date.parse(item?.observedAt);
      const fare = Number(item?.fare);
      return item?.dataSource === "REAL" && item?.sourceType === "historical_observation"
        && item.providerId === providerId && item.vehicleCategory === vehicleCategory
        && String(item.city || "").toLowerCase() === city.toLowerCase()
        && Number.isFinite(fare) && fare >= 0
        && Number.isFinite(observedAt) && observedAt <= cutoffMs && observedAt >= earliestMs
        && Number.isFinite(Number(item.distanceMeters)) && Number(item.distanceMeters) >= distanceMeters * 0.75 && Number(item.distanceMeters) <= distanceMeters * 1.25
        && Number.isFinite(Number(item.durationSeconds)) && Number(item.durationSeconds) >= durationSeconds * 0.75 && Number(item.durationSeconds) <= durationSeconds * 1.25
        && Number(item.dayOfWeek) === dayOfWeek && Math.abs(Number(item.hourOfDay) - hourOfDay) <= 1;
    });
    if (eligible.length < 5) return unavailableForecast("INSUFFICIENT_DATA", evidence.reason || "INSUFFICIENT_COMPARABLE_REAL_OBSERVATIONS", eligible.length);

    const forecast = forecastFare({ observations: eligible, providerId, vehicleType: vehicleCategory, city, forecastAt, dataCutoff });
    return {
      ...forecast,
      quoteType: "HISTORICAL_ESTIMATE_NOT_LIVE_QUOTE",
      evidenceCount: eligible.length,
      evidenceProvenance: "REAL fare_observations from PostgreSQL; bounded historical query",
      limitations: ["Historical estimates are not Live Quotes.", "Historical coverage, route matching and market changes can affect accuracy.", "No future provider fare is guaranteed."],
    };
  })();
}

function publicComparison(comparison) {
  if (!comparison) return null;
  return { comparisonId: comparison.comparisonId || comparison.id, searchedAt: comparison.searchedAt || null, enrichmentStatus: comparison.enrichmentStatus || "unknown", pickup: comparison.pickup ? { label: comparison.pickup.label || comparison.pickup.name || null } : null, destination: comparison.destination || comparison.dropoff ? { label: (comparison.destination || comparison.dropoff).label || (comparison.destination || comparison.dropoff).name || null } : null, route: comparison.route || null, quotes: (comparison.quotes || []).slice(0, MAX_RESULT_ITEMS).map((quote) => ({ provider: quote.providerDisplayName || quote.provider || null, serviceCode: quote.serviceCode || null, serviceName: quote.providerServiceName || null, category: quote.verifiedVehicleCategory || quote.category || null, fare: quote.fare ?? null, fareMin: quote.fareMin ?? null, fareMax: quote.fareMax ?? null, currency: quote.currency || null, availability: quote.availability || "unknown", sourceType: quote.sourceType || "historical", freshness: quote.quoteFreshness || "unknown" })) };
}

function definitions() {
  return {
    get_current_trip: { name: "get_current_trip", schema: schemas.get_current_trip, mayCallProvider: false, mayMutateState: false, timeoutMs: 750, execute: async (args, ctx) => { const messages = await deps.conversations.recentMessages(ctx.userId, args.conversationId || ctx.conversationId); const last = [...messages].reverse().map((item) => deps.extractTripLocations(item.content)).find((item) => item.pickup || item.destination); return { status: "OK", trip: last || { pickup: null, destination: null } }; } },
    get_latest_comparison: { name: "get_latest_comparison", schema: schemas.get_latest_comparison, mayCallProvider: false, mayMutateState: false, timeoutMs: 1500, execute: async (args, ctx) => { const comparison = args.comparisonId ? await deps.getPersistedComparisonForUser(args.comparisonId, ctx.userId) : (await deps.getHistory({ userId: ctx.userId, limit: 1, offset: 0 }))[0] || null; return { status: comparison ? "OK" : "NOT_FOUND", comparison: publicComparison(comparison) }; } },
    lookup_provider_service: { name: "lookup_provider_service", schema: schemas.lookup_provider_service, mayCallProvider: false, mayMutateState: false, timeoutMs: 1500, execute: async (args, ctx) => deps.lookupProviderService({ userId: ctx.userId, comparisonId: args.comparisonId || ctx.comparisonId || null, provider: args.provider || null, serviceCode: args.serviceCode || null }) },
    search_locations: { name: "search_locations", schema: schemas.search_locations, mayCallProvider: true, mayMutateState: false, timeoutMs: 3000, execute: async (args) => { const candidates = (await deps.maps.fetchAutocomplete({ input: args.cityHint ? `${args.query}, ${args.cityHint}` : args.query })) || []; const usable = candidates.map((item) => normalizeCandidate(item, args.query)).filter(Boolean); const selection = selectCandidate(args.query, usable, { preferredCity: args.cityHint || null }); const ranked = [...usable].sort((a, b) => { const aName = String(a.name || "").toLowerCase(); const bName = String(b.name || "").toLowerCase(); const query = String(args.query || "").toLowerCase(); const score = (item, name) => (item.resolutionType === "unrelated_business" ? -10000 : 0) + (name.includes(query) ? 1000 : 0) + (item.resolutionType === "verified_named_landmark" ? 100 : item.resolutionType === "approximate_representative_area" ? 80 : 0) + (Number(item.confidence) || 0); return score(b, bName) - score(a, aName); }).slice(0, 6); return { status: "OK", candidates: ranked.map((normalized) => ({ name: normalized.name, address: normalized.address, placeId: normalized.placeId, lat: normalized.lat, lng: normalized.lng, city: normalized.city, approximate: normalized.approximate, resolutionType: normalized.resolutionType, candidateType: normalized.candidateType })) , diagnostics: { sourceCandidateCount: candidates.length, returnedCandidateCount: ranked.length, selectedResolutionType: selection.location?.resolutionType || null, ambiguous: selection.ambiguous, hasVerifiedCandidate: ranked.some((item) => item.resolutionType === "verified_named_landmark") } }; } },
    calculate_route: { name: "calculate_route", schema: schemas.calculate_route, mayCallProvider: true, mayMutateState: false, timeoutMs: 3500, execute: async (args) => { const route = await deps.maps.computeRoute({ origin: args.pickup, destination: args.dropoff }); return { status: route?.unavailable ? "UNAVAILABLE" : "OK", route: route || null }; } },
  plan_lahore_transit: { name: "plan_lahore_transit", schema: schemas.plan_lahore_transit, mayCallProvider: false, mayMutateState: false, timeoutMs: 750, execute: async (args) => planLahoreTransit({ origin: args.origin, destination: args.destination, originName: args.originName || args.origin.name, destinationName: args.destinationName || args.destination.name }) },
  compare_live_fares: { name: "compare_live_fares", schema: schemas.compare_live_fares, mayCallProvider: true, mayMutateState: true, timeoutMs: 11000, execute: async (args, ctx) => { if (ctx.liveComparisonEnabled !== true || args.explicitComparisonIntent !== true || ctx.explicitComparisonIntent !== true) return { status: "LIVE_COMPARISON_DISABLED" }; const comparison = await deps.compareFares({ userId: ctx.userId, pickup: args.pickup, dropoff: args.dropoff, vehicleType: args.vehicleType || "car", route: args.route || null }); return currentRealComparison(comparison); } },
    get_provider_status: { name: "get_provider_status", schema: schemas.get_provider_status, mayCallProvider: false, mayMutateState: false, timeoutMs: 1000, execute: async (args) => { const statuses = await deps.providers.getProviderStatus(); const filtered = args.provider ? statuses.filter((item) => deps.providers.canonicalProviderId(args.provider) === item.id) : statuses; return { status: "OK", providers: filtered.slice(0, MAX_RESULT_ITEMS).map((item) => ({ id: item.id, enabled: item.enabled, status: item.status })) }; } },
    get_nearby_observation_context: { name: "get_nearby_observation_context", schema: schemas.get_nearby_observation_context, mayCallProvider: false, mayMutateState: false, disabled: !nearbyHistoryEnabled(), timeoutMs: 1500, execute: async (args) => deps.readNearbyObservationContext({ latitude: args.pickup.lat, longitude: args.pickup.lng, category: args.category, provider: args.provider || null }) },
    get_app_capabilities: { name: "get_app_capabilities", schema: schemas.get_app_capabilities, mayCallProvider: false, mayMutateState: false, timeoutMs: 500, execute: async () => ({ status: "OK", capabilities: { rideComparison: true, routeCalculation: true, locationSearch: true, supportedVehicleTypes: ["car", "bike", "rickshaw"], liveComparisonEnabled: String(process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED || "false").toLowerCase() === "true" } }) },
    get_conversation_context: { name: "get_conversation_context", schema: schemas.get_conversation_context, mayCallProvider: false, mayMutateState: false, timeoutMs: 1500, execute: async (args, ctx) => ({ status: "OK", messages: (await deps.conversations.recentMessages(ctx.userId, args.conversationId)).slice(-args.maxMessages).map((item) => ({ role: item.role, content: String(item.content || "").slice(0, 1000) })) }) },
    search_fairride_knowledge: { name: "search_fairride_knowledge", schema: schemas.search_fairride_knowledge, mayCallProvider: false, mayMutateState: false, disabled: !knowledgeEnabled(), timeoutMs: 1000, execute: async (args) => { const result = await deps.retrieveKnowledge({ message: args.query, language: args.language, topic: args.topic, limit: 5 }); return { status: result.status, evidence: result.evidence.map((item) => ({ chunkId: item.chunkId, documentId: item.documentId, body: String(item.body || "").slice(0, 1200), score: item.score, source: item.source })) }; } },
    plan_trip: { name: "plan_trip", schema: schemas.plan_trip, mayCallProvider: false, mayMutateState: false, disabled: String(process.env.FAIRFARE_AI_TRIP_PLANNER_ENABLED || process.env.FAIRRIDE_AI_TRIP_PLANNER_ENABLED || "false").toLowerCase() !== "true", timeoutMs: 750, execute: async (args) => planTrip({ message: args.message, requestTimestamp: args.requestTimestamp || new Date(), timezone: args.timezone || undefined, context: args.context || {} }) },
    forecast_fare: { name: "forecast_fare", schema: schemas.forecast_fare, mayCallProvider: false, mayMutateState: false, disabled: String(process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED || process.env.FAIRRIDE_AI_FARE_FORECAST_ENABLED || "false").toLowerCase() !== "true", timeoutMs: 5500, execute: forecastFromHistoricalEvidence },
  };
}

function normalizedTimeout(tool) { return ["search_locations", "compare_live_fares"].includes(tool.name) ? { ...tool, timeoutMs: 30000 } : tool; }
function getTool(name) { const tool = definitions()[name] || null; return tool ? normalizedTimeout(tool) : null; }
function listTools({ includeDisabled = false } = {}) { return Object.values(definitions()).filter((tool) => includeDisabled || !tool.disabled).map(normalizedTimeout); }
function setToolDependenciesForTests(overrides = {}) { deps = { ...deps, ...overrides }; }
function resetToolDependenciesForTests() { deps = { getHistory, getPersistedComparisonForUser, lookupProviderService, conversations, extractTripLocations, maps, compareFares, providers, retrieveKnowledge, readNearbyObservationContext, readHistoricalFareEvidence, deriveFareTimeFeatures: deriveTimeFeatures }; }

module.exports = { getTool, listTools, setToolDependenciesForTests, resetToolDependenciesForTests, publicComparison, currentRealQuote, currentRealComparison };
