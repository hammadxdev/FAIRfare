-- Sanitized, short-lived provider diagnostics. Raw authentication material is
-- intentionally excluded by the application allowlists.
CREATE TABLE IF NOT EXISTS provider_api_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('indrive', 'yango')),
  operation TEXT NOT NULL CHECK (operation IN ('pricing', 'route_stats')),
  comparison_id UUID NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  http_status INTEGER NULL CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT provider_api_payloads_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS provider_api_payloads_expiry_idx ON provider_api_payloads (expires_at);
CREATE INDEX IF NOT EXISTS provider_api_payloads_comparison_idx ON provider_api_payloads (comparison_id, created_at DESC);

ALTER TABLE provider_api_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE provider_api_payloads FROM PUBLIC;
REVOKE ALL ON TABLE provider_api_payloads FROM anon;
REVOKE ALL ON TABLE provider_api_payloads FROM authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE provider_api_payloads TO service_role;

COMMENT ON TABLE provider_api_payloads IS 'Backend-only sanitized inDrive/Yango diagnostics; never stores credentials and expires quickly.';
