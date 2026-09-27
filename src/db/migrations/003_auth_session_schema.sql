-- Additive auth-session compatibility fix for the PostgreSQL runtime.
-- Run after 001_supabase_compatibility.sql and 002_runtime_postgres_additive.sql.
-- This does not drop, recreate, or delete existing sessions.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
