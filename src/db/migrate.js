// Supabase migrations are reviewed and executed in the Supabase SQL Editor.
// This command intentionally does not run SQLite DDL or mutate production.
if (require.main === module) console.log("No database changes were applied. Review src/db/migrations/018_passwordless_email_otp.sql and apply it manually only to an approved database.");
module.exports = { runMigrations: async () => undefined };
