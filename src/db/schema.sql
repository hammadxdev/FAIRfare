CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  phone_number TEXT UNIQUE,
  phone_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_verification_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at INTEGER,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS user_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_vehicle_type TEXT,
  avoided_vehicle_types TEXT NOT NULL DEFAULT '[]',
  typical_budget REAL,
  ride_priority TEXT NOT NULL DEFAULT 'BALANCED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(refresh_token_hash, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created_at ON saved_routes(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user_label_type ON saved_routes(user_id, label_type);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  logo_url TEXT,
  deep_link_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL,
  base_fare REAL NOT NULL,
  per_km_rate REAL NOT NULL,
  per_min_rate REAL NOT NULL,
  minimum_fare REAL NOT NULL,
  surge_multiplier REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider_id, vehicle_type)
);

CREATE TABLE IF NOT EXISTS fare_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pickup_name TEXT NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lng REAL NOT NULL,
  dropoff_name TEXT NOT NULL,
  dropoff_lat REAL NOT NULL,
  dropoff_lng REAL NOT NULL,
  vehicle_type TEXT NOT NULL,
  distance_km REAL NOT NULL,
  duration_min REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fare_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id INTEGER NOT NULL REFERENCES fare_searches(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  estimated_fare REAL NOT NULL,
  eta_min REAL NOT NULL,
  is_cheapest INTEGER NOT NULL DEFAULT 0,
  is_fastest INTEGER NOT NULL DEFAULT 0,
  is_recommended INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_sessions (
  provider TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  access_expires_at INTEGER,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fare_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_source TEXT NOT NULL DEFAULT 'UNKNOWN',
  comparison_id INTEGER REFERENCES comparison_history(id) ON DELETE SET NULL,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_category TEXT,
  provider_category_id TEXT,
  provider_category_name TEXT,
  normalized_category TEXT,
  vehicle_type TEXT,
  pickup_latitude REAL,
  pickup_longitude REAL,
  pickup_zone TEXT,
  destination_latitude REAL,
  destination_longitude REAL,
  destination_zone TEXT,
  distance_meters REAL,
  duration_seconds REAL,
  fare REAL,
  fare_min REAL,
  fare_max REAL,
  fare_type TEXT,
  currency TEXT,
  pickup_eta_seconds REAL,
  observed_at INTEGER NOT NULL,
  hour_of_day INTEGER,
  day_of_week INTEGER,
  is_weekend INTEGER,
  raw_response_sanitized TEXT
);

CREATE TABLE IF NOT EXISTS comparison_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pickup_label TEXT NOT NULL,
  pickup_latitude REAL NOT NULL,
  pickup_longitude REAL NOT NULL,
  destination_label TEXT NOT NULL,
  destination_latitude REAL NOT NULL,
  destination_longitude REAL NOT NULL,
  distance_meters REAL,
  duration_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comparison_history_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id INTEGER NOT NULL REFERENCES comparison_history(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  category TEXT,
  fare REAL,
  fare_min REAL,
  fare_max REAL,
  currency TEXT,
  fare_type TEXT,
  pickup_eta_seconds REAL,
  availability TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comparison_history_created_at ON comparison_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comparison_history_quotes_comparison_id ON comparison_history_quotes(comparison_id);

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
  client_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON ai_messages(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_conversation_client ON ai_messages(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;
