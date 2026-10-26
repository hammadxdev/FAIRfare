-- Unified passwordless email OTP authentication.
-- Authored only; do not apply to a live database without a separately approved migration window.

ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM users
     WHERE email IS NOT NULL
     GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce normalized email uniqueness: duplicate normalized users.email values exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique_idx
  ON users (lower(btrim(email)));

CREATE TABLE IF NOT EXISTS email_login_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  resend_count integer NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 2),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_login_challenges_active_idx
  ON email_login_challenges (email, created_at DESC)
  WHERE used_at IS NULL;

-- Keep the existing API limiter usable without requiring the guest-auth migration.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key text NOT NULL,
  subject_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (bucket_key, subject_hash)
);
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON api_rate_limits (window_started_at);

ALTER TABLE email_login_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE email_login_challenges FROM PUBLIC;
REVOKE ALL ON TABLE email_login_challenges FROM anon;
REVOKE ALL ON TABLE email_login_challenges FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_login_challenges TO service_role;

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE api_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE api_rate_limits FROM anon;
REVOKE ALL ON TABLE api_rate_limits FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE api_rate_limits TO service_role;
