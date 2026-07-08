const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
require("dotenv").config({ quiet: true });

function resolveDbPath() {
  // If DB_PATH is explicitly provided
  if (process.env.DB_PATH) {
    // Important:
    // If DB_PATH is absolute like /tmp/fairfair.sqlite, do not resolve it against cwd.
    if (path.isAbsolute(process.env.DB_PATH)) {
      return process.env.DB_PATH;
    }

    return path.resolve(process.cwd(), process.env.DB_PATH);
  }

  // Vercel runtime filesystem is read-only except /tmp
  if (process.env.VERCEL) {
    return "/tmp/fairfair.sqlite";
  }

  // Local development default
  return path.resolve(process.cwd(), "data", "fairfair.sqlite");
}

const dbPath = resolveDbPath();

const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// WAL can cause issues on serverless /tmp environments.
// Use WAL locally, but avoid it on Vercel.
if (!process.env.VERCEL) {
  db.pragma("journal_mode = WAL");
}

db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

module.exports = db;
