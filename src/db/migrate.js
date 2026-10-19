// Supabase migrations are reviewed and executed in the Supabase SQL Editor.
// This command intentionally does not run SQLite DDL or mutate production.
if (require.main === module) console.log("Run src/db/migrations/001_supabase_compatibility.sql, 002_runtime_postgres_additive.sql, 005_runtime_schema_reconciliation.sql, 006_ai_message_idempotency.sql, 007_weather_observation_columns.sql, 008_comparison_enrichment.sql, 009_indrive_session_rotation.sql, 010_provider_api_payloads.sql, and 011_provider_runtime_config.sql in Supabase SQL Editor.");
module.exports = { runMigrations: async () => undefined };
