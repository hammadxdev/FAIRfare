-- Validated non-secret provider runtime settings. Tokens and device/session
-- material remain in provider_sessions or the existing secret manager.
CREATE TABLE IF NOT EXISTS provider_runtime_config (
  provider TEXT PRIMARY KEY CHECK (provider IN ('indrive', 'yango')),
  enabled BOOLEAN NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  mode TEXT NOT NULL CHECK (mode IN ('simulated', 'unavailable', 'real', 'authorized-live')),
  app_version TEXT NULL,
  language TEXT NULL,
  os_type TEXT NULL,
  app_flavor TEXT NULL,
  api_base_url TEXT NULL,
  api_path TEXT NULL,
  autocomplete_path TEXT NULL,
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 120000),
  refresh_buffer_seconds INTEGER NOT NULL CHECK (refresh_buffer_seconds BETWEEN 0 AND 86400),
  default_zone TEXT NULL,
  default_class TEXT NULL,
  default_payment_type TEXT NULL,
  authorization_verified BOOLEAN NOT NULL DEFAULT false,
  live_authorized BOOLEAN NOT NULL DEFAULT false,
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  CONSTRAINT provider_runtime_config_active_gate CHECK (active = false OR mode IN ('simulated', 'unavailable') OR (authorization_verified = true AND live_authorized = true))
);

CREATE INDEX IF NOT EXISTS provider_runtime_config_active_idx ON provider_runtime_config (active, provider);

ALTER TABLE provider_runtime_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE provider_runtime_config FROM PUBLIC;
REVOKE ALL ON TABLE provider_runtime_config FROM anon;
REVOKE ALL ON TABLE provider_runtime_config FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE provider_runtime_config TO service_role;

COMMENT ON TABLE provider_runtime_config IS 'Backend-only validated non-secret provider settings; inactive until explicitly activated.';
