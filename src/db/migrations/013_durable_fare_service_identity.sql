-- Durable, sanitized provider-service identity for authenticated comparison snapshots.
-- Additive only. Run after 012_email_verification_resend.sql.

ALTER TABLE comparison_history_quotes
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS provider_display_name text,
  ADD COLUMN IF NOT EXISTS service_code text,
  ADD COLUMN IF NOT EXISTS provider_service_name text,
  ADD COLUMN IF NOT EXISTS provider_service_label text,
  ADD COLUMN IF NOT EXISTS verified_vehicle_category text,
  ADD COLUMN IF NOT EXISTS service_category_confidence text,
  ADD COLUMN IF NOT EXISTS service_category_provenance text,
  ADD COLUMN IF NOT EXISTS service_tier text,
  ADD COLUMN IF NOT EXISTS service_metadata_json jsonb,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS quote_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'comparison_history_quotes_source_type_check'
      AND conrelid = 'comparison_history_quotes'::regclass
  ) THEN
    ALTER TABLE comparison_history_quotes
      ADD CONSTRAINT comparison_history_quotes_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('actual_provider', 'historical', 'estimated', 'unavailable'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_history_quotes_service_identity
  ON comparison_history_quotes(comparison_id, provider_id, service_code);

CREATE INDEX IF NOT EXISTS idx_history_quotes_service_code
  ON comparison_history_quotes(comparison_id, service_code);
