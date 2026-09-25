const fs = require("fs");
const path = require("path");
const db = require("../config/database");

function runMigrations() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  db.exec(schema);

  // Saved routes are user-owned reusable locations. The CREATE/INDEX statements
  // in schema.sql are intentionally idempotent for existing Version 1 databases.
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      label_type TEXT NOT NULL,
      pickup_name TEXT NOT NULL,
      pickup_address TEXT,
      pickup_latitude REAL NOT NULL,
      pickup_longitude REAL NOT NULL,
      destination_name TEXT NOT NULL,
      destination_address TEXT,
      destination_latitude REAL NOT NULL,
      destination_longitude REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created_at ON saved_routes(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_routes_user_label_type ON saved_routes(user_id, label_type);
  `);

  // AI conversations are separate from fare comparison history and are
  // user-owned. These statements are safe for existing Version 1 databases.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Chat',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
      content TEXT NOT NULL,
      model_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON ai_messages(created_at);
  `);
  const aiMessageColumns = new Set(db.prepare("PRAGMA table_info(ai_messages)").all().map((column) => column.name));
  if (!aiMessageColumns.has("model_id")) db.exec("ALTER TABLE ai_messages ADD COLUMN model_id TEXT");
  const aiConversationColumns = new Set(db.prepare("PRAGMA table_info(ai_conversations)").all().map((column) => column.name));
  if (!aiConversationColumns.has("is_pinned")) db.exec("ALTER TABLE ai_conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0");

  const preferenceColumns = new Set(db.prepare("PRAGMA table_info(user_preferences)").all().map((column) => column.name));
  const preferenceAdditions = {
    preferred_vehicle_type: "TEXT",
    avoided_vehicle_types: "TEXT NOT NULL DEFAULT '[]'",
    typical_budget: "REAL",
    ride_priority: "TEXT NOT NULL DEFAULT 'BALANCED'",
    created_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
    updated_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
  };
  for (const [name, type] of Object.entries(preferenceAdditions)) {
    if (!preferenceColumns.has(name)) db.exec(`ALTER TABLE user_preferences ADD COLUMN ${name} ${type}`);
  }

  const historyColumns = new Set(db.prepare("PRAGMA table_info(comparison_history)").all().map((column) => column.name));
  if (!historyColumns.has("user_id")) db.exec("ALTER TABLE comparison_history ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_comparison_history_user_id_created_at ON comparison_history(user_id, created_at DESC, id DESC)");

  // schema.sql covers new databases. These idempotent ALTERs upgrade the
  // existing Version 1 database without rebuilding or competing with the
  // established fare_observations table.
  const columns = new Set(db.prepare("PRAGMA table_info(fare_observations)").all().map((column) => column.name));
  const additions = {
    data_source: "TEXT NOT NULL DEFAULT 'UNKNOWN'",
    comparison_id: "INTEGER REFERENCES comparison_history(id) ON DELETE SET NULL",
    provider_id: "INTEGER REFERENCES providers(id) ON DELETE SET NULL",
    provider_category_id: "TEXT",
    provider_category_name: "TEXT",
    vehicle_type: "TEXT",
    pickup_latitude: "REAL",
    pickup_longitude: "REAL",
    pickup_zone: "TEXT",
    destination_latitude: "REAL",
    destination_longitude: "REAL",
    destination_zone: "TEXT",
    hour_of_day: "INTEGER",
    day_of_week: "INTEGER",
    is_weekend: "INTEGER",
    raw_response_sanitized: "TEXT",
  };
  for (const [name, type] of Object.entries(additions)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE fare_observations ADD COLUMN ${name} ${type}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fare_observations_observed_at ON fare_observations(observed_at);
    CREATE INDEX IF NOT EXISTS idx_fare_observations_provider_id ON fare_observations(provider_id);
    CREATE INDEX IF NOT EXISTS idx_fare_observations_vehicle_type ON fare_observations(vehicle_type);
    CREATE INDEX IF NOT EXISTS idx_fare_observations_provider_category_id ON fare_observations(provider_category_id);
  `);

  console.log("Database migration completed");
}

if (require.main === module) {
  runMigrations();
}

module.exports = {
  runMigrations,
};
