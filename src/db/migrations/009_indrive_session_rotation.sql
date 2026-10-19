-- PostgreSQL inDrive token rotation metadata and safe cross-process refresh support.
ALTER TABLE provider_sessions ADD COLUMN IF NOT EXISTS rotation_version bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_sessions ADD COLUMN IF NOT EXISTS last_rotated_at bigint;
