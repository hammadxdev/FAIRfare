-- Fair Fare PostgreSQL compatibility migration.
-- This migration is additive and intentionally does not drop or rewrite data.
-- Run it only after reviewing the existing Supabase schema and confirming its
-- identifiers/foreign keys match the application contract.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preferred_vehicle_type text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS avoided_vehicle_types jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS typical_budget numeric;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ride_priority text NOT NULL DEFAULT 'BALANCED';
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS raw_response_sanitized jsonb;

CREATE TABLE IF NOT EXISTS user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS phone_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  purpose text NOT NULL,
  code_hash text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(refresh_token_hash, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created ON saved_routes(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_user_created ON comparison_history(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated ON ai_conversations(user_id, updated_at DESC, id DESC);
