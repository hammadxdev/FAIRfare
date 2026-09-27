// Supabase migrations are reviewed and executed in the Supabase SQL Editor.
// This command intentionally does not run SQLite DDL or mutate production.
if (require.main === module) console.log("Run src/db/migrations/001_supabase_compatibility.sql and 002_runtime_postgres_additive.sql in Supabase SQL Editor.");
module.exports = { runMigrations: async () => undefined };
