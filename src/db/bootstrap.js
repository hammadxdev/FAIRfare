// Deliberately does NOT gate on an in-memory "already bootstrapped" flag.
// On Vercel's Fluid Compute runtime, a warm JS execution context can be
// reused across invocations while /tmp (where the SQLite file lives) gets
// reset independently — an in-memory flag would then wrongly report "ready"
// while the underlying database is actually empty, causing
// "no such table: providers" the moment any controller's top-level
// Retained only as a compatibility export for older local tooling. The
// application does not call this function; production uses Supabase directly.
async function ensureDatabaseReady() { return undefined; }

module.exports = {
  ensureDatabaseReady,
};
