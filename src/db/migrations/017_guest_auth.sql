-- Additive guest identity support for the existing FairFare JWT/session system.
-- This file is authored for manual review and has not been applied.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (bucket_key, subject_hash)
);

CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON api_rate_limits (window_started_at);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE api_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE api_rate_limits FROM anon;
REVOKE ALL ON TABLE api_rate_limits FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE api_rate_limits TO service_role;
