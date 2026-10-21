const { query: defaultQuery, withTransaction: defaultWithTransaction } = require("../../config/postgres");
const history = require("../history.service");

const SUMMARY_TTL_DAYS = 30;
const CONTEXT_TTL_MINUTES = 30;
const MAX_SUMMARY_LENGTH = 8000;
const SECRET_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|credential|jwt|bearer)/i;
const SERVICE_PATTERN = /\b(?:service|code|ride\s*type|order\s*type)\s*#?\s*([a-z0-9_-]+)/i;
const PROVIDER_PATTERN = /\b(indrive|in\s*drive|yango|bykea)\b/i;

let queryFn = defaultQuery;
let transactionFn = defaultWithTransaction;
let historyReader = history;

function safeMessage(value, max = 280) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\b(?:Bearer\s+)?[A-Za-z0-9._-]{24,}\b/g, "[redacted]").trim();
  return SECRET_PATTERN.test(text) ? "[redacted sensitive content]" : text.slice(0, max);
}

function conservativeSummary(messages = []) {
  const userMessages = messages.filter((item) => String(item?.role || "").toUpperCase() === "USER");
  const serviceCodes = [...new Set(userMessages.map((item) => String(item.content || "").match(SERVICE_PATTERN)?.[1]).filter(Boolean).map(String))].slice(0, 10);
  const providers = [...new Set(userMessages.map((item) => String(item.content || "").match(PROVIDER_PATTERN)?.[1]).filter(Boolean).map((value) => value.toLowerCase().replace(/\s+/g, "")))].slice(0, 10);
  const unresolved = userMessages.map((item) => safeMessage(item.content)).filter((value) => value && /\?|\b(?:what|why|which|how|kya|kaise|kon|konsi|kitna|batao)\b/i.test(value)).slice(-3);
  const topics = [...new Set(userMessages.flatMap((item) => {
    const text = String(item.content || "").toLowerCase();
    return [
      /\b(?:fare|price|kiraya|sasti|sasta|cheapest)\b/.test(text) ? "fare" : null,
      /\b(?:route|from|to|pickup|dropoff|destination|raasta|manzil)\b/.test(text) ? "route" : null,
      /\b(?:service|code|gari|gaari|vehicle)\b/.test(text) ? "service_identity" : null,
      /\b(?:available|unavailable|status)\b/.test(text) ? "provider_status" : null,
      /\b(?:app|location|map|change)\b/.test(text) ? "app_help" : null,
    ].filter(Boolean);
  }))];
  const lines = [
    "Memory is a conservative user-context summary; it is not proof of live fares or provider availability.",
    topics.length ? `User topics: ${topics.join(", ")}.` : "User topics: unspecified.",
    serviceCodes.length ? `Referenced service ${serviceCodes.join(", ")}; identity must be verified from an authorized comparison.` : "Referenced service codes: none.",
    providers.length ? `Referenced providers: ${providers.join(", ")}; provider status must be checked separately.` : "Referenced providers: none.",
    unresolved.length ? `Unresolved user questions: ${unresolved.join(" | ")}` : "Unresolved user questions: none captured.",
  ];
  return lines.join("\n").slice(0, MAX_SUMMARY_LENGTH);
}

async function authorizedComparison(userId, comparisonId) {
  if (!comparisonId) return null;
  return historyReader.getHistoryById(comparisonId, userId);
}

async function resolveComparisonReference({ userId, explicitComparisonId = null, memory = null } = {}) {
  if (explicitComparisonId) return (await authorizedComparison(userId, explicitComparisonId)) ? String(explicitComparisonId) : null;
  const current = memory?.context?.current_comparison_id;
  if (current && await authorizedComparison(userId, current)) return String(current);
  const candidates = [...new Set((memory?.comparisonRefs || []).map((item) => item.comparison_id).filter(Boolean).map(String))];
  const authorized = [];
  for (const comparisonId of candidates) if (await authorizedComparison(userId, comparisonId)) authorized.push(comparisonId);
  if (authorized.length === 1) return authorized[0];
  return null;
}

async function saveContext({ userId, conversationId, currentComparisonId = null, savedRouteId = null, pickupPlaceId = null, destinationPlaceId = null, activeProviderId = null, activeServiceCode = null, routeDistanceMeters = null, routeDurationSeconds = null, expiresAt = null } = {}) {
  if (currentComparisonId && !(await authorizedComparison(userId, currentComparisonId))) return { status: "COMPARISON_NOT_FOUND" };
  if (savedRouteId) {
    const savedRoute = await queryFn("SELECT id FROM saved_routes WHERE id=$1 AND user_id=$2", [savedRouteId, userId]);
    if (!savedRoute.rows[0]) return { status: "SAVED_ROUTE_NOT_FOUND" };
  }
  const expiry = expiresAt || new Date(Date.now() + CONTEXT_TTL_MINUTES * 60 * 1000);
  const result = await queryFn(
    `INSERT INTO ai_conversation_context
      (conversation_id, user_id, current_comparison_id, saved_route_id, pickup_place_id, destination_place_id,
       active_provider_id, active_service_code, route_distance_meters, route_duration_seconds, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (conversation_id) DO UPDATE SET
       user_id=EXCLUDED.user_id, current_comparison_id=EXCLUDED.current_comparison_id,
       saved_route_id=EXCLUDED.saved_route_id, pickup_place_id=EXCLUDED.pickup_place_id,
       destination_place_id=EXCLUDED.destination_place_id, active_provider_id=EXCLUDED.active_provider_id,
       active_service_code=EXCLUDED.active_service_code, route_distance_meters=EXCLUDED.route_distance_meters,
       route_duration_seconds=EXCLUDED.route_duration_seconds, expires_at=EXCLUDED.expires_at, updated_at=now()
     WHERE ai_conversation_context.user_id=$2
     RETURNING conversation_id, user_id, current_comparison_id, saved_route_id, pickup_place_id,
       destination_place_id, active_provider_id, active_service_code, route_distance_meters,
       route_duration_seconds, expires_at, updated_at`,
    [conversationId, userId, currentComparisonId, savedRouteId, pickupPlaceId, destinationPlaceId, activeProviderId, activeServiceCode, routeDistanceMeters, routeDurationSeconds, expiry],
  );
  return result.rows[0] || { status: "CONTEXT_OWNERSHIP_CONFLICT" };
}

function planningSchemaEnabled() { return String(process.env.FAIRFARE_AI_PLANNING_CONTEXT_SCHEMA_VERIFIED || "false").toLowerCase() === "true"; }
async function savePlanningContext({ userId, conversationId, planningIntent = null, departureAt = null, departureTimezone = null, vehiclePreference = null, providerPreferences = [], forecastSource = null, forecastModelVersion = null } = {}) {
  if (!planningSchemaEnabled()) return { status: "PLANNING_CONTEXT_SCHEMA_UNAVAILABLE", durable: false };
  if (!userId || !conversationId) return { status: "PLANNING_CONTEXT_INVALID_OWNER", durable: false };
  try {
    const result = await queryFn(`UPDATE ai_conversation_context SET planning_intent=$3, departure_at=$4, departure_timezone=$5, vehicle_preference=$6, provider_preferences=$7, forecast_source=$8, forecast_model_version=$9, updated_at=now() WHERE conversation_id=$1 AND user_id=$2 RETURNING conversation_id, user_id, planning_intent, departure_at, departure_timezone, vehicle_preference, provider_preferences, forecast_source, forecast_model_version, updated_at`, [conversationId, userId, planningIntent, departureAt, departureTimezone, Array.isArray(providerPreferences) ? providerPreferences.slice(0, 10) : [], forecastSource, forecastModelVersion]);
    return result.rows[0] ? { status: "SAVED", durable: true, context: result.rows[0] } : { status: "PLANNING_CONTEXT_NOT_FOUND", durable: false };
  } catch (error) { if (["42703", "42P01"].includes(error.code)) return { status: "PLANNING_CONTEXT_SCHEMA_UNAVAILABLE", durable: false }; throw error; }
}

async function addComparisonReference({ userId, conversationId, messageId = null, comparisonId, referenceType = "used", providerId = null, serviceCode = null } = {}) {
  if (!["created", "used", "mentioned"].includes(referenceType)) return { status: "INVALID_REFERENCE_TYPE" };
  if (!(await authorizedComparison(userId, comparisonId))) return { status: "COMPARISON_NOT_FOUND" };
  if (messageId) {
    const message = await queryFn("SELECT m.id FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.conversation_id=$2 AND c.user_id=$3", [messageId, conversationId, userId]);
    if (!message.rows[0]) return { status: "MESSAGE_NOT_FOUND" };
  }
  const result = await queryFn(
    `INSERT INTO ai_conversation_comparison_refs
      (conversation_id, user_id, message_id, comparison_id, reference_type, provider_id, service_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (conversation_id, message_id, comparison_id, reference_type) DO UPDATE SET
       provider_id=EXCLUDED.provider_id, service_code=EXCLUDED.service_code
     RETURNING id, conversation_id, user_id, comparison_id, reference_type, provider_id, service_code, created_at`,
    [conversationId, userId, messageId, comparisonId, referenceType, providerId, serviceCode],
  );
  return result.rows[0];
}

async function getMemory({ userId, conversationId, maxSummaries = 2, maxReferences = 10 } = {}) {
  const [context, summaries, references] = await Promise.all([
    queryFn("SELECT * FROM ai_conversation_context WHERE conversation_id=$1 AND user_id=$2 AND (expires_at IS NULL OR expires_at > now())", [conversationId, userId]),
    queryFn("SELECT id, summary_text, summary_version, covered_through_message_id, covered_through_created_at, source_message_count, expires_at, created_at FROM ai_conversation_summaries WHERE conversation_id=$1 AND user_id=$2 AND expires_at > now() ORDER BY summary_version DESC LIMIT $3", [conversationId, userId, Math.max(1, Math.min(3, maxSummaries))]),
    queryFn("SELECT id, comparison_id, reference_type, provider_id, service_code, created_at FROM ai_conversation_comparison_refs WHERE conversation_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT $3", [conversationId, userId, Math.max(1, Math.min(20, maxReferences))]),
  ]);
  return { context: context.rows[0] || null, summaries: summaries.rows, comparisonRefs: references.rows };
}

async function saveSummary({ userId, conversationId, messages = [], coveredThroughMessageId = null, coveredThroughCreatedAt = null, sourceMessageCount = messages.length, summaryVersion = 1, expiresAt = null } = {}) {
  const summaryText = conservativeSummary(messages);
  if (!summaryText || !coveredThroughMessageId) return { status: "SUMMARY_SKIPPED", reason: "MISSING_BOUNDARY" };
  const expiry = expiresAt || new Date(Date.now() + SUMMARY_TTL_DAYS * 24 * 60 * 60 * 1000);
  const result = await queryFn(
    `INSERT INTO ai_conversation_summaries
      (conversation_id, user_id, summary_text, summary_version, covered_through_message_id,
       covered_through_created_at, source_message_count, expires_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8
      WHERE EXISTS (SELECT 1 FROM ai_conversations WHERE id=$1 AND user_id=$2)
        AND EXISTS (SELECT 1 FROM ai_messages WHERE id=$5 AND conversation_id=$1)
        AND NOT EXISTS (
          SELECT 1 FROM ai_conversation_summaries newer
           WHERE newer.conversation_id=$1 AND newer.user_id=$2
             AND (newer.covered_through_created_at > $6
               OR (newer.covered_through_created_at = $6 AND newer.summary_version >= $4))
        )
     ON CONFLICT (conversation_id, summary_version) DO NOTHING
     RETURNING id, conversation_id, user_id, summary_version, covered_through_message_id,
       covered_through_created_at, source_message_count, expires_at, created_at`,
    [conversationId, userId, summaryText, summaryVersion, coveredThroughMessageId, coveredThroughCreatedAt, sourceMessageCount, expiry],
  );
  return result.rows[0] || { status: "SUMMARY_NOT_SAVED", reason: "STALE_OR_DUPLICATE_VERSION" };
}

async function summarizeOlderMessages({ userId, conversationId, recentLimit = 12 } = {}) {
  const older = await queryFn("SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id=$1 AND EXISTS (SELECT 1 FROM ai_conversations WHERE id=$1 AND user_id=$2) ORDER BY created_at DESC, id DESC OFFSET $3 LIMIT 100", [conversationId, userId, Math.max(1, Math.min(50, recentLimit))]);
  if (!older.rows.length) return { status: "SUMMARY_NOT_NEEDED" };
  const ordered = older.rows.slice().reverse();
  const boundary = ordered[ordered.length - 1];
  const latest = await queryFn("SELECT summary_version, covered_through_created_at FROM ai_conversation_summaries WHERE conversation_id=$1 AND user_id=$2 ORDER BY summary_version DESC LIMIT 1", [conversationId, userId]);
  const previous = latest.rows[0];
  if (previous?.covered_through_created_at && boundary.created_at && new Date(previous.covered_through_created_at).getTime() >= new Date(boundary.created_at).getTime()) return { status: "SUMMARY_ALREADY_COVERS_BOUNDARY", summaryVersion: previous.summary_version };
  return saveSummary({ userId, conversationId, messages: ordered, coveredThroughMessageId: boundary.id, coveredThroughCreatedAt: boundary.created_at, sourceMessageCount: ordered.length, summaryVersion: Number(previous?.summary_version || 0) + 1 });
}

function setQueryForTests(fn) { queryFn = fn || defaultQuery; }
function setTransactionForTests(fn) { transactionFn = fn || defaultWithTransaction; }
function setHistoryReaderForTests(reader) { historyReader = reader || history; }
function resetMemoryDependenciesForTests() { queryFn = defaultQuery; transactionFn = defaultWithTransaction; historyReader = history; }

module.exports = { conservativeSummary, authorizedComparison, resolveComparisonReference, saveContext, savePlanningContext, planningSchemaEnabled, addComparisonReference, getMemory, saveSummary, summarizeOlderMessages, setQueryForTests, setTransactionForTests, setHistoryReaderForTests, resetMemoryDependenciesForTests, SUMMARY_TTL_DAYS, CONTEXT_TTL_MINUTES, MAX_SUMMARY_LENGTH };
