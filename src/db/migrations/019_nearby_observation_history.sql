-- Additive, privacy-minimized nearby observation history. Authored for review;
-- do not apply before verifying the backend runtime role and effective grants.
-- expires_at is the 90-day historical-retention deadline, NOT position freshness.
-- provider_captured_at is populated only for explicitly verified provider times;
-- received_at is FairFare's backend receipt/request-context time.
CREATE TABLE IF NOT EXISTS public.nearby_observations (
  id bigserial PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('indrive', 'yango', 'bykea')),
  vehicle_category text NOT NULL CHECK (vehicle_category IN ('bike', 'car', 'rickshaw', 'mini', 'unknown')),
  provider_status text NOT NULL CHECK (provider_status IN ('available', 'no_drivers', 'unavailable', 'unknown')),
  pickup_latitude numeric(8,3) NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude numeric(8,3) NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  marker_latitude numeric(8,3) CHECK (marker_latitude BETWEEN -90 AND 90),
  marker_longitude numeric(8,3) CHECK (marker_longitude BETWEEN -180 AND 180),
  CHECK ((marker_latitude IS NULL) = (marker_longitude IS NULL)),
  distance_meters numeric CHECK (distance_meters >= 0),
  distance_method text CHECK (distance_method IS NULL OR distance_method = 'HAVERSINE_STRAIGHT_LINE'),
  pickup_eta_seconds numeric CHECK (pickup_eta_seconds IS NULL OR pickup_eta_seconds >= 0),
  eta_source text CHECK (eta_source IS NULL OR eta_source IN ('PROVIDER_VERIFIED', 'ROUTE_VERIFIED')),
  provider_captured_at timestamptz,
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = received_at + interval '2160 hours'),
  freshness_status text NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown')),
  CHECK (provider_captured_at IS NOT NULL OR freshness_status = 'unknown'),
  local_date date NOT NULL,
  local_weekday smallint NOT NULL CHECK (local_weekday BETWEEN 0 AND 6),
  local_hour smallint NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
  part_of_day text NOT NULL CHECK (part_of_day IN ('Morning', 'Afternoon', 'Evening', 'Night')),
  timezone text NOT NULL DEFAULT 'Asia/Karachi' CHECK (timezone = 'Asia/Karachi'),
  time_context_basis text NOT NULL DEFAULT 'backend_received_at' CHECK (time_context_basis = 'backend_received_at'),
  weather_condition text,
  temperature_c numeric,
  weather_source text,
  weather_observed_at timestamptz,
  weather_unavailable_reason text,
  provenance text NOT NULL CHECK (provenance IN ('authorized_provider_response')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.nearby_observations.provider_status IS
  'Provider response status at request time; does not establish current position freshness.';
COMMENT ON COLUMN public.nearby_observations.freshness_status IS
  'Position trust based only on a verified provider_captured_at and the short application freshness window.';
COMMENT ON COLUMN public.nearby_observations.received_at IS
  'FairFare backend receipt time; basis for Asia/Karachi historical request-time context.';
COMMENT ON COLUMN public.nearby_observations.expires_at IS
  'Historical retention deadline exactly 90 days after received_at; never a live-marker freshness signal.';

CREATE INDEX IF NOT EXISTS nearby_observations_expiry_idx ON public.nearby_observations (expires_at);
CREATE INDEX IF NOT EXISTS nearby_observations_history_idx
  ON public.nearby_observations (provider, vehicle_category, pickup_latitude, pickup_longitude, received_at DESC);
CREATE INDEX IF NOT EXISTS nearby_observations_context_idx
  ON public.nearby_observations (local_date, part_of_day, weather_condition);

-- No client-facing policies are defined. RLS plus revoked table/sequence
-- privileges prevent direct Supabase Data API access to individual records.
-- Before executing, verify the application's actual runtime role and inherited
-- privileges. If that role is neither the table owner nor BYPASSRLS, this
-- no-policy design also requires a separately reviewed role-specific policy or
-- another approved server-only access design before the service can use it.
-- Do not add a grant or policy until that runtime access model is verified.
ALTER TABLE public.nearby_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nearby_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.nearby_observations_id_seq FROM PUBLIC, anon, authenticated;
