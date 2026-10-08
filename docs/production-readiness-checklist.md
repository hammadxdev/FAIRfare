# Production readiness checklist

This is a read-only audit aid. Local `.env` presence is not evidence that a
Vercel variable is configured. Values are never printed by the application or
by the checks below.

## Vercel environment variables

The repository cannot verify Vercel project settings without an authenticated
Vercel inspection. Treat every item below as `UNVERIFIED` until checked in the
Vercel dashboard or CLI for the target project and environment.

| Variable | Status | Requirement |
| --- | --- | --- |
| `DATABASE_URL` | UNVERIFIED | Production PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | UNVERIFIED | Long random signing secret |
| `GEOAPIFY_API_KEY` | UNVERIFIED | Server-side map/geocoding key |
| `GROQ_API_KEY` | UNVERIFIED | Primary AI provider key |
| `AI_ASSISTANT_ENABLED` | UNVERIFIED | Must be `true` to enable the assistant |
| `OPENROUTER_API_KEY` or `AI_API_KEY` | UNVERIFIED | Secondary provider key; canonical name is `OPENROUTER_API_KEY` |
| `FAIRFARE_SIMULATION_ONLY` | UNVERIFIED | Must remain `true` for the current safe deployment mode |
| `INDRIVE_MODE` | UNVERIFIED | Expected `simulated` unless a real authorized integration is approved |
| `YANGO_MODE` | UNVERIFIED | Expected `simulated` |
| `BYKEA_MODE` | UNVERIFIED | Expected `simulated` |
| `FAIRFARE_WEATHER_ENABLED` | UNVERIFIED | Expected `true` when weather enrichment is intended |

### Manual Production verification

- [ ] Open the correct Vercel project and select the `Production` environment.
- [ ] Confirm every required variable name in the table exists; for the OpenRouter requirement, confirm at least one of `OPENROUTER_API_KEY` or legacy `AI_API_KEY` exists.
- [ ] Confirm non-secret values exactly: `AI_ASSISTANT_ENABLED=true`, `FAIRFARE_SIMULATION_ONLY=true`, `INDRIVE_MODE=simulated`, `YANGO_MODE=simulated`, `BYKEA_MODE=simulated`, and `FAIRFARE_WEATHER_ENABLED=true`.
- [ ] Confirm secret values are present without copying them into tickets, logs, screenshots, shell history, or chat.
- [ ] Confirm the variables are scoped to Production, then redeploy only through the normal release process after the checklist is approved.
- [ ] Treat `vercel env ls` as name/scope evidence only; do not use local `.env` or an unscoped environment listing as proof of Production values.

## AI provider behavior

- Groq is primary when `GROQ_API_KEY` is configured.
- `openai/gpt-oss-120b` is the primary Groq model.
- `openai/gpt-oss-20b` is the Groq fallback.
- OpenRouter is a secondary fallback provider only when fallback is enabled and
  a key resolves from `OPENROUTER_API_KEY || AI_API_KEY`.
- A successful Groq request ends the chain; OpenRouter is not called.
- Diagnostics expose only presence/length metadata and never credential values.

## Migration 001–007 audit

Run migrations in numeric order only after reviewing the target schema. Do not
rerun them blindly against production. Migrations 001–007 are additive except
for the explicitly documented backfills and constraint relaxation in 005.

Expected objects include the existing `users`, `user_preferences`,
`user_sessions`, and `saved_routes` tables plus:

- 001: `user_identities`, `password_reset_requests`,
  `phone_verification_attempts`, and supporting indexes/columns.
- 002/005: `providers`, `vehicle_rates`, `fare_searches`, `fare_results`,
  `provider_sessions`, `ai_conversations`, `ai_messages`,
  `comparison_history`, `comparison_history_quotes`, `fare_observations`,
  `saved_routes` compatibility columns, and supporting indexes/reference rows.
- 003/004: `user_sessions.last_used_at`, user email verification fields,
  `email_verification_requests`, and email/password-reset indexes.
- 006: `ai_messages.client_message_id` and the partial unique index
  `idx_ai_messages_conversation_client` on
  `(conversation_id, client_message_id)` where `client_message_id IS NOT NULL`.
  The `IF NOT EXISTS` clauses make the column/index creation repeat-safe; the
  unique index still rejects duplicate non-null client IDs by design.
- 007: `fare_observations.weather_condition`, `weather_severity`,
  `precipitation_mm`, and `temperature_c`. All four additions are
  `ADD COLUMN IF NOT EXISTS` and therefore repeat-safe.

## Read-only Supabase SQL verification

The following query performs metadata-only checks. It does not insert, update,
alter, delete, acquire application row locks, or expose row data.

```sql
WITH expected_tables(table_name) AS (
  VALUES
    ('users'), ('user_preferences'), ('user_sessions'), ('saved_routes'),
    ('user_identities'), ('password_reset_requests'),
    ('phone_verification_attempts'), ('providers'), ('vehicle_rates'),
    ('fare_searches'), ('fare_results'), ('provider_sessions'),
    ('ai_conversations'), ('ai_messages'), ('comparison_history'),
    ('comparison_history_quotes'), ('fare_observations'),
    ('email_verification_requests')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('ai_messages', 'client_message_id'),
    ('fare_observations', 'weather_condition'),
    ('fare_observations', 'weather_severity'),
    ('fare_observations', 'precipitation_mm'),
    ('fare_observations', 'temperature_c'),
    ('user_sessions', 'last_used_at'),
    ('users', 'email_verified_at'),
    ('saved_routes', 'pickup_latitude'),
    ('saved_routes', 'pickup_longitude'),
    ('saved_routes', 'destination_latitude'),
    ('saved_routes', 'destination_longitude'),
    ('saved_routes', 'label_type')
),
expected_indexes(index_name) AS (
  VALUES
    ('idx_ai_messages_conversation_client'),
    ('idx_ai_messages_conversation_created'),
    ('idx_user_sessions_active'),
    ('idx_fare_observations_observed_at')
)
SELECT 'table' AS object_type, e.table_name AS object_name,
       CASE WHEN to_regclass('public.' || e.table_name) IS NOT NULL
            THEN 'PRESENT' ELSE 'MISSING' END AS status
FROM expected_tables e
UNION ALL
SELECT 'column', c.table_name || '.' || c.column_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns x
         WHERE x.table_schema = 'public'
           AND x.table_name = c.table_name
           AND x.column_name = c.column_name
       ) THEN 'PRESENT' ELSE 'MISSING' END
FROM expected_columns c
UNION ALL
SELECT 'index', i.index_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_indexes x
         WHERE x.schemaname = 'public' AND x.indexname = i.index_name
       ) THEN 'PRESENT' ELSE 'MISSING' END
FROM expected_indexes i
ORDER BY object_type, object_name;

-- Focused constraint definitions for migrations 006 and 007.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_ai_messages_conversation_client',
                    'idx_fare_observations_observed_at');

SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'idx_ai_messages_conversation_client'
    AND indexdef ILIKE '%CREATE UNIQUE INDEX%'
    AND indexdef ILIKE '%(conversation_id, client_message_id)%'
    AND indexdef ILIKE '%client_message_id IS NOT NULL%'
) THEN 'PRESENT' ELSE 'MISSING' END AS migration_006_idempotency_index;

SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'fare_observations'
  AND column_name IN ('weather_condition', 'weather_severity',
                      'precipitation_mm', 'temperature_c')
ORDER BY column_name;
```
