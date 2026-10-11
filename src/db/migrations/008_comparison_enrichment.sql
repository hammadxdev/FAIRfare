-- Persist non-provider enrichment for authenticated comparison history.
-- Existing fare history and quotes are intentionally left unchanged.
ALTER TABLE comparison_history
  ADD COLUMN IF NOT EXISTS enrichment_json jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_comparison_history_enrichment_expiry
  ON comparison_history (user_id, enrichment_expires_at);
