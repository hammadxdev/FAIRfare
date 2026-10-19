const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const storage = require("../services/providerApiPayloadStorage.service");

const originalEnabled = process.env.PROVIDER_API_PAYLOAD_STORAGE_ENABLED;
const originalRetention = process.env.PROVIDER_API_PAYLOAD_RETENTION_DAYS;

test.after(() => {
  if (originalEnabled === undefined) delete process.env.PROVIDER_API_PAYLOAD_STORAGE_ENABLED;
  else process.env.PROVIDER_API_PAYLOAD_STORAGE_ENABLED = originalEnabled;
  if (originalRetention === undefined) delete process.env.PROVIDER_API_PAYLOAD_RETENTION_DAYS;
  else process.env.PROVIDER_API_PAYLOAD_RETENTION_DAYS = originalRetention;
  storage.resetStorageStateForTests();
});

test("inDrive sanitizer keeps fare-contract fields and drops credentials", () => {
  const sanitized = storage.sanitizePayload("indrive", "pricing", {
    order_type_ids: [1, "2"],
    route: [{ latitude: 31.4, longitude: 74.4 }, { latitude: 31.5, longitude: 74.3 }],
    geo: { distance_meters: 1200, duration_seconds: 600 },
    Authorization: "Bearer secret-token",
    refresh_token: "refresh-secret",
    device_fingerprint: "private-device",
  }, "request");
  assert.deepEqual(sanitized.order_type_ids, [1, 2]);
  assert.equal(sanitized.geo.distance_meters, 1200);
  assert.equal("Authorization" in sanitized, false);
  assert.equal("refresh_token" in sanitized, false);
  assert.equal(JSON.stringify(sanitized).includes("secret"), false);
});

test("provider-specific response allowlists exclude raw authentication and identity fields", () => {
  const indrive = storage.sanitizeInDriveResponse({ calculations: [{ order_type_id: 1, recommended_price: 350, access_token: "secret" }], currency: { code: "PKR", multiplier: 100 }, user_id: "private" });
  assert.equal(indrive.items[0].recommended_price, 350);
  assert.equal(JSON.stringify(indrive).includes("secret"), false);
  assert.equal(JSON.stringify(indrive).includes("private"), false);

  const yango = storage.sanitizeYangoResponse({ currency_rules: { code: "PKR" }, service_levels: [{ class: "econom", price: "PKR 320", prices: { raw: { final_price: 320 } }, id: "private-id", token: "secret" }], state: { location: [74.4, 31.4] } });
  assert.equal(yango.items[0].class, "econom");
  assert.equal(yango.items[0].final_price, 320);
  assert.equal(JSON.stringify(yango).includes("private-id"), false);
  assert.equal(JSON.stringify(yango).includes("secret"), false);
  assert.equal(JSON.stringify(yango).includes("location"), false);
});

test("storage is best-effort, applies retention, and cleanup is non-critical", async () => {
  storage.setEnabledForTests(true);
  process.env.PROVIDER_API_PAYLOAD_RETENTION_DAYS = "7";
  const calls = [];
  storage.setQueryForTests(async (text, params) => {
    calls.push({ text, params });
    return { rowCount: 1 };
  });
  const result = await storage.recordProviderApiPayload({ provider: "yango", operation: "route_stats", requestPayload: { zone_name: "lahore", route: [[74.4, 31.4], [74.3, 31.5]], id: "secret-user" }, responsePayload: { service_levels: [{ class: "econom", prices: { raw: { final_price: 300 } } }] }, httpStatus: 200, createdAt: new Date("2026-01-01T00:00:00Z") });
  assert.equal(result.stored, true);
  assert.equal(calls[0].params[2], null);
  assert.equal(calls[0].params[5], 200);
  assert.match(calls[0].params[7], /2026-01-08T00:00:00\.000Z/);
  assert.doesNotMatch(calls[0].params[3], /secret-user/);
  assert.match(calls[0].text, /INSERT INTO provider_api_payloads/);

  storage.setQueryForTests(async () => { throw Object.assign(new Error("db down"), { code: "ECONNREFUSED" }); });
  const failed = await storage.recordProviderApiPayload({ provider: "indrive", operation: "pricing", requestPayload: {}, responsePayload: {}, httpStatus: 503 });
  assert.deepEqual(failed, { stored: false, reason: "storage_failed" });
  const cleanup = await storage.cleanupExpiredProviderApiPayloads();
  assert.deepEqual(cleanup, { deleted: 0, skipped: false, failed: true });
  storage.resetStorageStateForTests();
});

test("migration denies public and client roles and enables RLS", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/010_provider_api_payloads.sql"), "utf8");
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE provider_api_payloads FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON TABLE provider_api_payloads FROM anon/);
  assert.match(migration, /REVOKE ALL ON TABLE provider_api_payloads FROM authenticated/);
  assert.doesNotMatch(migration, /CREATE POLICY.*USING\s*\(true\)/is);
});
