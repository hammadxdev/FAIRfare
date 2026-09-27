-- Additive email-auth schema. Run after migrations 001, 002, and 003.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE password_reset_requests
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_hash text,
  ADD COLUMN IF NOT EXISTS reset_token_hash text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

CREATE TABLE IF NOT EXISTS email_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'EMAIL_VERIFICATION',
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  used_at timestamptz,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_requests_user_active
  ON email_verification_requests(user_id, created_at DESC)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_active
  ON password_reset_requests(user_id, created_at DESC)
  WHERE used_at IS NULL;
