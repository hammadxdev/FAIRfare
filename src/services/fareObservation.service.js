const db = require("../config/database");
const { normalizeVehicleType, resolveProviderCategory } = require("./vehicleType.service");

const MARKET_TIMEZONE = process.env.FAIRFARE_MARKET_TIMEZONE || "Asia/Karachi";
const WEEKDAY_NUMBERS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const SENSITIVE_KEY = /(authorization|oauth|token|secret|password|cookie|session|credential|fingerprint|device|phone|account)/i;

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

function createObservationRows({ comparisonId = null, pickup, dropoff, distanceMeters, durationSeconds, requestedVehicleType, dataSource = "UNKNOWN", results, observedAt = Date.now() }) {
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
        raw_response_sanitized: sanitizeRawResponse(quote.metadata?.raw),
      });
    }
  }
  return rows;
}

function persistFareObservations(input) {
  const rows = createObservationRows(input);
  if (rows.length === 0) return 0;
  const insert = db.prepare(`
    INSERT INTO fare_observations
      (data_source, comparison_id, provider_id, provider, provider_category, provider_category_id, provider_category_name, normalized_category, vehicle_type,
       pickup_latitude, pickup_longitude, pickup_zone, destination_latitude, destination_longitude, destination_zone,
       distance_meters, duration_seconds, fare, fare_min, fare_max, currency, fare_type, pickup_eta_seconds,
       observed_at, hour_of_day, day_of_week, is_weekend, raw_response_sanitized)
    VALUES
      (@data_source, @comparison_id, @provider_id, @provider, @provider_category, @provider_category_id, @provider_category_name, @normalized_category, @vehicle_type,
       @pickup_latitude, @pickup_longitude, @pickup_zone, @destination_latitude, @destination_longitude, @destination_zone,
       @distance_meters, @duration_seconds, @fare, @fare_min, @fare_max, @currency, @fare_type, @pickup_eta_seconds,
       @observed_at, @hour_of_day, @day_of_week, @is_weekend, @raw_response_sanitized)
  `);
  db.transaction(() => rows.forEach((row) => insert.run(row)))();
  return rows.length;
}

module.exports = { MARKET_TIMEZONE, deriveTimeFeatures, sanitizeRawResponse, createObservationRows, persistFareObservations };
