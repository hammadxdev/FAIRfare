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

let deps = { getHistory, getPersistedComparisonForUser, lookupProviderService, conversations, extractTripLocations, maps, compareFares, providers, retrieveKnowledge };
const MAX_RESULT_ITEMS = 20;
function phase3SchemaVerified() { return String(process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED || "false").toLowerCase() === "true"; }
function knowledgeEnabled() { return phase3SchemaVerified() && String(process.env.FAIRFARE_AI_KNOWLEDGE_ENABLED || "false").toLowerCase() === "true"; }

function publicComparison(comparison) {
  if (!comparison) return null;
  return { comparisonId: comparison.comparisonId || comparison.id, searchedAt: comparison.searchedAt || null, enrichmentStatus: comparison.enrichmentStatus || "unknown", pickup: comparison.pickup ? { label: comparison.pickup.label || comparison.pickup.name || null } : null, destination: comparison.destination || comparison.dropoff ? { label: (comparison.destination || comparison.dropoff).label || (comparison.destination || comparison.dropoff).name || null } : null, route: comparison.route || null, quotes: (comparison.quotes || []).slice(0, MAX_RESULT_ITEMS).map((quote) => ({ provider: quote.providerDisplayName || quote.provider || null, serviceCode: quote.serviceCode || null, serviceName: quote.providerServiceName || null, category: quote.verifiedVehicleCategory || quote.category || null, fare: quote.fare ?? null, fareMin: quote.fareMin ?? null, fareMax: quote.fareMax ?? null, currency: quote.currency || null, availability: quote.availability || "unknown", sourceType: quote.sourceType || "historical", freshness: quote.quoteFreshness || "unknown" })) };
}

function definitions() {
  return {
    get_current_trip: { name: "get_current_trip", schema: schemas.get_current_trip, mayCallProvider: false, mayMutateState: false, timeoutMs: 750, execute: async (args, ctx) => { const messages = await deps.conversations.recentMessages(ctx.userId, args.conversationId || ctx.conversationId); const last = [...messages].reverse().map((item) => deps.extractTripLocations(item.content)).find((item) => item.pickup || item.destination); return { status: "OK", trip: last || { pickup: null, destination: null } }; } },
    get_latest_comparison: { name: "get_latest_comparison", schema: schemas.get_latest_comparison, mayCallProvider: false, mayMutateState: false, timeoutMs: 1500, execute: async (args, ctx) => { const comparison = args.comparisonId ? await deps.getPersistedComparisonForUser(args.comparisonId, ctx.userId) : (await deps.getHistory({ userId: ctx.userId, limit: 1, offset: 0 }))[0] || null; return { status: comparison ? "OK" : "NOT_FOUND", comparison: publicComparison(comparison) }; } },
    lookup_provider_service: { name: "lookup_provider_service", schema: schemas.lookup_provider_service, mayCallProvider: false, mayMutateState: false, timeoutMs: 1500, execute: async (args, ctx) => deps.lookupProviderService({ userId: ctx.userId, comparisonId: args.comparisonId || ctx.comparisonId || null, provider: args.provider || null, serviceCode: args.serviceCode || null }) },
    search_locations: { name: "search_locations", schema: schemas.search_locations, mayCallProvider: true, mayMutateState: false, timeoutMs: 3000, execute: async (args) => { const candidates = await deps.maps.fetchAutocomplete({ input: args.cityHint ? `${args.query}, ${args.cityHint}` : args.query }); return { status: "OK", candidates: (candidates || []).slice(0, MAX_RESULT_ITEMS).map((item) => ({ name: item.mainText || item.name || item.description || null, address: item.address || item.secondaryText || item.description || null, placeId: item.placeId || null, lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null, lng: Number.isFinite(Number(item.lng)) ? Number(item.lng) : null, city: item.city || null })) }; } },
    calculate_route: { name: "calculate_route", schema: schemas.calculate_route, mayCallProvider: true, mayMutateState: false, timeoutMs: 3500, execute: async (args) => { const route = await deps.maps.computeRoute({ origin: args.pickup, destination: args.dropoff }); return { status: route?.unavailable ? "UNAVAILABLE" : "OK", route: route || null }; } },
    compare_live_fares: { name: "compare_live_fares", schema: schemas.compare_live_fares, mayCallProvider: true, mayMutateState: true, timeoutMs: 7000, execute: async (args, ctx) => { if (ctx.liveComparisonEnabled !== true || args.explicitComparisonIntent !== true || ctx.explicitComparisonIntent !== true) return { status: "LIVE_COMPARISON_DISABLED" }; return deps.compareFares({ userId: ctx.userId, pickup: args.pickup, dropoff: args.dropoff, vehicleType: args.vehicleType || "car", route: args.route || null }); } },
    get_provider_status: { name: "get_provider_status", schema: schemas.get_provider_status, mayCallProvider: false, mayMutateState: false, timeoutMs: 1000, execute: async (args) => { const statuses = await deps.providers.getProviderStatus(); const filtered = args.provider ? statuses.filter((item) => deps.providers.canonicalProviderId(args.provider) === item.id) : statuses; return { status: "OK", providers: filtered.slice(0, MAX_RESULT_ITEMS).map((item) => ({ id: item.id, enabled: item.enabled, status: item.status })) }; } },
    get_conversation_context: { name: "get_conversation_context", schema: schemas.get_conversation_context, mayCallProvider: false, mayMutateState: false, timeoutMs: 1500, execute: async (args, ctx) => ({ status: "OK", messages: (await deps.conversations.recentMessages(ctx.userId, args.conversationId)).slice(-args.maxMessages).map((item) => ({ role: item.role, content: String(item.content || "").slice(0, 1000) })) }) },
    search_fairride_knowledge: { name: "search_fairride_knowledge", schema: schemas.search_fairride_knowledge, mayCallProvider: false, mayMutateState: false, disabled: !knowledgeEnabled(), timeoutMs: 1000, execute: async (args) => { const result = await deps.retrieveKnowledge({ message: args.query, language: args.language, topic: args.topic, limit: 5 }); return { status: result.status, evidence: result.evidence.map((item) => ({ chunkId: item.chunkId, documentId: item.documentId, body: String(item.body || "").slice(0, 1200), score: item.score, source: item.source })) }; } },
    plan_trip: { name: "plan_trip", schema: schemas.plan_trip, mayCallProvider: false, mayMutateState: false, disabled: String(process.env.FAIRFARE_AI_TRIP_PLANNER_ENABLED || process.env.FAIRRIDE_AI_TRIP_PLANNER_ENABLED || "false").toLowerCase() !== "true", timeoutMs: 750, execute: async (args) => planTrip({ message: args.message, requestTimestamp: args.requestTimestamp || new Date(), timezone: args.timezone || undefined, context: args.context || {} }) },
    forecast_fare: { name: "forecast_fare", schema: schemas.forecast_fare, mayCallProvider: false, mayMutateState: false, disabled: String(process.env.FAIRFARE_AI_FARE_FORECAST_ENABLED || process.env.FAIRRIDE_AI_FARE_FORECAST_ENABLED || "false").toLowerCase() !== "true", timeoutMs: 750, execute: async (args, ctx) => forecastFare({ ...args, observations: [], generatedAt: args.forecastAt || new Date(), userId: ctx.userId }) },
  };
}

function getTool(name) { return definitions()[name] || null; }
function listTools({ includeDisabled = false } = {}) { return Object.values(definitions()).filter((tool) => includeDisabled || !tool.disabled); }
function setToolDependenciesForTests(overrides = {}) { deps = { ...deps, ...overrides }; }
function resetToolDependenciesForTests() { deps = { getHistory, getPersistedComparisonForUser, lookupProviderService, conversations, extractTripLocations, maps, compareFares, providers, retrieveKnowledge }; }

module.exports = { getTool, listTools, setToolDependenciesForTests, resetToolDependenciesForTests, publicComparison };
