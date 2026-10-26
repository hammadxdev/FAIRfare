const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const observations = require("../services/nearbyObservation.service");

const receivedAt = "2026-10-23T19:00:00.000Z"; // 2026-10-24 00:00 in Karachi.
const pickup = { lat: 31.4744, lng: 74.4163 };
const result = { drivers: [{ latitude: 31.4754, longitude: 74.4163 }], status: "available", source: "live" };

test("backend receipt time drives Karachi date, weekday and day-part across midnight", () => {
  const context = observations.deriveReceivedContext(receivedAt);
  assert.deepEqual(context, { localDate: "2026-10-24", localWeekday: 6, localHour: 0, partOfDay: "Night", timezone: "Asia/Karachi", timeContextBasis: "backend_received_at" });
  assert.deepEqual([4, 5, 11, 12, 16, 17, 20, 21].map(observations.partOfDay), ["Night", "Morning", "Morning", "Afternoon", "Afternoon", "Evening", "Evening", "Night"]);
});

test("request-start historical context is distinct from provider receipt and position capture", () => {
  const requestStartedAt = "2026-10-23T18:59:00.000Z"; // 2026-10-23 23:59 in Karachi.
  const row = observations.rowsFromResponse({
    provider: "yango", result: { ...result, drivers: [{ ...result.drivers[0], providerCapturedAt: "2026-10-23T18:58:50.000Z", providerCaptureVerified: true }] },
    pickup, requestStartedAt, receivedAt, weather: { source: "UNAVAILABLE" },
  })[0];
  assert.equal(row.requestStartedAt.toISOString(), requestStartedAt);
  assert.equal(row.receivedAt.toISOString(), receivedAt);
  assert.equal(row.providerCapturedAt.toISOString(), "2026-10-23T18:58:50.000Z");
  assert.equal(row.localDate, "2026-10-23");
  assert.equal(row.localHour, 23);
  assert.equal(row.partOfDay, "Night");
  assert.equal(row.timeContextBasis, "backend_request_started_at");
  assert.equal(observations.deriveReceivedContext(receivedAt).localDate, "2026-10-24");
});

test("missing coordinates are not coerced to zero and missing temperature is not stored as zero", () => {
  assert.equal(observations.validPoint(null, null), null);
  const row = observations.rowsFromResponse({ provider: "yango", result, pickup, receivedAt, weather: { source: "OPEN_METEO", condition: "CLOUDY", temperatureC: null, observedAt: "2026-10-23T18:55" } })[0];
  assert.equal(row.temperatureC, null);
});

test("receipt time and verified capture time remain separate; unknown capture is never fresh", () => {
  const unknown = observations.rowsFromResponse({ provider: "yango", result: { ...result, observedAt: receivedAt }, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(unknown.providerCapturedAt, null);
  assert.equal(unknown.receivedAt.toISOString(), receivedAt);
  assert.equal(unknown.freshnessStatus, "unknown");
  assert.equal(unknown.timeContextBasis, "backend_received_at");
  const verified = observations.rowsFromResponse({ provider: "yango", result: { ...result, drivers: [{ ...result.drivers[0], providerCapturedAt: receivedAt, providerCaptureVerified: true }] }, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(verified.providerCapturedAt.toISOString(), receivedAt);
  assert.equal(verified.freshnessStatus, "fresh");
  const stale = observations.rowsFromResponse({ provider: "yango", result: { ...result, drivers: [{ ...result.drivers[0], providerCapturedAt: "2026-10-23T18:58:00Z", providerCaptureVerified: true }] }, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(stale.freshnessStatus, "stale");
  const future = observations.rowsFromResponse({ provider: "yango", result: { ...result, drivers: [{ ...result.drivers[0], providerCapturedAt: "2026-10-23T19:01:00Z", providerCaptureVerified: true }] }, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(future.freshnessStatus, "stale");
});

test("provider timestamps without verification and generic ETA fields are not trusted", () => {
  const row = observations.rowsFromResponse({ provider: "bykea", result: { partners: [{ ...result.drivers[0], timestamp: receivedAt }], eta: 4, observedAt: receivedAt }, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(row.providerCapturedAt, null);
  assert.equal(row.pickupEtaSeconds, null);
  assert.equal(row.etaSource, null);
});

test("only existing trusted weather data is persisted and UTC weather timestamps stay UTC", () => {
  const missing = observations.rowsFromResponse({ provider: "yango", result, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(missing.weatherCondition, null);
  assert.equal(missing.temperatureC, null);
  assert.equal(missing.weatherSource, null);
  assert.equal(missing.weatherUnavailableReason, "UNAVAILABLE");
  const actual = observations.rowsFromResponse({ provider: "yango", result, pickup, receivedAt, weather: { source: "OPEN_METEO", condition: "RAIN", temperatureC: 21.5, observedAt: "2026-10-23T18:55" } })[0];
  assert.equal(actual.weatherCondition, "RAIN");
  assert.equal(actual.weatherObservedAt.toISOString(), "2026-10-23T18:55:00.000Z");
  const noWeatherTimestamp = observations.rowsFromResponse({ provider: "yango", result, pickup, receivedAt, weather: { source: "OPEN_METEO", condition: "CLOUDY", temperatureC: 22, observedAt: receivedAt } })[0];
  assert.equal(noWeatherTimestamp.weatherCondition, "CLOUDY");
  assert.equal(noWeatherTimestamp.weatherObservedAt, null);
});

test("nearby rows round coordinates and never retain marker identifiers", () => {
  const row = observations.rowsFromResponse({ provider: "indrive", result: { vehicles: [{ orderTypeId: 2, vehicleType: "moto", drivers: [{ id: "must-not-persist", latitude: 31.4754, longitude: 74.4163 }] }] }, pickup, receivedAt, weather: { source: "DISABLED" } })[0];
  assert.equal(row.vehicleCategory, "bike");
  assert.equal(row.pickupLatitude, 31.474);
  assert.equal(row.distanceMethod, "HAVERSINE_STRAIGHT_LINE");
  assert.ok(row.distanceMeters > 0);
  assert.equal(Object.hasOwn(row, "id"), false);
  assert.equal(Object.hasOwn(row, "driverId"), false);
  const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/019_nearby_observation_history.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.nearby_observations/);
  assert.match(migration, /provider_captured_at timestamptz/);
  assert.match(migration, /received_at timestamptz NOT NULL/);
  assert.match(migration, /expires_at timestamptz NOT NULL/);
  assert.match(migration, /2160 hours/);
  assert.match(migration, /ALTER TABLE public\.nearby_observations ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.nearby_observations FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON SEQUENCE public\.nearby_observations_id_seq FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /^\s*GRANT\b/im);
  assert.doesNotMatch(migration, /driver_id|user_id|raw_payload|token/i);
});

test("provider category mappings preserve current supported IDs", () => {
  for (const [id, category] of [["2", "bike"], ["31", "rickshaw"], ["33", "mini"], ["29", "car"], ["11", "car"]]) assert.equal(observations.categoryFor("indrive", { orderTypeId: id }, null), category);
  assert.equal(observations.categoryFor("yango", { rideType: "econom" }, "car"), "car");
  assert.equal(observations.categoryFor("bykea", { serviceCode: "70" }, null), "rickshaw");
});

test("one atomic batch insert persists a provider response; weather and cleanup failures are nonblocking", async () => {
  observations.resetForTests();
  observations.setWeatherForTests(async () => { throw new Error("weather unavailable"); });
  const calls = [];
  const diagnostics = [];
  observations.setQueryForTests(async (sql, params) => { calls.push({ sql, params }); if (sql.includes("DELETE FROM public.nearby_observations")) throw Object.assign(new Error("cleanup failed"), { code: "42501" }); return { rows: [] }; });
  const requestStartedAt = "2026-10-23T18:59:00.000Z";
  const count = await observations.persistNearbyProviderObservation({ provider: "yango", latitude: pickup.lat, longitude: pickup.lng, result, requestStartedAt, receivedAt, onPersistenceDiagnostic: (error, stage) => diagnostics.push({ code: error.code, stage }) });
  assert.equal(count, 1);
  assert.deepEqual(diagnostics, [{ code: "42501", stage: "cleanup" }]);
  const inserts = calls.filter(({ sql }) => sql.includes("INSERT INTO public.nearby_observations"));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params.length, 1);
  assert.match(inserts[0].sql, /jsonb_to_recordset/);
  assert.match(inserts[0].sql, /provider_captured_at, request_started_at, received_at, expires_at, freshness_status/);
  const record = JSON.parse(inserts[0].params[0])[0];
  assert.equal(record.provider_captured_at, null);
  assert.equal(record.request_started_at, requestStartedAt);
  assert.equal(record.received_at, receivedAt);
  assert.equal(record.local_date, "2026-10-23");
  assert.equal(record.time_context_basis, "backend_request_started_at");
  assert.equal(new Date(record.expires_at).getTime() - new Date(record.received_at).getTime(), 90 * 86_400_000);
  assert.equal(record.freshness_status, "unknown");
  assert.equal("source_freshness" in record, false);
  observations.resetForTests();
});

test("pre-020 schema fallback persists honest receipt-time context without inventing request-start storage", async () => {
  observations.resetForTests();
  observations.setWeatherForTests(async () => ({ source: "UNAVAILABLE" }));
  const attempts = [];
  observations.setQueryForTests(async (sql, params) => {
    if (!sql.includes("INSERT INTO public.nearby_observations")) return { rows: [] };
    attempts.push({ sql, params });
    if (sql.includes("request_started_at")) throw Object.assign(new Error("column request_started_at does not exist"), { code: "42703", column: "request_started_at" });
    return { rows: [] };
  });
  const count = await observations.persistNearbyProviderObservation({ provider: "yango", latitude: pickup.lat, longitude: pickup.lng, result, requestStartedAt: "2026-10-23T18:59:00.000Z", receivedAt });
  assert.equal(count, 1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].sql.includes("request_started_at"), true);
  assert.equal(attempts[1].sql.includes("request_started_at"), false);
  const legacy = JSON.parse(attempts[1].params[0])[0];
  assert.equal(legacy.received_at, receivedAt);
  assert.equal(legacy.request_started_at, undefined);
  assert.equal(legacy.local_date, "2026-10-24");
  assert.equal(legacy.time_context_basis, "backend_received_at");
  observations.resetForTests();
});

test("migration 020 is additive and preserves migration 019 access controls and retention", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/020_nearby_observation_request_started_at.sql"), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS request_started_at timestamptz/);
  assert.match(migration, /backend_received_at/);
  assert.match(migration, /backend_request_started_at/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.nearby_observations/i);
  assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|GRANT|REVOKE|DISABLE ROW LEVEL SECURITY/i);
});

test("atomic batch insert failure rejects once without partial per-row writes", async () => {
  observations.resetForTests();
  observations.setWeatherForTests(async () => ({ source: "UNAVAILABLE" }));
  const inserts = [];
  observations.setQueryForTests(async (sql) => { if (sql.includes("INSERT INTO public.nearby_observations")) inserts.push(sql); return { rows: [] }; });
  const multiMarkerResult = { ...result, drivers: [...result.drivers, { latitude: 31.476, longitude: 74.417 }] };
  await observations.persistNearbyProviderObservation({ provider: "yango", latitude: pickup.lat, longitude: pickup.lng, result: multiMarkerResult, receivedAt });
  assert.equal(inserts.length, 1);
  observations.resetForTests();
  observations.setWeatherForTests(async () => ({ source: "UNAVAILABLE" }));
  let insertAttempts = 0;
  observations.setQueryForTests(async (sql) => { if (sql.includes("INSERT INTO public.nearby_observations")) { insertAttempts += 1; throw Object.assign(new Error("write failed"), { code: "XX000" }); } return { rows: [] }; });
  await assert.rejects(observations.persistNearbyProviderObservation({ provider: "yango", latitude: pickup.lat, longitude: pickup.lng, result: multiMarkerResult, receivedAt }), /write failed/);
  assert.equal(insertAttempts, 1);
  observations.resetForTests();
});

test("one provider persistence failure does not prevent another provider response from persisting", async () => {
  observations.resetForTests();
  observations.setWeatherForTests(async () => ({ source: "UNAVAILABLE" }));
  const persisted = [];
  observations.setQueryForTests(async (sql, params) => {
    if (sql.includes("INSERT INTO public.nearby_observations")) {
      const provider = JSON.parse(params[0])[0].provider;
      if (provider === "bykea") throw Object.assign(new Error("provider insert failed"), { code: "XX000" });
      persisted.push(provider);
    }
    return { rows: [] };
  });
  const outcomes = await Promise.allSettled([
    observations.persistNearbyProviderObservation({ provider: "bykea", latitude: pickup.lat, longitude: pickup.lng, result: { ...result, partners: [{ latitude: 31.475, longitude: 74.416 }] }, receivedAt }),
    observations.persistNearbyProviderObservation({ provider: "yango", latitude: pickup.lat, longitude: pickup.lng, result, receivedAt }),
  ]);
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[1].status, "fulfilled");
  assert.deepEqual(persisted, ["yango"]);
  observations.resetForTests();
});

test("cleanup is bounded, indexed by expiry, and does not define position freshness", async () => {
  observations.resetForTests();
  let cleanupSql;
  observations.setQueryForTests(async (sql) => { cleanupSql = sql; return { rows: [] }; });
  await observations.cleanupExpired(Date.now() + observations.CLEANUP_INTERVAL_MS);
  assert.match(cleanupSql, /public\.nearby_observations/);
  assert.match(cleanupSql, /WHERE expires_at <= now\(\)/);
  assert.match(cleanupSql, /ORDER BY expires_at/);
  assert.match(cleanupSql, /LIMIT 500/);
  assert.match(cleanupSql, /FOR UPDATE SKIP LOCKED/);
  const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/019_nearby_observation_history.sql"), "utf8");
  assert.match(migration, /nearby_observations_expiry_idx ON public\.nearby_observations \(expires_at\)/);
  assert.match(migration, /retention deadline exactly 90 days/);
  assert.equal(observations.POSITION_FRESH_MS, 60_000);
  observations.resetForTests();
});

test("provider status is request-time status and no-marker responses never imply fresh positions", () => {
  const row = observations.rowsFromResponse({ provider: "yango", result: { status: "available", drivers: [], requestedCategory: "car" }, pickup, receivedAt, weather: { source: "UNAVAILABLE" } })[0];
  assert.equal(row.providerStatus, "available");
  assert.equal(row.freshnessStatus, "unknown");
  assert.equal(row.markerLatitude, null);
  assert.equal(row.distanceMeters, null);
});
