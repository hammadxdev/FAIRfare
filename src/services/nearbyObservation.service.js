const { query } = require("../config/postgres");
const { resolveWeatherContext } = require("./weatherContext.service");
const { haversineDistanceKm } = require("./distance.service");

const TIMEZONE = "Asia/Karachi";
const POSITION_FRESH_MS = 60_000;
const RETENTION_DAYS = 90;
const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MIN_HISTORY_SAMPLES = 10;
const MIN_HISTORY_DAYS = 5;
const MIN_BREAKDOWN_SAMPLES = 5;
const DAY_NUMBERS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
let queryFn = query;
let weatherResolver = resolveWeatherContext;
let lastCleanupAt = 0;

function validPoint(latitude, longitude) {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return null;
  const lat = Number(latitude); const lng = Number(longitude);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}
function rounded(value) { return Math.round(value * 1000) / 1000; }
function weatherTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const milliseconds = Date.parse(explicitZone ? value : `${value}Z`); // Existing integration requests timezone=UTC.
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}
function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 21) return "Evening";
  return "Night";
}
function deriveReceivedContext(receivedAt) {
  return deriveLocalContext(receivedAt, "backend_received_at");
}
function deriveRequestContext(requestStartedAt) {
  return deriveLocalContext(requestStartedAt, "backend_request_started_at");
}
function deriveLocalContext(timestamp, timeContextBasis) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError("context timestamp must be valid");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return { localDate: `${parts.year}-${parts.month}-${parts.day}`, localWeekday: DAY_NUMBERS[parts.weekday], localHour: hour, partOfDay: partOfDay(hour), timezone: TIMEZONE, timeContextBasis };
}
function categoryFor(provider, entry, requestedCategory) {
  if (["bike", "car", "rickshaw", "mini"].includes(String(requestedCategory || "").toLowerCase())) return String(requestedCategory).toLowerCase();
  const key = String(entry?.vehicleType || entry?.rideType || requestedCategory || "").toLowerCase();
  const id = String(entry?.orderTypeId || "");
  if (key.includes("bike") || key.includes("moto") || id === "2" || provider === "bykea" && String(entry?.serviceCode) === "23") return "bike";
  if (key.includes("rickshaw") || key === "auto" || id === "31" || provider === "bykea" && String(entry?.serviceCode) === "70") return "rickshaw";
  if (key.includes("mini") || key === "econom" || provider === "indrive" && id === "33") return "mini";
  if (key.includes("car") || ["29", "11"].includes(id) || provider === "bykea" && ["44", "45", "48"].includes(String(entry?.serviceCode))) return "car";
  return ["bike", "car", "rickshaw", "mini"].includes(requestedCategory) ? requestedCategory : "unknown";
}
function rowsFromResponse({ provider, result, pickup, requestStartedAt = null, receivedAt, weather }) {
  const items = provider === "indrive" ? (Array.isArray(result?.vehicles) && result.vehicles.length ? result.vehicles.flatMap((vehicle) => {
    const markers = Array.isArray(vehicle.drivers) ? vehicle.drivers : [];
    return markers.length ? markers.map((marker) => ({ vehicle, marker })) : [{ vehicle, marker: null }];
  }) : [{ vehicle: { orderTypeId: result?.rideType }, marker: null }])
    : (provider === "yango" ? (result?.drivers || []) : (result?.partners || [])).length
      ? (provider === "yango" ? result.drivers : result.partners).map((marker) => ({ vehicle: result, marker }))
      : [{ vehicle: result, marker: null }];
  const requestDate = requestStartedAt == null ? null : new Date(requestStartedAt);
  if (requestStartedAt != null && !Number.isFinite(requestDate.getTime())) throw new TypeError("requestStartedAt must be a valid timestamp");
  const local = requestDate ? deriveRequestContext(requestDate) : deriveReceivedContext(receivedAt);
  // Open-Meteo may use the request time as a fallback; that is not an observation time.
  const weatherAt = weather?.observedAt === receivedAt ? null : weatherTimestamp(weather?.observedAt);
  const weatherIsVerified = weather?.source === "OPEN_METEO" && weather?.condition && weather.condition !== "UNKNOWN";
  const weatherFields = weatherIsVerified ? { weatherCondition: weather.condition, temperatureC: weather.temperatureC != null && Number.isFinite(Number(weather.temperatureC)) ? Number(weather.temperatureC) : null, weatherSource: weather.source, weatherObservedAt: weatherAt, weatherUnavailableReason: null }
    : { weatherCondition: null, temperatureC: null, weatherSource: null, weatherObservedAt: null, weatherUnavailableReason: String(weather?.source || "UNAVAILABLE").slice(0, 40) };
  return items.flatMap(({ vehicle, marker }) => {
    const point = marker ? validPoint(marker?.latitude ?? marker?.lat, marker?.longitude ?? marker?.lng ?? marker?.lon) : null;
    if (marker && !point) return [];
    const capturedValue = marker?.providerCapturedAt ?? vehicle?.providerCapturedAt ?? result?.providerCapturedAt;
    const captureVerified = marker?.providerCaptureVerified === true || vehicle?.providerCaptureVerified === true || result?.providerCaptureVerified === true;
    const captureMs = captureVerified && capturedValue != null ? Date.parse(capturedValue) : NaN;
    const capturedAt = Number.isFinite(captureMs) ? new Date(captureMs) : null;
    const receiptMs = Date.parse(receivedAt);
    const freshness = !capturedAt ? "unknown" : (captureMs <= receiptMs && receiptMs - captureMs <= POSITION_FRESH_MS ? "fresh" : "stale");
    const distance = point ? haversineDistanceKm(pickup.lat, pickup.lng, point.lat, point.lng) * 1000 : null;
    const responseStatus = String(result?.status || "").toLowerCase();
    const providerStatus = ["available", "no_drivers", "unavailable"].includes(responseStatus) ? responseStatus : "unknown";
    return [{ provider, vehicleCategory: categoryFor(provider, vehicle, result?.requestedCategory || result?.rideType), providerStatus, pickupLatitude: rounded(pickup.lat), pickupLongitude: rounded(pickup.lng), markerLatitude: point ? rounded(point.lat) : null, markerLongitude: point ? rounded(point.lng) : null, distanceMeters: distance === null ? null : Math.round(distance), distanceMethod: distance === null ? null : "HAVERSINE_STRAIGHT_LINE", pickupEtaSeconds: null, etaSource: null, providerCapturedAt: capturedAt, requestStartedAt: requestDate, receivedAt: new Date(receivedAt), expiresAt: new Date(receiptMs + RETENTION_DAYS * 86_400_000), freshnessStatus: freshness, ...local, ...weatherFields, provenance: "authorized_provider_response" }];
  });
}

async function cleanupExpired(now = Date.now(), onFailure = null) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return 0;
  lastCleanupAt = now;
  const sql = `WITH expired_batch AS (
      SELECT id FROM public.nearby_observations
       WHERE expires_at <= now()
       ORDER BY expires_at
       LIMIT ${CLEANUP_BATCH_SIZE}
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.nearby_observations AS observations
     USING expired_batch
     WHERE observations.id = expired_batch.id
    RETURNING observations.id`;
  try { return (await queryFn(sql)).rows?.length || 0; } catch (error) {
    try { onFailure?.(error, "cleanup"); } catch { /* Diagnostics must never block persistence. */ }
    return 0;
  }
}

const INSERT_SQL = `INSERT INTO public.nearby_observations
  (provider, vehicle_category, provider_status, pickup_latitude, pickup_longitude, marker_latitude, marker_longitude, distance_meters, distance_method, pickup_eta_seconds, eta_source, provider_captured_at, request_started_at, received_at, expires_at, freshness_status, local_date, local_weekday, local_hour, part_of_day, timezone, time_context_basis, weather_condition, temperature_c, weather_source, weather_observed_at, weather_unavailable_reason, provenance)
  SELECT provider, vehicle_category, provider_status, pickup_latitude, pickup_longitude, marker_latitude, marker_longitude, distance_meters, distance_method, pickup_eta_seconds, eta_source, provider_captured_at, request_started_at, received_at, expires_at, freshness_status, local_date, local_weekday, local_hour, part_of_day, timezone, time_context_basis, weather_condition, temperature_c, weather_source, weather_observed_at, weather_unavailable_reason, provenance
  FROM jsonb_to_recordset($1::jsonb) AS item(
    provider text, vehicle_category text, provider_status text,
    pickup_latitude numeric, pickup_longitude numeric, marker_latitude numeric, marker_longitude numeric,
    distance_meters numeric, distance_method text, pickup_eta_seconds numeric, eta_source text,
    provider_captured_at timestamptz, request_started_at timestamptz, received_at timestamptz, expires_at timestamptz,
    freshness_status text, local_date date, local_weekday smallint, local_hour smallint,
    part_of_day text, timezone text, time_context_basis text, weather_condition text,
    temperature_c numeric, weather_source text, weather_observed_at timestamptz,
    weather_unavailable_reason text, provenance text
  )`;

const LEGACY_INSERT_SQL = `INSERT INTO public.nearby_observations
  (provider, vehicle_category, provider_status, pickup_latitude, pickup_longitude, marker_latitude, marker_longitude, distance_meters, distance_method, pickup_eta_seconds, eta_source, provider_captured_at, received_at, expires_at, freshness_status, local_date, local_weekday, local_hour, part_of_day, timezone, time_context_basis, weather_condition, temperature_c, weather_source, weather_observed_at, weather_unavailable_reason, provenance)
  SELECT provider, vehicle_category, provider_status, pickup_latitude, pickup_longitude, marker_latitude, marker_longitude, distance_meters, distance_method, pickup_eta_seconds, eta_source, provider_captured_at, received_at, expires_at, freshness_status, local_date, local_weekday, local_hour, part_of_day, timezone, time_context_basis, weather_condition, temperature_c, weather_source, weather_observed_at, weather_unavailable_reason, provenance
  FROM jsonb_to_recordset($1::jsonb) AS item(
    provider text, vehicle_category text, provider_status text,
    pickup_latitude numeric, pickup_longitude numeric, marker_latitude numeric, marker_longitude numeric,
    distance_meters numeric, distance_method text, pickup_eta_seconds numeric, eta_source text,
    provider_captured_at timestamptz, received_at timestamptz, expires_at timestamptz,
    freshness_status text, local_date date, local_weekday smallint, local_hour smallint,
    part_of_day text, timezone text, time_context_basis text, weather_condition text,
    temperature_c numeric, weather_source text, weather_observed_at timestamptz,
    weather_unavailable_reason text, provenance text
  )`;

function isMigration020Unavailable(error) {
  return error?.code === "42703" && (error.column === "request_started_at" || /request_started_at/i.test(error.message || ""))
    || error?.code === "23514" && error.constraint === "nearby_observations_time_context_basis_check";
}

function legacyRecordsFromRows(rows) {
  return rows.map((row) => {
    const legacyContext = deriveReceivedContext(row.receivedAt);
    const { requestStartedAt, ...base } = row;
    return Object.fromEntries(Object.entries({ ...base, ...legacyContext }).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
  });
}

async function persistNearbyProviderObservation({ provider, latitude, longitude, result, requestStartedAt = null, receivedAt = new Date().toISOString(), onPersistenceDiagnostic = null } = {}) {
  const normalizedProvider = String(provider || "").toLowerCase();
  const pickup = validPoint(latitude, longitude);
  if (!pickup || !["indrive", "yango", "bykea"].includes(normalizedProvider)) return 0;
  const weather = await weatherResolver({ latitude: pickup.lat, longitude: pickup.lng, observedAt: receivedAt }).catch(() => ({ source: "UNAVAILABLE" }));
  const rows = rowsFromResponse({ provider: normalizedProvider, result, pickup, requestStartedAt, receivedAt, weather });
  await cleanupExpired(Date.now(), onPersistenceDiagnostic); // Opportunistic only: no scheduled cleanup runs without nearby traffic.
  if (!rows.length) return 0;
  const records = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value])));
  // One INSERT statement makes this provider response all-or-nothing. If 020
  // is not installed yet, preserve 019-compatible receipt-time history rather
  // than failing every best-effort write; request-start is never fabricated.
  try {
    await queryFn(INSERT_SQL, [JSON.stringify(records)]);
  } catch (error) {
    if (!isMigration020Unavailable(error)) throw error;
    await queryFn(LEGACY_INSERT_SQL, [JSON.stringify(legacyRecordsFromRows(rows))]);
  }
  return rows.length;
}

async function readNearbyObservationContext({ latitude, longitude, category, provider = null, now = new Date(), minimumSamples = MIN_HISTORY_SAMPLES } = {}) {
  const pickup = validPoint(latitude, longitude);
  const normalizedCategory = String(category || "").toLowerCase();
  if (!pickup || !["bike", "car", "rickshaw", "mini"].includes(normalizedCategory)) return { status: "INSUFFICIENT_DATA", reason: "INVALID_CONTEXT_FILTERS", observations: [], trendEligible: false };
  const timestamp = new Date(now);
  const args = [timestamp, normalizedCategory, rounded(pickup.lat), rounded(pickup.lng), provider ? String(provider).toLowerCase() : null];
  const filters = `FROM public.nearby_observations
    WHERE expires_at > $1 AND vehicle_category=$2 AND pickup_latitude=$3 AND pickup_longitude=$4
      AND ($5::text IS NULL OR provider=$5)`;
  try {
    const summarySql = `SELECT count(DISTINCT received_at)::int AS sample_count, count(DISTINCT local_date)::int AS distinct_days,
        count(DISTINCT received_at) FILTER (WHERE provider_captured_at IS NOT NULL)::int AS verified_position_samples,
        count(DISTINCT received_at) FILTER (WHERE provider_captured_at >= $1 - interval '60 seconds' AND provider_captured_at <= $1)::int AS fresh_verified_position_samples
      ${filters}`;
    const summary = (await queryFn(summarySql, args)).rows?.[0] || {};
    const sampleCount = Number(summary.sample_count || 0);
    const distinctDays = Number(summary.distinct_days || 0);
    const requiredSamples = Math.max(MIN_HISTORY_SAMPLES, Number(minimumSamples) || MIN_HISTORY_SAMPLES);
    const trendEligible = sampleCount >= requiredSamples && distinctDays >= MIN_HISTORY_DAYS;
    const base = { observationBasis: "local date, weekday, hour and part of day are derived from each row's time_context_basis; request-start rows are exact backend handler starts, legacy rows remain backend receipt time", currentPositionBasis: "verified provider capture time within 60 seconds before query time", timezone: TIMEZONE, sampleCount, distinctDays, verifiedPositionSamples: Number(summary.verified_position_samples || 0), currentlyFreshVerifiedPositionSamples: Number(summary.fresh_verified_position_samples || 0), trendEligible, trendStatus: trendEligible ? "SAMPLE_THRESHOLD_MET" : "INSUFFICIENT_SAMPLE_FOR_TRENDS" };
    if (!trendEligible) return { status: "INSUFFICIENT_DATA", ...base, observations: [] };

    const detailSql = `SELECT provider, vehicle_category, local_weekday, part_of_day, weather_condition, time_context_basis,
        count(DISTINCT received_at)::int AS request_observations,
        count(*) FILTER (WHERE provider_captured_at IS NOT NULL)::int AS verified_position_observations,
        count(*) FILTER (WHERE provider_captured_at >= $1 - interval '60 seconds' AND provider_captured_at <= $1)::int AS currently_fresh_verified_position_observations
      ${filters}
      GROUP BY provider, vehicle_category, local_weekday, part_of_day, weather_condition, time_context_basis
      HAVING count(DISTINCT received_at) >= $6
      ORDER BY provider, local_weekday, part_of_day, weather_condition NULLS LAST`;
    const detailRows = (await queryFn(detailSql, [...args, MIN_BREAKDOWN_SAMPLES])).rows || [];
    return { status: "OK", ...base, observations: detailRows.map((row) => ({ provider: row.provider, category: row.vehicle_category, weekday: Number(row.local_weekday), partOfDay: row.part_of_day, weatherCondition: row.weather_condition, timeContextBasis: row.time_context_basis, requestObservations: Number(row.request_observations), verifiedPositionObservations: Number(row.verified_position_observations), currentlyFreshVerifiedPositionObservations: Number(row.currently_fresh_verified_position_observations || 0) })) };
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "NEARBY_HISTORY_UNAVAILABLE";
    return { status: "UNAVAILABLE", reason: code, observations: [], trendEligible: false };
  }
}

function setQueryForTests(fn) { queryFn = fn || query; }
function setWeatherForTests(fn) { weatherResolver = fn || resolveWeatherContext; }
function resetForTests() { queryFn = query; weatherResolver = resolveWeatherContext; lastCleanupAt = 0; }
module.exports = { TIMEZONE, POSITION_FRESH_MS, RETENTION_DAYS, CLEANUP_BATCH_SIZE, MIN_HISTORY_SAMPLES, MIN_HISTORY_DAYS, MIN_BREAKDOWN_SAMPLES, validPoint, partOfDay, deriveReceivedContext, deriveRequestContext, weatherTimestamp, categoryFor, rowsFromResponse, cleanupExpired, persistNearbyProviderObservation, readNearbyObservationContext, setQueryForTests, setWeatherForTests, resetForTests };
