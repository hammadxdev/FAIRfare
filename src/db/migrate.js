// Supabase migrations are reviewed and executed in the Supabase SQL Editor.
// This command intentionally does not run SQLite DDL or mutate production.
if (require.main === module) console.log("Run src/db/migrations/001_supabase_compatibility.sql, 002_runtime_postgres_additive.sql, 005_runtime_schema_reconciliation.sql, 006_ai_message_idempotency.sql, 007_weather_observation_columns.sql, and 008_comparison_enrichment.sql in Supabase SQL Editor.");
module.exports = { runMigrations: async () => undefined };
