const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = require("../services/providerRuntimeConfig.service");

function row(overrides = {}) {
  return {
    provider: "yango", enabled: true, active: true, mode: "authorized-live",
    app_version: null, language: "en-US", os_type: "android", app_flavor: "yango",
    api_base_url: "https://tc.taxi.yango.tech", api_path: "/3.0/routestats", autocomplete_path: null,
    timeout_ms: 10000, refresh_buffer_seconds: 0, default_zone: "lahore", default_class: "econom",
    default_payment_type: "cash", authorization_verified: true, live_authorized: true, config_version: 1,
    ...overrides,
  };
}

const activatedEnv = { PROVIDER_RUNTIME_CONFIG_ENABLED: "true", PROVIDER_RUNTIME_CONFIG_ACTIVATED: "true", PROVIDER_RUNTIME_CONFIG_LIVE_CUTOVER: "true", PROVIDER_RUNTIME_CONFIG_REFRESH_MS: "1000" };
const fallbackYango = { enabled: false, baseUrl: "https://env.example", routeStatsPath: "/env", timeoutMs: 10000, zoneName: "lahore", selectedClass: "econom", paymentType: "cash", authorizationVerified: false, mode: "unavailable" };

test.beforeEach(() => runtime.resetForTests());
test.after(() => runtime.resetForTests());

test("valid Supabase rows load only after explicit activation", { concurrency: false }, async () => {
  runtime.setQueryForTests(async () => ({ rows: [row()] }));
  const result = await runtime.loadProviderRuntimeConfig("yango", { env: activatedEnv });
  assert.equal(result.source, "supabase");
  assert.equal(result.active, true);
  assert.equal(result.config.apiBaseUrl, "https://tc.taxi.yango.tech");
});

test("disabled activation does not query or change provider configuration", { concurrency: false }, async () => {
  let queried = false;
  runtime.setQueryForTests(async () => { queried = true; return { rows: [row()] }; });
  const result = await runtime.resolveProviderConfig("yango", fallbackYango, { env: { PROVIDER_RUNTIME_CONFIG_ENABLED: "false", PROVIDER_RUNTIME_CONFIG_ACTIVATED: "false" } });
  assert.equal(queried, false);
  assert.equal(result.source, "environment");
  assert.deepEqual(result.config, fallbackYango);
});

test("invalid rows and database failures fail closed to environment configuration", { concurrency: false }, async () => {
  runtime.setQueryForTests(async () => ({ rows: [row({ api_base_url: "http://insecure.example" })] }));
  const invalid = await runtime.resolveProviderConfig("yango", fallbackYango, { env: activatedEnv });
  assert.equal(invalid.activated, false);
  assert.equal(invalid.reason, "invalid_configuration");
  runtime.resetForTests();
  runtime.setQueryForTests(async () => { throw Object.assign(new Error("db unavailable"), { code: "ECONNREFUSED" }); });
  const unavailable = await runtime.resolveProviderConfig("yango", fallbackYango, { env: activatedEnv });
  assert.equal(unavailable.reason, "database_unavailable");
  assert.deepEqual(unavailable.config, fallbackYango);
});

test("live configuration still requires explicit cutover and existing authorization", { concurrency: false }, async () => {
  runtime.setQueryForTests(async () => ({ rows: [row()] }));
  const noCutover = await runtime.resolveProviderConfig("yango", { ...fallbackYango, authorizationVerified: true }, { env: { ...activatedEnv, PROVIDER_RUNTIME_CONFIG_LIVE_CUTOVER: "false" } });
  assert.equal(noCutover.config.mode, "unavailable");
  runtime.resetForTests();
  runtime.setQueryForTests(async () => ({ rows: [row()] }));
  const envNotVerified = await runtime.resolveProviderConfig("yango", fallbackYango, { env: activatedEnv });
  assert.equal(envNotVerified.config.mode, "unavailable");
});

test("environment export excludes credentials and is inactive", () => {
  const rows = runtime.runtimeConfigExportFromEnvironment({
    indrive: { enabled: true, mode: "simulated", appVersion: "android", language: "en_US", osType: "android", appFlavor: "indriver", pricingUrl: "https://example.test/price", autocompleteUrl: "https://example.test/autocomplete", timeoutMs: 10000, refreshBufferSeconds: 300, accessToken: "secret", refreshToken: "secret" },
    yango: { enabled: false, mode: "unavailable", baseUrl: "https://example.test", routeStatsPath: "/route", timeoutMs: 10000, zoneName: "lahore", selectedClass: "econom", paymentType: "cash", accessToken: "secret", clientId: "secret" },
  });
  assert.equal(rows.every((item) => item.active === false), true);
  assert.equal(JSON.stringify(rows).includes("secret"), false);
  assert.equal(Object.keys(rows[0]).some((key) => /token|fingerprint|cookie|secret/i.test(key)), false);
});

test("runtime migration has backend-only grants and no secret columns", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/011_provider_runtime_config.sql"), "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE provider_runtime_config FROM anon/);
  assert.match(sql, /REVOKE ALL ON TABLE provider_runtime_config FROM authenticated/);
  assert.doesNotMatch(sql, /access_token|refresh_token|fingerprint|cookie|authorization_header/i);
});
