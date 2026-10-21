const { query } = require("../config/postgres");
const { normalizeVehicleType, resolveProviderCategory } = require("./vehicleType.service");

const MARKET_TIMEZONE = process.env.FAIRFARE_MARKET_TIMEZONE || "Asia/Karachi";
const WEEKDAY_NUMBERS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const SENSITIVE_KEY = /(authorization|oauth|token|secret|password|cookie|session|credential|fingerprint|device|phone|account|profile|advertising|android|gsf|signature)/i;
let queryReader = query;

function deriveTimeFeatures(observedAt) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(observedAt));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const dayOfWeek = WEEKDAY_NUMBERS[values.weekday];
  return { hourOfDay: Number(values.hour), dayOfWeek, isWeekend: dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0 };
}

function sanitizeRawResponse(value) {
  if (value == null) return null;
  function sanitize(input) {
    if (Array.isArray(input)) return input.map(sanitize);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, child]) => [key, sanitize(child)]));
  }
  return JSON.stringify(sanitize(value));
}

function quoteList(result) {
  if (Array.isArray(result.quotes)) return result.quotes;
  return [result];
}

function createObservationRows({ comparisonId = null, pickup, dropoff, distanceMeters, durationSeconds, requestedVehicleType, dataSource = "UNKNOWN", results, observedAt = Date.now(), weatherContext = null }) {
  const time = deriveTimeFeatures(observedAt);
  const rows = [];
  for (const result of results) {
    for (const quote of quoteList(result)) {
      if (quote.fare == null) continue;
      const provider = result.provider || {};
      const category = resolveProviderCategory({
        provider: provider.name,
        providerCategoryId: quote.categoryId,
        providerCategoryName: quote.categoryName,
        requestedVehicleType,
      });
      rows.push({
        data_source: ["REAL", "SIMULATED", "TEST", "UNKNOWN"].includes(result.dataSource || dataSource) ? (result.dataSource || dataSource) : "UNKNOWN",
        comparison_id: comparisonId,
        provider_id: provider.id ?? null,
        provider: provider.name,
        provider_category: category.id,
        provider_category_id: category.id,
        provider_category_name: category.name,
        normalized_category: normalizeVehicleType({ provider: provider.name, providerCategoryId: quote.categoryId, providerCategoryName: category.name, requestedVehicleType }),
        vehicle_type: normalizeVehicleType({ provider: provider.name, providerCategoryId: quote.categoryId, providerCategoryName: category.name, requestedVehicleType }),
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
        pickup_zone: pickup.zone || null,
        destination_latitude: dropoff.lat,
        destination_longitude: dropoff.lng,
        destination_zone: dropoff.zone || null,
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
        fare: quote.fare,
        fare_min: quote.fareMin ?? null,
        fare_max: quote.fareMax ?? null,
        currency: quote.currency || "PKR",
        fare_type: quote.fareType || "ESTIMATE",
        pickup_eta_seconds: quote.pickupEtaSeconds ?? null,
        observed_at: observedAt,
        hour_of_day: time.hourOfDay,
        day_of_week: time.dayOfWeek,
        is_weekend: time.isWeekend,
        weather_condition: weatherContext?.condition || "UNKNOWN",
        weather_severity: weatherContext?.weatherSeverity || "UNKNOWN",
        precipitation_mm: Number.isFinite(Number(weatherContext?.precipitationMm)) ? Number(weatherContext.precipitationMm) : null,
        temperature_c: Number.isFinite(Number(weatherContext?.temperatureC)) ? Number(weatherContext.temperatureC) : null,
        raw_response_sanitized: sanitizeRawResponse(quote.metadata?.raw),
      });
    }
  }
  return rows;
}

async function persistFareObservations(input) {
  const rows = createObservationRows(input);
  if (rows.length === 0) return 0;
  const text = `
    INSERT INTO fare_observations
      (data_source, comparison_id, provider_id, provider, provider_category, provider_category_id, provider_category_name, normalized_category, vehicle_type,
       pickup_latitude, pickup_longitude, pickup_zone, destination_latitude, destination_longitude, destination_zone,
       distance_meters, duration_seconds, fare, fare_min, fare_max, currency, fare_type, pickup_eta_seconds,
       observed_at, hour_of_day, day_of_week, is_weekend, weather_condition, weather_severity, precipitation_mm, temperature_c, raw_response_sanitized)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,
       $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb)`;
  for (const row of rows) await query(text, [row.data_source,row.comparison_id,row.provider_id,row.provider,row.provider_category,row.provider_category_id,row.provider_category_name,row.normalized_category,row.vehicle_type,row.pickup_latitude,row.pickup_longitude,row.pickup_zone,row.destination_latitude,row.destination_longitude,row.destination_zone,row.distance_meters,row.duration_seconds,row.fare,row.fare_min,row.fare_max,row.currency,row.fare_type,row.pickup_eta_seconds,new Date(row.observed_at),row.hour_of_day,row.day_of_week,row.is_weekend,row.weather_condition,row.weather_severity,row.precipitation_mm,row.temperature_c,row.raw_response_sanitized]);
  return rows.length;
}

function bounded(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
async function readHistoricalFareEvidence({ providerId, vehicleCategory, city, hourOfDay, dayOfWeek, distanceMeters, durationSeconds, dataCutoff = new Date(), horizonDays = 180, limit = 100 } = {}) {
  if (!providerId || !vehicleCategory || !city || !Number.isFinite(Number(distanceMeters)) || !Number.isFinite(Number(durationSeconds))) return { status: "INSUFFICIENT_DATA", evidence: [], reason: "MISSING_EVIDENCE_FILTERS" };
  const params = [providerId, vehicleCategory, String(city), Number(hourOfDay), Number(dayOfWeek), Number(distanceMeters), Number(durationSeconds), new Date(dataCutoff), Math.max(1, Math.min(365, Number(horizonDays) || 180)), Math.max(1, Math.min(100, Number(limit) || 100))];
  const sql = `SELECT provider_id, provider_category, normalized_category, pickup_zone, destination_zone, fare, currency, observed_at, hour_of_day, day_of_week, distance_meters, duration_seconds, data_source
    FROM fare_observations
    WHERE provider_id=$1 AND (normalized_category=$2 OR provider_category=$2)
      AND (lower(coalesce(pickup_zone, ''))=lower($3) OR lower(coalesce(destination_zone, ''))=lower($3)) AND hour_of_day BETWEEN $4-1 AND $4+1 AND day_of_week=$5
      AND observed_at <= $8 AND observed_at >= $8 - ($9 * interval '1 day')
      AND data_source='REAL' AND distance_meters BETWEEN $6*0.75 AND $6*1.25
      AND duration_seconds BETWEEN $7*0.75 AND $7*1.25
      AND fare IS NOT NULL AND fare >= 0
    ORDER BY observed_at DESC LIMIT $10`;
  try {
    // PostgreSQL's statement_timeout (configured on the pool) owns query
    // cancellation. Do not race the promise: that leaves an active query
    // running while callers may reuse or release its client.
    const result = await queryReader(sql, params);
    return { status: result.rows.length ? "OK" : "INSUFFICIENT_DATA", evidence: result.rows.map((row) => ({ providerId: row.provider_id, vehicleCategory: row.normalized_category || row.provider_category, city: city, fare: Number(row.fare), currency: row.currency || "PKR", observedAt: row.observed_at, hourOfDay: row.hour_of_day, dayOfWeek: row.day_of_week, distanceMeters: Number(row.distance_meters), durationSeconds: Number(row.duration_seconds), sourceType: "historical_observation", dataSource: row.data_source })) };
  } catch (error) { return { status: "UNAVAILABLE", evidence: [], reason: error.code || "OBSERVATION_QUERY_FAILED" }; }
}
function setQueryForTests(fn) { queryReader = fn || query; }
function resetQueryForTests() { queryReader = query; }

module.exports = { MARKET_TIMEZONE, deriveTimeFeatures, sanitizeRawResponse, createObservationRows, persistFareObservations, readHistoricalFareEvidence, setQueryForTests, resetQueryForTests };
