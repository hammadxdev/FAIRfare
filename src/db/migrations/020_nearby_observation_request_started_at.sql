-- Add backend handler-start time separately from response receipt and provider
-- position capture. Existing rows remain receipt-time observations; their
-- request start cannot be reconstructed and is intentionally left NULL.
ALTER TABLE public.nearby_observations
  ADD COLUMN IF NOT EXISTS request_started_at timestamptz;

ALTER TABLE public.nearby_observations
  DROP CONSTRAINT IF EXISTS nearby_observations_time_context_basis_check;

ALTER TABLE public.nearby_observations
  ADD CONSTRAINT nearby_observations_time_context_basis_check
  CHECK (time_context_basis IN ('backend_received_at', 'backend_request_started_at'));

ALTER TABLE public.nearby_observations
  DROP CONSTRAINT IF EXISTS nearby_observations_request_context_check;

ALTER TABLE public.nearby_observations
  ADD CONSTRAINT nearby_observations_request_context_check
  CHECK (
    (time_context_basis = 'backend_request_started_at' AND request_started_at IS NOT NULL)
    OR (time_context_basis = 'backend_received_at' AND request_started_at IS NULL)
  );

COMMENT ON COLUMN public.nearby_observations.request_started_at IS
  'FairFare backend nearby-handler start time; distinct from provider response received_at and verified vehicle-position provider_captured_at.';

COMMENT ON COLUMN public.nearby_observations.time_context_basis IS
  'backend_request_started_at for new observations with a captured handler start; backend_received_at for unchanged legacy observations or pre-020 compatibility writes.';
