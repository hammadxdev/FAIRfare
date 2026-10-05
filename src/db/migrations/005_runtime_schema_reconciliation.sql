-- Additive PostgreSQL runtime reconciliation.
-- Run after migrations 001, 002, 003, and 004.
-- This migration creates only missing runtime tables, adds only missing
-- columns, backfills compatible saved-route coordinate aliases, and inserts
-- only missing simulated reference rows. It does not drop or recreate data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  logo_url text,
  deep_link_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL,
  base_fare numeric NOT NULL,
  per_km_rate numeric NOT NULL,
  per_min_rate numeric NOT NULL,
  minimum_fare numeric NOT NULL,
  surge_multiplier numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, vehicle_type)
);

CREATE TABLE IF NOT EXISTS fare_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_name text NOT NULL,
  pickup_lat numeric NOT NULL,
  pickup_lng numeric NOT NULL,
  dropoff_name text NOT NULL,
  dropoff_lat numeric NOT NULL,
  dropoff_lng numeric NOT NULL,
  vehicle_type text NOT NULL,
  distance_km numeric NOT NULL,
  duration_min numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fare_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES fare_searches(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id),
  estimated_fare numeric NOT NULL,
  eta_min numeric NOT NULL,
  is_cheapest boolean NOT NULL DEFAULT false,
  is_fastest boolean NOT NULL DEFAULT false,
  is_recommended boolean NOT NULL DEFAULT false,
  breakdown_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_sessions (
  provider text PRIMARY KEY,
  access_token text,
  refresh_token text,
  access_expires_at bigint,
  status text NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS comparison_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  pickup_label text NOT NULL,
  pickup_latitude numeric NOT NULL,
  pickup_longitude numeric NOT NULL,
  destination_label text NOT NULL,
  destination_latitude numeric NOT NULL,
  destination_longitude numeric NOT NULL,
  distance_meters numeric,
  duration_seconds numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comparison_history_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id uuid NOT NULL REFERENCES comparison_history(id) ON DELETE CASCADE,
  provider text NOT NULL,
  category text,
  fare numeric,
  fare_min numeric,
  fare_max numeric,
  currency text,
  fare_type text,
  pickup_eta_seconds numeric,
  availability text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fare_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source text NOT NULL DEFAULT 'UNKNOWN',
  comparison_id uuid REFERENCES comparison_history(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES providers(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_category text,
  provider_category_id text,
  provider_category_name text,
  normalized_category text,
  vehicle_type text,
  pickup_latitude numeric,
  pickup_longitude numeric,
  pickup_zone text,
  destination_latitude numeric,
  destination_longitude numeric,
  destination_zone text,
  distance_meters numeric,
  duration_seconds numeric,
  fare numeric,
  fare_min numeric,
  fare_max numeric,
  currency text,
  fare_type text,
  pickup_eta_seconds numeric,
  observed_at timestamptz NOT NULL DEFAULT now(),
  hour_of_day integer,
  day_of_week integer,
  is_weekend integer,
  raw_response_sanitized jsonb
);

CREATE TABLE IF NOT EXISTS saved_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  label_type text NOT NULL,
  pickup_name text NOT NULL,
  pickup_address text,
  pickup_latitude numeric NOT NULL,
  pickup_longitude numeric NOT NULL,
  destination_name text NOT NULL,
  destination_address text,
  destination_latitude numeric NOT NULL,
  destination_longitude numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saved_routes ADD COLUMN IF NOT EXISTS pickup_latitude numeric;
ALTER TABLE saved_routes ADD COLUMN IF NOT EXISTS pickup_longitude numeric;
ALTER TABLE saved_routes ADD COLUMN IF NOT EXISTS destination_latitude numeric;
ALTER TABLE saved_routes ADD COLUMN IF NOT EXISTS destination_longitude numeric;
ALTER TABLE saved_routes ADD COLUMN IF NOT EXISTS label_type text;

ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS weather_condition text DEFAULT 'UNKNOWN';
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS weather_severity text DEFAULT 'UNKNOWN';
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS precipitation_mm numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS temperature_c numeric;

-- Some existing Supabase saved_routes variants use *_lat/*_lng. Preserve
-- those values while making the runtime's domain column names canonical.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'pickup_lat') THEN
    EXECUTE 'UPDATE saved_routes SET pickup_latitude = pickup_lat WHERE pickup_latitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'pickup_lng') THEN
    EXECUTE 'UPDATE saved_routes SET pickup_longitude = pickup_lng WHERE pickup_longitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'destination_lat') THEN
    EXECUTE 'UPDATE saved_routes SET destination_latitude = destination_lat WHERE destination_latitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'destination_lng') THEN
    EXECUTE 'UPDATE saved_routes SET destination_longitude = destination_lng WHERE destination_longitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'label') THEN
    EXECUTE 'UPDATE saved_routes SET label_type = label WHERE label_type IS NULL';
  END IF;
END $$;

-- Legacy coordinate columns are no longer written by the runtime. If an
-- existing Supabase table made them NOT NULL, relax only those old
-- constraints so canonical-column inserts remain compatible. Existing
-- values are preserved above; no rows or columns are removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'pickup_lat') THEN
    EXECUTE 'ALTER TABLE saved_routes ALTER COLUMN pickup_lat DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'pickup_lng') THEN
    EXECUTE 'ALTER TABLE saved_routes ALTER COLUMN pickup_lng DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'destination_lat') THEN
    EXECUTE 'ALTER TABLE saved_routes ALTER COLUMN destination_lat DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'destination_lng') THEN
    EXECUTE 'ALTER TABLE saved_routes ALTER COLUMN destination_lng DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_routes' AND column_name = 'label') THEN
    EXECUTE 'ALTER TABLE saved_routes ALTER COLUMN label DROP NOT NULL';
  END IF;
END $$;

-- Reconcile older history and observation shapes without replacing their
-- existing columns. Canonical runtime columns are added and backfilled only
-- when their values are currently NULL.
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS pickup_label text;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS pickup_latitude numeric;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS pickup_longitude numeric;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS destination_label text;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS destination_latitude numeric;
ALTER TABLE comparison_history ADD COLUMN IF NOT EXISTS destination_longitude numeric;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'pickup_name') THEN
    EXECUTE 'UPDATE comparison_history SET pickup_label = pickup_name WHERE pickup_label IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'pickup_lat') THEN
    EXECUTE 'UPDATE comparison_history SET pickup_latitude = pickup_lat WHERE pickup_latitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'pickup_lng') THEN
    EXECUTE 'UPDATE comparison_history SET pickup_longitude = pickup_lng WHERE pickup_longitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'destination_name') THEN
    EXECUTE 'UPDATE comparison_history SET destination_label = destination_name WHERE destination_label IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'destination_lat') THEN
    EXECUTE 'UPDATE comparison_history SET destination_latitude = destination_lat WHERE destination_latitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'destination_lng') THEN
    EXECUTE 'UPDATE comparison_history SET destination_longitude = destination_lng WHERE destination_longitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'pickup_lat') THEN
    EXECUTE 'ALTER TABLE comparison_history ALTER COLUMN pickup_lat DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'pickup_lng') THEN
    EXECUTE 'ALTER TABLE comparison_history ALTER COLUMN pickup_lng DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'destination_lat') THEN
    EXECUTE 'ALTER TABLE comparison_history ALTER COLUMN destination_lat DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history' AND column_name = 'destination_lng') THEN
    EXECUTE 'ALTER TABLE comparison_history ALTER COLUMN destination_lng DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE comparison_history_quotes ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE comparison_history_quotes ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE comparison_history_quotes ADD COLUMN IF NOT EXISTS fare numeric;
ALTER TABLE comparison_history_quotes ADD COLUMN IF NOT EXISTS pickup_eta_seconds numeric;
ALTER TABLE comparison_history_quotes ADD COLUMN IF NOT EXISTS availability text;
ALTER TABLE comparison_history_quotes ADD COLUMN IF NOT EXISTS fare_type text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history_quotes' AND column_name = 'provider_name') THEN
    EXECUTE 'UPDATE comparison_history_quotes SET provider = provider_name WHERE provider IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history_quotes' AND column_name = 'provider_category_name') THEN
    EXECUTE 'UPDATE comparison_history_quotes SET category = provider_category_name WHERE category IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history_quotes' AND column_name = 'pickup_eta_minutes') THEN
    EXECUTE 'UPDATE comparison_history_quotes SET pickup_eta_seconds = pickup_eta_minutes * 60 WHERE pickup_eta_seconds IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history_quotes' AND column_name = 'provider_id') THEN
    EXECUTE 'ALTER TABLE comparison_history_quotes ALTER COLUMN provider_id DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comparison_history_quotes' AND column_name = 'vehicle_type') THEN
    EXECUTE 'ALTER TABLE comparison_history_quotes ALTER COLUMN vehicle_type DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS provider_category text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS normalized_category text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS pickup_latitude numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS pickup_longitude numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS destination_latitude numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS destination_longitude numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS fare_type text;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS fare numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS pickup_eta_seconds numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS hour_of_day integer;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS day_of_week integer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'pickup_lat') THEN
    EXECUTE 'UPDATE fare_observations SET pickup_latitude = pickup_lat WHERE pickup_latitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'pickup_lng') THEN
    EXECUTE 'UPDATE fare_observations SET pickup_longitude = pickup_lng WHERE pickup_longitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'destination_lat') THEN
    EXECUTE 'UPDATE fare_observations SET destination_latitude = destination_lat WHERE destination_latitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'destination_lng') THEN
    EXECUTE 'UPDATE fare_observations SET destination_longitude = destination_lng WHERE destination_longitude IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'observation_hour') THEN
    EXECUTE 'UPDATE fare_observations SET hour_of_day = observation_hour WHERE hour_of_day IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'observation_day_of_week') THEN
    EXECUTE 'UPDATE fare_observations SET day_of_week = observation_day_of_week WHERE day_of_week IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fare_observations' AND column_name = 'created_at') THEN
    EXECUTE 'UPDATE fare_observations SET observed_at = created_at WHERE observed_at IS NULL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created_at ON saved_routes(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(refresh_token_hash, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_history_user_created ON comparison_history(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_quotes_comparison ON comparison_history_quotes(comparison_id, id);
CREATE INDEX IF NOT EXISTS idx_fare_observations_observed_at ON fare_observations(observed_at);

-- Reference data is idempotent and only fills missing simulated providers and
-- rates. Existing provider/rate values are never overwritten.
INSERT INTO providers (name, display_name, is_active, deep_link_url)
VALUES
  ('indrive', 'inDrive', true, 'https://indrive.com'),
  ('quickride', 'Yango', true, 'https://quickride.example.com'),
  ('urbancab', 'Bykea', true, 'https://urbancab.example.com')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vehicle_rates (provider_id, vehicle_type, base_fare, per_km_rate, per_min_rate, minimum_fare, surge_multiplier)
SELECT p.id, r.vehicle_type, r.base_fare, r.per_km_rate, r.per_min_rate, r.minimum_fare, r.surge_multiplier
FROM providers p
JOIN (VALUES
  ('indrive','bike',60,20,1,120,1.05), ('indrive','rickshaw',80,28,1.4,150,1.05), ('indrive','mini',100,34,1.8,200,1.05), ('indrive','car',120,42,2.2,250,1.05),
  ('quickride','bike',50,18,1,110,1), ('quickride','rickshaw',70,25,1.3,140,1), ('quickride','mini',90,30,1.6,190,1), ('quickride','car',110,38,2,230,1),
  ('urbancab','bike',70,22,1.2,130,1.1), ('urbancab','rickshaw',90,30,1.6,160,1.1), ('urbancab','mini',110,38,2,210,1.1), ('urbancab','car',130,48,2.6,270,1.1)
) AS r(provider_name, vehicle_type, base_fare, per_km_rate, per_min_rate, minimum_fare, surge_multiplier)
  ON r.provider_name = p.name
ON CONFLICT (provider_id, vehicle_type) DO NOTHING;
