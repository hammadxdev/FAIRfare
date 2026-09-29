-- Make optimistic chat retries idempotent without relying on message text.
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS client_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_conversation_client ON ai_messages(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;
