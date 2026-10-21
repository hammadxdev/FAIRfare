let Pool;
try { ({ Pool } = require("pg")); } catch (error) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("The pg dependency is required for production PostgreSQL deployments.");
}

const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in production; SQLite is not supported on Vercel.");
}

const pool = process.env.DATABASE_URL && Pool ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 2),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  // Enforce query cancellation in PostgreSQL. An application-side race only
  // stops waiting; it does not stop the server-side query or make releasing a
  // client safe.
  statement_timeout: Number.isFinite(Number(process.env.PG_STATEMENT_TIMEOUT_MS))
    ? Math.max(250, Math.min(30000, Number(process.env.PG_STATEMENT_TIMEOUT_MS)))
    : 5000,
  ssl: process.env.PG_SSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
}) : null;

const TRANSIENT_CONNECT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);
const configuredConnectRetries = Number(process.env.PG_CONNECT_RETRIES || 1);
const CONNECT_RETRIES = Number.isFinite(configuredConnectRetries) && configuredConnectRetries >= 0
  ? Math.floor(configuredConnectRetries)
  : 1;

function isTransientConnectError(error) {
  return TRANSIENT_CONNECT_CODES.has(String(error?.code || ""));
}

async function connectWithRetry() {
  let attempt = 0;
  while (true) {
    try { return await pool.connect(); }
    catch (error) {
      if (!isTransientConnectError(error) || attempt >= CONNECT_RETRIES) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

async function checkPostgres() {
  if (!pool) return { configured: false, reachable: false };
  const client = await connectWithRetry();
  try { await client.query("SELECT 1"); return { configured: true, reachable: true }; }
  catch (error) {
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
      const safeMessages = { "28P01": "database authentication failed", ENOTFOUND: "database host lookup failed", ECONNREFUSED: "database connection refused", ETIMEDOUT: "database connection timed out" };
      console.error("[DB] health check failed", { code: error.code || "DATABASE_ERROR", message: safeMessages[error.code] || "database health query failed" });
    }
    throw error;
  }
  finally { client.release(); }
}

async function withTransaction(work) {
  if (!pool) throw new Error("PostgreSQL is not configured");
  // Retry only connection establishment. Retrying after BEGIN/queries could
  // replay a token rotation after the database has already committed it.
  const client = await connectWithRetry();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) { rollbackError.suppressRawLog = true; }
    throw error;
  }
  finally { client.release(); }
}

function requirePool() { if (!pool) throw new Error("PostgreSQL is not configured"); return pool; }
module.exports = { pool, requirePool, query: (text, params) => requirePool().query(text, params), checkPostgres, withTransaction };
