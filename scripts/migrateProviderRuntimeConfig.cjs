// Load the project/hosting environment before importing the PostgreSQL pool.
// postgres.js intentionally reads DATABASE_URL at module initialization.
require("../src/config/env");
const { query } = require("../src/config/postgres");
const { getConfig: getIndriveConfig } = require("../src/providers/indrive/indrive.constants");
const { getConfig: getYangoConfig } = require("../src/providers/yango/yango.constants");
const { runtimeConfigExportFromEnvironment, validateRuntimeConfig } = require("../src/services/providerRuntimeConfig.service");

function sqlValue(value) { return value === null || value === undefined ? null : value; }

async function main() {
  const rows = runtimeConfigExportFromEnvironment({ indrive: getIndriveConfig(), yango: getYangoConfig() });
  for (const row of rows) {
    const validation = validateRuntimeConfig(row);
    if (!validation.valid) throw new Error(`${row.provider} configuration is invalid: ${validation.errors.join(", ")}`);
  }
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", providers: rows.map((row) => ({ provider: row.provider, active: row.active, mode: row.mode, enabled: row.enabled, api_base_url: row.api_base_url, api_path: row.api_path })) }, null, 2));
    console.log("No database changes made. Re-run with --apply after reviewing the sanitized settings.");
    return;
  }
  for (const row of rows) {
    await query(`
      INSERT INTO provider_runtime_config
        (provider, enabled, active, mode, app_version, language, os_type, app_flavor, api_base_url, api_path, autocomplete_path, timeout_ms, refresh_buffer_seconds, default_zone, default_class, default_payment_type, authorization_verified, live_authorized, config_version, updated_at, activated_at)
      VALUES ($1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NULL)
      ON CONFLICT (provider) DO UPDATE SET
        enabled=EXCLUDED.enabled, active=false, mode=EXCLUDED.mode,
        app_version=EXCLUDED.app_version, language=EXCLUDED.language,
        os_type=EXCLUDED.os_type, app_flavor=EXCLUDED.app_flavor,
        api_base_url=EXCLUDED.api_base_url, api_path=EXCLUDED.api_path,
        autocomplete_path=EXCLUDED.autocomplete_path, timeout_ms=EXCLUDED.timeout_ms,
        refresh_buffer_seconds=EXCLUDED.refresh_buffer_seconds,
        default_zone=EXCLUDED.default_zone, default_class=EXCLUDED.default_class,
        default_payment_type=EXCLUDED.default_payment_type,
        authorization_verified=false, live_authorized=false,
        config_version=EXCLUDED.config_version, updated_at=NOW(), activated_at=NULL`,
    [row.provider, row.enabled, row.mode, sqlValue(row.app_version), sqlValue(row.language), sqlValue(row.os_type), sqlValue(row.app_flavor), sqlValue(row.api_base_url), sqlValue(row.api_path), sqlValue(row.autocomplete_path), row.timeout_ms, row.refresh_buffer_seconds, sqlValue(row.default_zone), sqlValue(row.default_class), sqlValue(row.default_payment_type), false, false, row.config_version]);
  }
  console.log("Sanitized provider runtime configuration imported inactive. No credentials were read or stored.");
}

main().catch((error) => { console.error("Provider runtime configuration import failed:", error.code || "DATABASE_ERROR"); process.exitCode = 1; });
