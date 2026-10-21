-- Durable request claims and sanitized tool execution context for Phase 2.
-- Apply only after migrations 012 and 013 have been separately verified.

CREATE TABLE IF NOT EXISTS ai_request_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  client_message_id text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'UNCERTAIN')),
  tool_execution_json jsonb,
  response_json jsonb,
  comparison_id uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(user_id, conversation_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_request_runs_user_created
  ON ai_request_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_request_runs_conversation_created
  ON ai_request_runs(conversation_id, created_at DESC);
