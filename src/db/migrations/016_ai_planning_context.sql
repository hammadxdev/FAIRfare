-- Additive durable planning context. Do not apply without independent review.
ALTER TABLE ai_conversation_context
  ADD COLUMN IF NOT EXISTS planning_intent text,
  ADD COLUMN IF NOT EXISTS departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS departure_timezone text,
  ADD COLUMN IF NOT EXISTS vehicle_preference text,
  ADD COLUMN IF NOT EXISTS provider_preferences text[],
  ADD COLUMN IF NOT EXISTS forecast_source text,
  ADD COLUMN IF NOT EXISTS forecast_model_version text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_conversation_context'::regclass AND conname = 'ai_context_planning_intent_check') THEN
    ALTER TABLE public.ai_conversation_context ADD CONSTRAINT ai_context_planning_intent_check CHECK (planning_intent IS NULL OR planning_intent IN ('future_fare_plan', 'future_fare_follow_up', 'cheapest_time'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_timezone_check') THEN
    ALTER TABLE public.ai_conversation_context ADD CONSTRAINT ai_context_timezone_check CHECK (departure_timezone IS NULL OR length(departure_timezone) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_forecast_source_check') THEN
    ALTER TABLE public.ai_conversation_context ADD CONSTRAINT ai_context_forecast_source_check CHECK (forecast_source IS NULL OR forecast_source IN ('live_quote', 'historical_observation', 'forecast', 'simulated', 'unavailable'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_conversation_context_planning
  ON public.ai_conversation_context(user_id, conversation_id, updated_at DESC);
