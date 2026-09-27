-- Runtime PostgreSQL dependencies missing from the original compatibility file.
-- Additive only: safe to run in Supabase SQL Editor after 001.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
  display_name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  logo_url text, deep_link_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vehicle_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL, base_fare numeric NOT NULL, per_km_rate numeric NOT NULL,
  per_min_rate numeric NOT NULL, minimum_fare numeric NOT NULL, surge_multiplier numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id, vehicle_type)
);
CREATE TABLE IF NOT EXISTS fare_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pickup_name text NOT NULL, pickup_lat numeric NOT NULL,
  pickup_lng numeric NOT NULL, dropoff_name text NOT NULL, dropoff_lat numeric NOT NULL, dropoff_lng numeric NOT NULL,
  vehicle_type text NOT NULL, distance_km numeric NOT NULL, duration_min numeric NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fare_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), search_id uuid NOT NULL REFERENCES fare_searches(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id), estimated_fare numeric NOT NULL, eta_min numeric NOT NULL,
  is_cheapest boolean NOT NULL DEFAULT false, is_fastest boolean NOT NULL DEFAULT false,
  is_recommended boolean NOT NULL DEFAULT false, breakdown_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_sessions (
  provider text PRIMARY KEY, access_token text, refresh_token text, access_expires_at bigint,
  status text NOT NULL, updated_at bigint NOT NULL
);

-- AI conversations/messages are explicitly PostgreSQL tables in production.
-- Keep identifiers compatible with the Supabase UUID-based user schema.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Chat',
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content text NOT NULL,
  model_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages(conversation_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_fare_searches_created ON fare_searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fare_results_search ON fare_results(search_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_rates_provider_type ON vehicle_rates(provider_id, vehicle_type);
