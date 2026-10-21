-- Phase 3: verified FareRide knowledge and durable assistant memory.
-- Additive only. Apply after migrations 012, 013 and 014 have been reviewed
-- and verified in staging. No knowledge rows are seeded by this migration.

CREATE TABLE IF NOT EXISTS fairfare_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('provider_service', 'vehicle_category', 'app_help', 'policy', 'support_faq', 'integration_explanation')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  language text NOT NULL CHECK (language IN ('english', 'roman_urdu', 'mixed')),
  source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 160),
  source_locator text,
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 120),
  provenance text NOT NULL CHECK (length(provenance) BETWEEN 1 AND 500),
  verification_status text NOT NULL DEFAULT 'draft' CHECK (verification_status IN ('draft', 'reviewed', 'verified', 'retired')),
  verified_at timestamptz,
  effective_from timestamptz,
  effective_until timestamptz,
  content_hash text NOT NULL CHECK (length(content_hash) BETWEEN 1 AND 128),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, source_version),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
  CHECK (verification_status <> 'verified' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_fairfare_knowledge_documents_status
  ON fairfare_knowledge_documents (verification_status, effective_from, effective_until);

CREATE TABLE IF NOT EXISTS fairfare_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES fairfare_knowledge_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  heading text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 12000),
  aliases text[] NOT NULL DEFAULT '{}',
  search_vector tsvector NOT NULL DEFAULT ''::tsvector,
  token_count integer CHECK (token_count IS NULL OR token_count BETWEEN 1 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_fairfare_knowledge_chunks_search
  ON fairfare_knowledge_chunks USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_fairfare_knowledge_chunks_document
  ON fairfare_knowledge_chunks (document_id, chunk_index);

CREATE TABLE IF NOT EXISTS ai_conversation_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary_text text NOT NULL CHECK (length(summary_text) BETWEEN 1 AND 8000),
  summary_version integer NOT NULL DEFAULT 1 CHECK (summary_version >= 1),
  covered_through_message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
  covered_through_created_at timestamptz,
  source_message_count integer NOT NULL DEFAULT 0 CHECK (source_message_count >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, summary_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_summaries_lookup
  ON ai_conversation_summaries (user_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_conversation_context (
  conversation_id uuid PRIMARY KEY REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_comparison_id uuid REFERENCES comparison_history(id) ON DELETE SET NULL,
  saved_route_id uuid REFERENCES saved_routes(id) ON DELETE SET NULL,
  pickup_place_id text,
  destination_place_id text,
  active_provider_id text,
  active_service_code text,
  route_distance_meters numeric CHECK (route_distance_meters IS NULL OR route_distance_meters >= 0),
  route_duration_seconds numeric CHECK (route_duration_seconds IS NULL OR route_duration_seconds >= 0),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_context_user_expiry
  ON ai_conversation_context (user_id, expires_at);

CREATE TABLE IF NOT EXISTS ai_conversation_comparison_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
  comparison_id uuid NOT NULL REFERENCES comparison_history(id) ON DELETE CASCADE,
  reference_type text NOT NULL CHECK (reference_type IN ('created', 'used', 'mentioned')),
  provider_id text,
  service_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, message_id, comparison_id, reference_type)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_comparison_refs_lookup
  ON ai_conversation_comparison_refs (user_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_comparison_refs_comparison
  ON ai_conversation_comparison_refs (user_id, comparison_id, created_at DESC);
