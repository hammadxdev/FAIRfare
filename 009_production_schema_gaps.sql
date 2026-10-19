-- Production schema gap reconciliation.
-- Run after src/db/migrations/008_comparison_enrichment.sql in Supabase SQL Editor.
-- Additive and repeatable: it does not drop, rename, or rewrite existing data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created ON saved_routes (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created_at ON saved_routes (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_user_created ON comparison_history (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated ON ai_conversations (user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_fare_searches_created ON fare_searches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fare_results_search ON fare_results (search_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_rates_provider_type ON vehicle_rates (provider_id, vehicle_type);
CREATE INDEX IF NOT EXISTS idx_email_verification_requests_user_active ON email_verification_requests (user_id, created_at DESC) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_active ON password_reset_requests (user_id, created_at DESC) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_history_quotes_comparison ON comparison_history_quotes (comparison_id, id);
CREATE INDEX IF NOT EXISTS idx_fare_observations_observed_at ON fare_observations (observed_at);
CREATE INDEX IF NOT EXISTS idx_comparison_history_enrichment_expiry ON comparison_history (user_id, enrichment_expires_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS client_message_id text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS raw_response_sanitized jsonb;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS enrichment_json jsonb;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS enrichment_created_at timestamptz;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS enrichment_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_conversation_client
  ON ai_messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
