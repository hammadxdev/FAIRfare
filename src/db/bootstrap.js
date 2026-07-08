// Deliberately does NOT gate on an in-memory "already bootstrapped" flag.
// On Vercel's Fluid Compute runtime, a warm JS execution context can be
// reused across invocations while /tmp (where the SQLite file lives) gets
// reset independently — an in-memory flag would then wrongly report "ready"
// while the underlying database is actually empty, causing
// "no such table: providers" the moment any controller's top-level
// db.prepare() runs. Both calls below are already idempotent and cheap
// (CREATE TABLE IF NOT EXISTS in schema.sql; seedDatabase() checks the real
// row count before inserting anything), so just always run them.
function ensureDatabaseReady() {
  const { runMigrations } = require("./migrate");
  const { seedDatabase } = require("./seed");

  runMigrations();
  seedDatabase();
}

module.exports = {
  ensureDatabaseReady,
};
