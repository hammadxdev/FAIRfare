-- Persist the number of successful user-requested verification resends.
-- Initial delivery is resend_count = 0; the application permits two resends.
ALTER TABLE email_verification_requests
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0;

ALTER TABLE email_verification_requests
  DROP CONSTRAINT IF EXISTS email_verification_requests_resend_count_check;

ALTER TABLE email_verification_requests
  ADD CONSTRAINT email_verification_requests_resend_count_check
  CHECK (resend_count >= 0 AND resend_count <= 2);
