const { query, withTransaction } = require("../config/postgres");

const SENSITIVE_KEY = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|cookie|session|credential|device|phone|account|profile|signature)/i;
const SAFE_ERROR_CODES = new Set(["AUTH_ERROR", "BAD_REQUEST", "FORBIDDEN", "RATE_LIMITED", "UPSTREAM_ERROR", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "NO_VALID_TARIFFS", "PROVIDER_UNAVAILABLE", "PROVIDER_BAD_RESPONSE", "LIVE_INTEGRATION_NOT_CONFIGURED"]);

function sanitizeServiceMetadata(value, depth = 0) {
  if (depth > 3) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeServiceMetadata(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 300) : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).slice(0, 40).map(([key, child]) => [String(key).slice(0, 80), sanitizeServiceMetadata(child, depth + 1)]));
}

function providerSourceType(result, quote) {
  if (quote?.isAvailable === false || result?.isAvailable === false || result?.error) return "unavailable";
  const source = String(quote?.dataSource || quote?.source || result?.dataSource || result?.source || "").toUpperCase();
  if (source === "REAL" || source === "LIVE") return "actual_provider";
  if (source === "TEST" || source === "SYNTHETIC_DATASET" || source === "ESTIMATED") return "estimated";
  return "historical";
}

function serviceCategoryEvidence(quote) {
  const normalized = quote?.verifiedVehicleCategory || quote?.vehicleCategory || null;
  const category = normalized && !["unknown", "UNKNOWN", "null"].includes(String(normalized)) ? String(normalized) : null;
  const provenance = quote?.serviceCategoryProvenance || quote?.categoryProvenance || (quote?.normalizedCategory && quote.normalizedCategory !== "UNKNOWN" ? "provider_mapping" : (category ? "provider_supplied" : null));
  return { category, confidence: quote?.serviceCategoryConfidence || (provenance === "provider_mapping" ? "verified" : provenance ? "provider_supplied" : null), provenance };
}

function serviceIdentityForQuote(result, quote, observedAt = new Date()) {
  const provider = result?.provider || {};
  const evidence = serviceCategoryEvidence(quote);
  const serviceCode = quote?.service_code ?? quote?.serviceCode ?? result?.service_code ?? result?.serviceCode;
  const created = quote?.quotedAt || quote?.observedAt || result?.quotedAt || result?.observedAt || observedAt;
  const ttlSeconds = Number(quote?.metadata?.providerTtlSeconds ?? result?.metadata?.providerTtlSeconds);
  const validUntil = quote?.expiresAt || result?.expiresAt || (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? new Date(new Date(created).getTime() + ttlSeconds * 1000) : null);
  const errorCode = typeof result?.error === "string" ? result.error : result?.error?.code || quote?.errorCode || null;
  return {
    providerId: provider.id || provider.name || null,
    providerDisplayName: provider.displayName || provider.display_name || provider.name || null,
    serviceCode: serviceCode === undefined || serviceCode === null ? null : String(serviceCode),
    providerServiceName: quote?.providerServiceName || result?.providerServiceName || null,
    providerServiceLabel: quote?.providerServiceLabel || result?.providerServiceLabel || null,
    verifiedVehicleCategory: evidence.category,
    serviceCategoryConfidence: evidence.confidence,
    serviceCategoryProvenance: evidence.provenance,
    serviceTier: quote?.serviceTier || result?.serviceTier || null,
    serviceMetadata: sanitizeServiceMetadata(quote?.metadata || result?.metadata || null),
    sourceType: providerSourceType(result, quote),
    errorCode: errorCode && SAFE_ERROR_CODES.has(String(errorCode)) ? String(errorCode) : null,
    quoteCreatedAt: created,
    validUntil,
    observedAt,
  };
}

function enrichmentFor(results) {
  return { version: 1, dataSource: "SIMULATED", results: results.map((result) => ({
    provider: result.provider?.name || null,
    prediction: result.prediction || null,
    recommendation: result.recommendation || null,
  })) };
}
async function createComparisonHistory({userId,pickup,dropoff,distanceKm,durationMin,vehicleType,results}){return withTransaction(async c=>{const h=(await c.query("INSERT INTO comparison_history (user_id,pickup_label,pickup_latitude,pickup_longitude,destination_label,destination_latitude,destination_longitude,distance_meters,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[userId,pickup.name,pickup.lat,pickup.lng,dropoff.name,dropoff.lat,dropoff.lng,distanceKm==null?null:distanceKm*1000,durationMin==null?null:durationMin*60])).rows[0]; const observedAt = new Date(); for(const result of results){for(const quote of (Array.isArray(result.quotes)?result.quotes:[result])) { const identity = serviceIdentityForQuote(result, quote, observedAt); await c.query("INSERT INTO comparison_history_quotes (comparison_id,provider,category,fare,fare_min,fare_max,currency,fare_type,pickup_eta_seconds,availability,provider_id,provider_display_name,service_code,provider_service_name,provider_service_label,verified_vehicle_category,service_category_confidence,service_category_provenance,service_tier,service_metadata_json,source_type,error_code,quote_created_at,valid_until,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25)",[h.id,result.provider?.name || result.provider?.id || identity.providerId,quote.categoryName||vehicleType||null,quote.fare??result.fare??null,quote.fareMin??result.fareMin??null,quote.fareMax??result.fareMax??null,quote.currency||result.currency||"PKR",quote.fareType||result.fareType||null,quote.pickupEtaSeconds??(result.etaMin==null?null:result.etaMin*60),quote.isAvailable===false||result.isAvailable===false?"unavailable":"available",identity.providerId,identity.providerDisplayName,identity.serviceCode,identity.providerServiceName,identity.providerServiceLabel,identity.verifiedVehicleCategory,identity.serviceCategoryConfidence,identity.serviceCategoryProvenance,identity.serviceTier,JSON.stringify(identity.serviceMetadata),identity.sourceType,identity.errorCode,identity.quoteCreatedAt,identity.validUntil,identity.observedAt]); }} return h.id;});}
async function updateComparisonEnrichment({id,userId,results,createdAt = new Date()}) {
  const ttlMs = Number(process.env.FAIRFARE_COMPARISON_ENRICHMENT_TTL_MS || 30 * 60 * 1000);
  const expiresAt = new Date(new Date(createdAt).getTime() + ttlMs);
  try {
    await query("UPDATE comparison_history SET enrichment_json=$1::jsonb, enrichment_created_at=$2, enrichment_expires_at=$3 WHERE id=$4 AND user_id=$5", [JSON.stringify(enrichmentFor(results)), createdAt, expiresAt, id, userId]);
    return true;
  } catch (error) {
    // Allows a rolling application update to keep fare comparison available
    // until migration 008 has been applied. It never masks other DB failures.
    if (error?.code === "42703" || error?.code === "42P01") {
      console.warn("[history] comparison enrichment columns are unavailable; apply migration 008");
      return false;
    }
    throw error;
  }
}
function mapHistoryRow(row){const enrichment = row.enrichment_json || null; const expired = Boolean(row.enrichment_expires_at && new Date(row.enrichment_expires_at).getTime() <= Date.now()); const byProvider = new Map((enrichment?.results || []).map((item) => [String(item.provider), item])); return {id:row.id,comparisonId:row.id,searchedAt:row.created_at,pickup:{label:row.pickup_label,latitude:row.pickup_latitude,longitude:row.pickup_longitude},destination:{label:row.destination_label,latitude:row.destination_latitude,longitude:row.destination_longitude},dropoff:{label:row.destination_label,latitude:row.destination_latitude,longitude:row.destination_longitude},route:{distanceMeters:row.distance_meters,durationSeconds:row.duration_seconds},enrichmentStatus: enrichment ? (expired ? "stale" : "current") : "missing",enrichmentCreatedAt:row.enrichment_created_at || null,quotes:row.quotes.map(q=>{const item = byProvider.get(String(q.provider)); const fresh = q.valid_until ? new Date(q.valid_until).getTime() > Date.now() : false; return {provider:q.provider,providerId:q.provider_id || null,providerDisplayName:q.provider_display_name || null,category:q.category,fare:q.fare,fareMin:q.fare_min,fareMax:q.fare_max,currency:q.currency,fareType:q.fare_type,pickupEtaSeconds:q.pickup_eta_seconds,availability:q.availability,serviceCode:q.service_code || null,providerServiceName:q.provider_service_name || null,providerServiceLabel:q.provider_service_label || null,verifiedVehicleCategory:q.verified_vehicle_category || null,serviceCategoryConfidence:q.service_category_confidence || null,serviceCategoryProvenance:q.service_category_provenance || null,serviceTier:q.service_tier || null,serviceMetadata:q.service_metadata_json || null,sourceType:q.source_type || "historical",errorCode:q.error_code || null,quoteCreatedAt:q.quote_created_at || null,validUntil:q.valid_until || null,observedAt:q.observed_at || null,quoteFreshness:fresh ? "fresh" : (q.quote_created_at ? "historical" : "unknown"),prediction:item?.prediction || null,recommendation:item?.recommendation || null};})};}
async function getHistory({userId,limit=20,offset=0}={}){const rows=(await query("SELECT * FROM comparison_history WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",[userId,limit,offset])).rows;if(!rows.length)return [];const quotes=(await query("SELECT * FROM comparison_history_quotes WHERE comparison_id=ANY($1::uuid[]) ORDER BY id ASC",[rows.map(r=>r.id)])).rows;return rows.map(r=>mapHistoryRow({...r,quotes:quotes.filter(q=>String(q.comparison_id)===String(r.id))}));}
async function getHistoryById(id,userId){const row=(await query("SELECT * FROM comparison_history WHERE id=$1 AND user_id=$2",[id,userId])).rows[0];if(!row)return null;const quotes=(await query("SELECT * FROM comparison_history_quotes WHERE comparison_id=$1 ORDER BY id ASC",[id])).rows;return mapHistoryRow({...row,quotes});}
module.exports={createComparisonHistory,updateComparisonEnrichment,getHistory,getHistoryById,mapHistoryRow,enrichmentFor,serviceIdentityForQuote,sanitizeServiceMetadata};
