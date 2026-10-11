const { query, withTransaction } = require("../config/postgres");

function enrichmentFor(results) {
  return { version: 1, dataSource: "SIMULATED", results: results.map((result) => ({
    provider: result.provider?.name || null,
    prediction: result.prediction || null,
    recommendation: result.recommendation || null,
  })) };
}
async function createComparisonHistory({userId,pickup,dropoff,distanceKm,durationMin,vehicleType,results}){return withTransaction(async c=>{const h=(await c.query("INSERT INTO comparison_history (user_id,pickup_label,pickup_latitude,pickup_longitude,destination_label,destination_latitude,destination_longitude,distance_meters,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[userId,pickup.name,pickup.lat,pickup.lng,dropoff.name,dropoff.lat,dropoff.lng,distanceKm==null?null:distanceKm*1000,durationMin==null?null:durationMin*60])).rows[0]; for(const result of results){for(const quote of (Array.isArray(result.quotes)?result.quotes:[result])) await c.query("INSERT INTO comparison_history_quotes (comparison_id,provider,category,fare,fare_min,fare_max,currency,fare_type,pickup_eta_seconds,availability) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[h.id,result.provider.name,quote.categoryName||vehicleType||null,quote.fare??null,quote.fareMin??null,quote.fareMax??null,quote.currency||result.currency||"PKR",quote.fareType||result.fareType||null,quote.pickupEtaSeconds??(result.etaMin==null?null:result.etaMin*60),quote.isAvailable===false||result.isAvailable===false?"unavailable":"available"]);} return h.id;});}
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
function mapHistoryRow(row){const enrichment = row.enrichment_json || null; const expired = Boolean(row.enrichment_expires_at && new Date(row.enrichment_expires_at).getTime() <= Date.now()); const byProvider = new Map((enrichment?.results || []).map((item) => [String(item.provider), item])); return {id:row.id,searchedAt:row.created_at,pickup:{label:row.pickup_label,latitude:row.pickup_latitude,longitude:row.pickup_longitude},destination:{label:row.destination_label,latitude:row.destination_latitude,longitude:row.destination_longitude},route:{distanceMeters:row.distance_meters,durationSeconds:row.duration_seconds},enrichmentStatus: enrichment ? (expired ? "stale" : "current") : "missing",enrichmentCreatedAt:row.enrichment_created_at || null,quotes:row.quotes.map(q=>{const item = byProvider.get(String(q.provider)); return {provider:q.provider,category:q.category,fare:q.fare,fareMin:q.fare_min,fareMax:q.fare_max,currency:q.currency,fareType:q.fare_type,pickupEtaSeconds:q.pickup_eta_seconds,availability:q.availability,prediction:item?.prediction || null,recommendation:item?.recommendation || null};})};}
async function getHistory({userId,limit=20,offset=0}={}){const rows=(await query("SELECT * FROM comparison_history WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",[userId,limit,offset])).rows;if(!rows.length)return [];const quotes=(await query("SELECT * FROM comparison_history_quotes WHERE comparison_id=ANY($1::uuid[]) ORDER BY id ASC",[rows.map(r=>r.id)])).rows;return rows.map(r=>mapHistoryRow({...r,quotes:quotes.filter(q=>String(q.comparison_id)===String(r.id))}));}
async function getHistoryById(id,userId){const row=(await query("SELECT * FROM comparison_history WHERE id=$1 AND user_id=$2",[id,userId])).rows[0];if(!row)return null;const quotes=(await query("SELECT * FROM comparison_history_quotes WHERE comparison_id=$1 ORDER BY id ASC",[id])).rows;return mapHistoryRow({...row,quotes});}
module.exports={createComparisonHistory,updateComparisonEnrichment,getHistory,getHistoryById,mapHistoryRow,enrichmentFor};
