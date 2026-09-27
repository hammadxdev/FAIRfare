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
  ssl: process.env.PG_SSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
}) : null;

async function checkPostgres() {
  if (!pool) return { configured: false, reachable: false };
  const client = await pool.connect();
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
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

function requirePool() { if (!pool) throw new Error("PostgreSQL is not configured"); return pool; }
module.exports = { pool, requirePool, query: (text, params) => requirePool().query(text, params), checkPostgres, withTransaction };
