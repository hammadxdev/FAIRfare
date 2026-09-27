if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  throw new Error("SQLite is disabled in production; use src/config/postgres.js");
}
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
// Resolve the backend environment from this module's location so `npm start`
// behaves the same whether launched from D:\\ride or D:\\ride\\backend.
function resolveDbPath() {
  // If DB_PATH is explicitly provided
  if (process.env.DB_PATH) {
    if (path.isAbsolute(process.env.DB_PATH)) {
      return process.env.DB_PATH;
    }

    return path.resolve(process.cwd(), process.env.DB_PATH);
  }

  // Local development default
  return path.resolve(process.cwd(), "data", "fairfair.sqlite");
}

const dbPath = resolveDbPath();

const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const readOnly = process.env.FAIRFARE_READ_ONLY === "true";
const db = new Database(dbPath, readOnly ? { readonly: true, fileMustExist: true } : undefined);

// WAL can cause issues on serverless /tmp environments.
// Use WAL locally, but avoid it on Vercel.
if (!process.env.VERCEL && !readOnly) {
  db.pragma("journal_mode = WAL");
}

db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

module.exports = db;
