-- Fair Fare production schema inspection.
-- Read-only: every statement is a SELECT against PostgreSQL catalog views.
-- Run this in the existing Supabase project's SQL Editor.
-- Release order: run src/db/migrations/001..008, then run this checker.
-- The final result set is intentionally one row per expected object and uses
-- exact ordered key matching for primary, foreign-key, unique, and index
-- checks; do not treat a partial-column match as PASS.

SELECT current_database() AS database_name,
       current_schema() AS default_schema,
       current_user AS database_role,
       now() AS inspected_at;

WITH expected(table_name) AS (
  VALUES
    ('users'), ('user_sessions'), ('user_preferences'), ('user_identities'),
    ('password_reset_requests'), ('phone_verification_attempts'),
    ('email_verification_requests'), ('providers'), ('vehicle_rates'),
    ('fare_searches'), ('fare_results'), ('provider_sessions'),
    ('comparison_history'), ('comparison_history_quotes'),
    ('fare_observations'), ('saved_routes'), ('ai_conversations'), ('ai_messages')
)
SELECT e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.table_name
ORDER BY e.table_name;

WITH expected(table_name, column_name) AS (
  VALUES
    ('users','id'), ('users','name'), ('users','email'), ('users','password_hash'),
    ('users','email_verified_at'), ('users','phone_number'), ('users','phone_verified_at'),
    ('users','created_at'), ('users','updated_at'),
    ('user_sessions','id'), ('user_sessions','user_id'), ('user_sessions','refresh_token_hash'),
    ('user_sessions','expires_at'), ('user_sessions','revoked_at'), ('user_sessions','last_used_at'),
    ('user_preferences','user_id'), ('user_preferences','preferred_vehicle_type'),
    ('user_preferences','avoided_vehicle_types'), ('user_preferences','typical_budget'),
    ('user_preferences','ride_priority'), ('user_preferences','created_at'), ('user_preferences','updated_at'),
    ('user_identities','id'), ('user_identities','user_id'), ('user_identities','provider'),
    ('user_identities','provider_subject'), ('user_identities','created_at'),
    ('password_reset_requests','id'), ('password_reset_requests','user_id'),
    ('password_reset_requests','token_hash'), ('password_reset_requests','expires_at'),
    ('password_reset_requests','attempts'), ('password_reset_requests','otp_hash'),
    ('password_reset_requests','reset_token_hash'), ('password_reset_requests','verified_at'),
    ('password_reset_requests','used_at'), ('password_reset_requests','last_sent_at'),
    ('password_reset_requests','created_at'),
    ('phone_verification_attempts','id'), ('phone_verification_attempts','phone_number'),
    ('phone_verification_attempts','purpose'),
    ('phone_verification_attempts','expires_at'),
    ('phone_verification_attempts','verified_at'), ('phone_verification_attempts','created_at'),
    ('email_verification_requests','id'), ('email_verification_requests','user_id'),
    ('email_verification_requests','purpose'), ('email_verification_requests','otp_hash'),
    ('email_verification_requests','expires_at'), ('email_verification_requests','attempt_count'),
    ('email_verification_requests','verified_at'), ('email_verification_requests','used_at'),
    ('email_verification_requests','last_sent_at'), ('email_verification_requests','created_at'),
    ('providers','id'), ('providers','name'), ('providers','display_name'), ('providers','is_active'),
    ('providers','logo_url'), ('providers','deep_link_url'), ('providers','created_at'),
    ('vehicle_rates','id'), ('vehicle_rates','provider_id'), ('vehicle_rates','vehicle_type'),
    ('vehicle_rates','base_fare'), ('vehicle_rates','per_km_rate'), ('vehicle_rates','per_min_rate'),
    ('vehicle_rates','minimum_fare'), ('vehicle_rates','surge_multiplier'), ('vehicle_rates','created_at'),
    ('fare_searches','id'), ('fare_searches','pickup_name'), ('fare_searches','pickup_lat'),
    ('fare_searches','pickup_lng'), ('fare_searches','dropoff_name'), ('fare_searches','dropoff_lat'),
    ('fare_searches','dropoff_lng'), ('fare_searches','vehicle_type'), ('fare_searches','distance_km'),
    ('fare_searches','duration_min'), ('fare_searches','created_at'),
    ('fare_results','id'), ('fare_results','search_id'), ('fare_results','provider_id'),
    ('fare_results','estimated_fare'), ('fare_results','eta_min'), ('fare_results','is_cheapest'),
    ('fare_results','is_fastest'), ('fare_results','is_recommended'), ('fare_results','breakdown_json'),
    ('fare_results','created_at'),
    ('provider_sessions','provider'), ('provider_sessions','access_token'),
    ('provider_sessions','refresh_token'), ('provider_sessions','access_expires_at'),
    ('provider_sessions','status'), ('provider_sessions','updated_at'),
    ('comparison_history','id'), ('comparison_history','user_id'), ('comparison_history','pickup_label'),
    ('comparison_history','pickup_latitude'), ('comparison_history','pickup_longitude'),
    ('comparison_history','destination_label'), ('comparison_history','destination_latitude'),
    ('comparison_history','destination_longitude'), ('comparison_history','distance_meters'),
    ('comparison_history','duration_seconds'), ('comparison_history','enrichment_json'),
    ('comparison_history','enrichment_created_at'), ('comparison_history','enrichment_expires_at'),
    ('comparison_history','created_at'),
    ('comparison_history_quotes','id'), ('comparison_history_quotes','comparison_id'),
    ('comparison_history_quotes','provider'), ('comparison_history_quotes','category'),
    ('comparison_history_quotes','fare'), ('comparison_history_quotes','fare_min'),
    ('comparison_history_quotes','fare_max'), ('comparison_history_quotes','currency'),
    ('comparison_history_quotes','fare_type'), ('comparison_history_quotes','pickup_eta_seconds'),
    ('comparison_history_quotes','availability'), ('comparison_history_quotes','created_at'),
    ('fare_observations','id'), ('fare_observations','data_source'), ('fare_observations','comparison_id'),
    ('fare_observations','provider_id'), ('fare_observations','provider'),
    ('fare_observations','provider_category'), ('fare_observations','provider_category_id'),
    ('fare_observations','provider_category_name'), ('fare_observations','normalized_category'),
    ('fare_observations','vehicle_type'), ('fare_observations','pickup_latitude'),
    ('fare_observations','pickup_longitude'), ('fare_observations','pickup_zone'),
    ('fare_observations','destination_latitude'), ('fare_observations','destination_longitude'),
    ('fare_observations','destination_zone'), ('fare_observations','distance_meters'),
    ('fare_observations','duration_seconds'), ('fare_observations','fare'),
    ('fare_observations','fare_min'), ('fare_observations','fare_max'), ('fare_observations','currency'),
    ('fare_observations','fare_type'), ('fare_observations','pickup_eta_seconds'),
    ('fare_observations','observed_at'), ('fare_observations','hour_of_day'),
    ('fare_observations','day_of_week'), ('fare_observations','weather_condition'),
    ('fare_observations','weather_severity'), ('fare_observations','precipitation_mm'),
    ('fare_observations','temperature_c'), ('fare_observations','raw_response_sanitized'),
    ('saved_routes','id'), ('saved_routes','user_id'), ('saved_routes','name'), ('saved_routes','label_type'),
    ('saved_routes','pickup_name'), ('saved_routes','pickup_address'), ('saved_routes','pickup_latitude'),
    ('saved_routes','pickup_longitude'), ('saved_routes','destination_name'),
    ('saved_routes','destination_address'), ('saved_routes','destination_latitude'),
    ('saved_routes','destination_longitude'), ('saved_routes','created_at'), ('saved_routes','updated_at'),
    ('ai_conversations','id'), ('ai_conversations','user_id'), ('ai_conversations','title'),
    ('ai_conversations','is_pinned'), ('ai_conversations','created_at'), ('ai_conversations','updated_at'),
    ('ai_messages','id'), ('ai_messages','conversation_id'), ('ai_messages','role'),
    ('ai_messages','content'), ('ai_messages','model_id'), ('ai_messages','client_message_id'),
    ('ai_messages','created_at')
)
SELECT e.table_name, e.column_name,
       CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status,
       c.data_type, c.is_nullable, c.column_default
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = e.table_name
 AND c.column_name = e.column_name
ORDER BY e.table_name, e.column_name;

WITH expected(index_name) AS (
  VALUES
    ('idx_user_sessions_active'), ('idx_saved_routes_user_created'),
    ('idx_saved_routes_user_created_at'), ('idx_history_user_created'),
    ('idx_ai_conversations_user_updated'), ('idx_ai_messages_conversation_created'),
    ('idx_ai_messages_conversation_client'), ('idx_fare_searches_created'),
    ('idx_fare_results_search'), ('idx_vehicle_rates_provider_type'),
    ('idx_email_verification_requests_user_active'), ('idx_password_reset_requests_user_active'),
    ('idx_history_quotes_comparison'), ('idx_fare_observations_observed_at'),
    ('idx_comparison_history_enrichment_expiry')
)
SELECT e.index_name,
       CASE WHEN i.indexname IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status,
       i.tablename, i.indexdef
FROM expected e
LEFT JOIN pg_catalog.pg_indexes i
  ON i.schemaname = 'public' AND i.indexname = e.index_name
ORDER BY e.index_name;

SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_name = tc.table_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_schema = tc.constraint_schema
 AND ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_schema = 'public'
  AND tc.table_name IN (
    'users','user_sessions','user_preferences','user_identities','password_reset_requests',
    'phone_verification_attempts','email_verification_requests','providers','vehicle_rates',
    'fare_searches','fare_results','provider_sessions','comparison_history',
    'comparison_history_quotes','fare_observations','saved_routes','ai_conversations','ai_messages'
  )
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON cc.constraint_schema = tc.constraint_schema
 AND cc.constraint_name = tc.constraint_name
WHERE tc.constraint_schema = 'public'
  AND tc.constraint_type = 'CHECK'
  AND tc.table_name IN ('ai_messages','user_preferences','email_verification_requests');

-- Diagnostic for the expected ai_messages.role invariant. This is read-only
-- and intentionally matches PostgreSQL's normalized ANY/ARRAY form after
-- removing only representation-level casts and formatting.
SELECT c.conname AS constraint_name,
       pg_get_constraintdef(c.oid) AS definition,
       c.convalidated AS is_validated
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class rel ON rel.oid = c.conrelid
JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname = 'ai_messages'
  AND c.contype = 'c'
  AND c.convalidated
  AND (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
       FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum) = 'role'
  AND regexp_replace(
        replace(replace(replace(lower(pg_get_constraintdef(c.oid)), '::character varying', ''), '::text[]', ''), '::text', ''),
        '[[:space:]()]', '', 'g'
      ) = 'checkrole=anyarray[''user'',''assistant'']';

SELECT schemaname, tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'users','user_sessions','user_preferences','user_identities','password_reset_requests',
    'phone_verification_attempts','email_verification_requests','providers','vehicle_rates',
    'fare_searches','fare_results','provider_sessions','comparison_history',
    'comparison_history_quotes','fare_observations','saved_routes','ai_conversations','ai_messages'
  )
ORDER BY tablename, indexname;

-- Read-only preflight for the password-reset uniqueness invariant.  These
-- queries intentionally run before any proposed UNIQUE constraint/index
-- migration and expose NULLs and duplicate token hashes without changing data.
SELECT count(*) AS total_rows,
       count(token_hash) AS nonnull_token_hash_rows,
       count(*) FILTER (WHERE token_hash IS NULL) AS null_token_hash_rows,
       count(DISTINCT token_hash) AS distinct_token_hash_rows
FROM public.password_reset_requests;

SELECT token_hash, count(*) AS duplicate_rows,
       min(id::text) AS first_request_id, max(id::text) AS last_request_id
FROM public.password_reset_requests
WHERE token_hash IS NOT NULL
GROUP BY token_hash
HAVING count(*) > 1
ORDER BY duplicate_rows DESC, token_hash;

-- The current runtime only inserts phone_number/purpose/expires_at here.
-- This row count is evidence for review; it does not infer that optional
-- code_hash/attempts columns are required.
SELECT count(*) AS phone_verification_attempt_rows
FROM public.phone_verification_attempts;

-- Read-only preflight for the ai_messages.role CHECK migration.  Any rows
-- returned must be reviewed before applying the constraint; this query never
-- deletes, rewrites, or truncates messages.
SELECT id, conversation_id, role
FROM public.ai_messages
WHERE role IS NULL
   OR role NOT IN ('USER', 'ASSISTANT')
ORDER BY created_at, id;

-- Consolidated PASS/MISSING report.
-- This final SELECT is the release-gate result set: one row per expected
-- table, column, index, or constraint. It is read-only and does not infer
-- migration history.
WITH
expected_tables(table_name) AS (
  VALUES
    ('users'), ('user_sessions'), ('user_preferences'), ('user_identities'),
    ('password_reset_requests'), ('phone_verification_attempts'),
    ('email_verification_requests'), ('providers'), ('vehicle_rates'),
    ('fare_searches'), ('fare_results'), ('provider_sessions'),
    ('comparison_history'), ('comparison_history_quotes'), ('fare_observations'),
    ('saved_routes'), ('ai_conversations'), ('ai_messages')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('users','id'),('users','name'),('users','email'),('users','password_hash'),('users','email_verified_at'),('users','phone_number'),('users','phone_verified_at'),('users','created_at'),('users','updated_at'),
    ('user_sessions','id'),('user_sessions','user_id'),('user_sessions','refresh_token_hash'),('user_sessions','expires_at'),('user_sessions','revoked_at'),('user_sessions','last_used_at'),
    ('user_preferences','user_id'),('user_preferences','preferred_vehicle_type'),('user_preferences','avoided_vehicle_types'),('user_preferences','typical_budget'),('user_preferences','ride_priority'),('user_preferences','created_at'),('user_preferences','updated_at'),
    ('user_identities','id'),('user_identities','user_id'),('user_identities','provider'),('user_identities','provider_subject'),('user_identities','created_at'),
    ('password_reset_requests','id'),('password_reset_requests','user_id'),('password_reset_requests','token_hash'),('password_reset_requests','expires_at'),('password_reset_requests','attempts'),('password_reset_requests','otp_hash'),('password_reset_requests','reset_token_hash'),('password_reset_requests','verified_at'),('password_reset_requests','used_at'),('password_reset_requests','last_sent_at'),('password_reset_requests','created_at'),
    ('phone_verification_attempts','id'),('phone_verification_attempts','phone_number'),('phone_verification_attempts','purpose'),('phone_verification_attempts','expires_at'),('phone_verification_attempts','verified_at'),('phone_verification_attempts','created_at'),
    ('email_verification_requests','id'),('email_verification_requests','user_id'),('email_verification_requests','purpose'),('email_verification_requests','otp_hash'),('email_verification_requests','expires_at'),('email_verification_requests','attempt_count'),('email_verification_requests','verified_at'),('email_verification_requests','used_at'),('email_verification_requests','last_sent_at'),('email_verification_requests','created_at'),
    ('providers','id'),('providers','name'),('providers','display_name'),('providers','is_active'),('providers','logo_url'),('providers','deep_link_url'),('providers','created_at'),
    ('vehicle_rates','id'),('vehicle_rates','provider_id'),('vehicle_rates','vehicle_type'),('vehicle_rates','base_fare'),('vehicle_rates','per_km_rate'),('vehicle_rates','per_min_rate'),('vehicle_rates','minimum_fare'),('vehicle_rates','surge_multiplier'),('vehicle_rates','created_at'),
    ('fare_searches','id'),('fare_searches','pickup_name'),('fare_searches','pickup_lat'),('fare_searches','pickup_lng'),('fare_searches','dropoff_name'),('fare_searches','dropoff_lat'),('fare_searches','dropoff_lng'),('fare_searches','vehicle_type'),('fare_searches','distance_km'),('fare_searches','duration_min'),('fare_searches','created_at'),
    ('fare_results','id'),('fare_results','search_id'),('fare_results','provider_id'),('fare_results','estimated_fare'),('fare_results','eta_min'),('fare_results','is_cheapest'),('fare_results','is_fastest'),('fare_results','is_recommended'),('fare_results','breakdown_json'),('fare_results','created_at'),
    ('provider_sessions','provider'),('provider_sessions','access_token'),('provider_sessions','refresh_token'),('provider_sessions','access_expires_at'),('provider_sessions','status'),('provider_sessions','updated_at'),
    ('comparison_history','id'),('comparison_history','user_id'),('comparison_history','pickup_label'),('comparison_history','pickup_latitude'),('comparison_history','pickup_longitude'),('comparison_history','destination_label'),('comparison_history','destination_latitude'),('comparison_history','destination_longitude'),('comparison_history','distance_meters'),('comparison_history','duration_seconds'),('comparison_history','enrichment_json'),('comparison_history','enrichment_created_at'),('comparison_history','enrichment_expires_at'),('comparison_history','created_at'),
    ('comparison_history_quotes','id'),('comparison_history_quotes','comparison_id'),('comparison_history_quotes','provider'),('comparison_history_quotes','category'),('comparison_history_quotes','fare'),('comparison_history_quotes','fare_min'),('comparison_history_quotes','fare_max'),('comparison_history_quotes','currency'),('comparison_history_quotes','fare_type'),('comparison_history_quotes','pickup_eta_seconds'),('comparison_history_quotes','availability'),('comparison_history_quotes','created_at'),
    ('fare_observations','id'),('fare_observations','data_source'),('fare_observations','comparison_id'),('fare_observations','provider_id'),('fare_observations','provider'),('fare_observations','provider_category'),('fare_observations','provider_category_id'),('fare_observations','provider_category_name'),('fare_observations','normalized_category'),('fare_observations','vehicle_type'),('fare_observations','pickup_latitude'),('fare_observations','pickup_longitude'),('fare_observations','pickup_zone'),('fare_observations','destination_latitude'),('fare_observations','destination_longitude'),('fare_observations','destination_zone'),('fare_observations','distance_meters'),('fare_observations','duration_seconds'),('fare_observations','fare'),('fare_observations','fare_min'),('fare_observations','fare_max'),('fare_observations','currency'),('fare_observations','fare_type'),('fare_observations','pickup_eta_seconds'),('fare_observations','observed_at'),('fare_observations','hour_of_day'),('fare_observations','day_of_week'),('fare_observations','weather_condition'),('fare_observations','weather_severity'),('fare_observations','precipitation_mm'),('fare_observations','temperature_c'),('fare_observations','raw_response_sanitized'),
    ('saved_routes','id'),('saved_routes','user_id'),('saved_routes','name'),('saved_routes','label_type'),('saved_routes','pickup_name'),('saved_routes','pickup_address'),('saved_routes','pickup_latitude'),('saved_routes','pickup_longitude'),('saved_routes','destination_name'),('saved_routes','destination_address'),('saved_routes','destination_latitude'),('saved_routes','destination_longitude'),('saved_routes','created_at'),('saved_routes','updated_at'),
    ('ai_conversations','id'),('ai_conversations','user_id'),('ai_conversations','title'),('ai_conversations','is_pinned'),('ai_conversations','created_at'),('ai_conversations','updated_at'),
    ('ai_messages','id'),('ai_messages','conversation_id'),('ai_messages','role'),('ai_messages','content'),('ai_messages','model_id'),('ai_messages','client_message_id'),('ai_messages','created_at')
),
expected_indexes(index_name) AS (
  VALUES
    ('idx_user_sessions_active'),('idx_saved_routes_user_created'),('idx_saved_routes_user_created_at'),
    ('idx_history_user_created'),('idx_ai_conversations_user_updated'),('idx_ai_messages_conversation_created'),
    ('idx_ai_messages_conversation_client'),('idx_fare_searches_created'),('idx_fare_results_search'),
    ('idx_vehicle_rates_provider_type'),('idx_email_verification_requests_user_active'),
    ('idx_password_reset_requests_user_active'),('idx_history_quotes_comparison'),
    ('idx_fare_observations_observed_at'),('idx_comparison_history_enrichment_expiry')
),
expected_constraints(kind, table_name, column_name, referenced_table, referenced_column, detail) AS (
  VALUES
    ('PRIMARY KEY','users','id',NULL,NULL,NULL),('PRIMARY KEY','user_sessions','id',NULL,NULL,NULL),('PRIMARY KEY','user_preferences','user_id',NULL,NULL,NULL),('PRIMARY KEY','user_identities','id',NULL,NULL,NULL),('PRIMARY KEY','password_reset_requests','id',NULL,NULL,NULL),('PRIMARY KEY','phone_verification_attempts','id',NULL,NULL,NULL),('PRIMARY KEY','email_verification_requests','id',NULL,NULL,NULL),('PRIMARY KEY','providers','id',NULL,NULL,NULL),('PRIMARY KEY','vehicle_rates','id',NULL,NULL,NULL),('PRIMARY KEY','fare_searches','id',NULL,NULL,NULL),('PRIMARY KEY','fare_results','id',NULL,NULL,NULL),('PRIMARY KEY','provider_sessions','provider',NULL,NULL,NULL),('PRIMARY KEY','comparison_history','id',NULL,NULL,NULL),('PRIMARY KEY','comparison_history_quotes','id',NULL,NULL,NULL),('PRIMARY KEY','fare_observations','id',NULL,NULL,NULL),('PRIMARY KEY','saved_routes','id',NULL,NULL,NULL),('PRIMARY KEY','ai_conversations','id',NULL,NULL,NULL),('PRIMARY KEY','ai_messages','id',NULL,NULL,NULL),
    ('FOREIGN KEY','user_identities','user_id','users','id',NULL),('FOREIGN KEY','password_reset_requests','user_id','users','id',NULL),('FOREIGN KEY','email_verification_requests','user_id','users','id',NULL),('FOREIGN KEY','vehicle_rates','provider_id','providers','id',NULL),('FOREIGN KEY','fare_results','search_id','fare_searches','id',NULL),('FOREIGN KEY','fare_results','provider_id','providers','id',NULL),('FOREIGN KEY','ai_conversations','user_id','users','id',NULL),('FOREIGN KEY','ai_messages','conversation_id','ai_conversations','id',NULL),
    ('UNIQUE','providers','name',NULL,NULL,NULL),('UNIQUE','vehicle_rates','provider_id,vehicle_type',NULL,NULL,NULL),('UNIQUE','user_identities','provider,provider_subject',NULL,NULL,NULL),('UNIQUE','password_reset_requests','token_hash',NULL,NULL,NULL),
    ('CHECK','ai_messages','role',NULL,NULL,'USER|ASSISTANT')
),
table_report AS (
  SELECT 'TABLE' AS object_type, e.table_name AS object_name, 'public.' || e.table_name AS expected_definition,
         CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'PASS' END AS status,
         CASE WHEN t.table_name IS NULL THEN NULL ELSE 'public.' || t.table_name END AS actual_definition
  FROM expected_tables e LEFT JOIN information_schema.tables t ON t.table_schema='public' AND t.table_name=e.table_name
),
column_report AS (
  SELECT 'COLUMN', e.table_name || '.' || e.column_name, e.table_name || '.' || e.column_name,
         CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'PASS' END,
         CASE WHEN c.column_name IS NULL THEN NULL ELSE c.data_type || ' nullable=' || c.is_nullable END
  FROM expected_columns e LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
),
index_report AS (
  SELECT 'INDEX', e.index_name, e.index_name,
         CASE WHEN i.indexname IS NULL THEN 'MISSING' ELSE 'PASS' END,
         i.indexdef
  FROM expected_indexes e LEFT JOIN pg_catalog.pg_indexes i ON i.schemaname='public' AND i.indexname=e.index_name
),
constraint_report AS (
  SELECT 'CONSTRAINT',
         e.kind || ' ' || e.table_name || '.' || e.column_name,
         e.kind || ' ' || e.table_name || '.' || e.column_name ||
           COALESCE(' REFERENCES ' || e.referenced_table || '.' || e.referenced_column, ''),
         CASE WHEN m.object_name IS NULL THEN 'MISSING' ELSE 'PASS' END,
         m.actual_definition
  FROM expected_constraints e
  LEFT JOIN LATERAL (
    -- Match the complete local key, and for FKs the complete referenced key.
    -- A unique constraint and a full unique index are both valid enforcement.
    SELECT c.conname AS object_name, pg_get_constraintdef(c.oid) AS actual_definition
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = e.table_name
      AND (
        (e.kind = 'PRIMARY KEY' AND c.contype = 'p' AND
         (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum) = e.column_name)
        OR
        (e.kind = 'FOREIGN KEY' AND c.contype = 'f' AND
         (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum) = e.column_name AND
         (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(c.confkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = u.attnum) = e.referenced_column AND
         c.confrelid = (SELECT r.oid FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
                        WHERE n.nspname = 'public' AND r.relname = e.referenced_table))
        OR
        (e.kind = 'UNIQUE' AND c.contype = 'u' AND
         (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum) = e.column_name)
        OR
        (e.kind = 'CHECK' AND c.contype = 'c' AND e.table_name = 'ai_messages' AND
         e.column_name = 'role' AND
         (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum) = 'role' AND
         c.convalidated AND
         regexp_replace(
           replace(replace(replace(lower(pg_get_constraintdef(c.oid)), '::character varying', ''), '::text[]', ''), '::text', ''),
           '[[:space:]()]', '', 'g'
         ) = 'checkrole=anyarray[''user'',''assistant'']')
      )
    UNION ALL
    SELECT i.indexname,
           i.indexdef
    FROM pg_catalog.pg_indexes i
    JOIN pg_class rel ON rel.relname = i.tablename
    JOIN pg_namespace ns ON ns.nspname = i.schemaname AND ns.oid = rel.relnamespace
    JOIN pg_index ix ON ix.indexrelid = format('%I.%I', i.schemaname, i.indexname)::regclass
    WHERE i.schemaname = 'public'
      AND i.tablename = e.table_name
      AND e.kind = 'UNIQUE'
      AND ix.indisunique
      AND ix.indpred IS NULL
      AND ix.indnkeyatts = array_length(string_to_array(e.column_name, ','), 1)
      AND (SELECT string_agg(a.attname, ',' ORDER BY s.ord)
           FROM generate_subscripts(ix.indkey, 1) s(ord)
           JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ix.indkey[s.ord]) = e.column_name
    LIMIT 1
  ) m ON true
)
SELECT object_type, object_name, status, expected_definition, actual_definition
FROM (SELECT * FROM table_report UNION ALL SELECT * FROM column_report UNION ALL SELECT * FROM index_report UNION ALL SELECT * FROM constraint_report) report
ORDER BY CASE object_type WHEN 'TABLE' THEN 1 WHEN 'COLUMN' THEN 2 WHEN 'INDEX' THEN 3 WHEN 'CONSTRAINT' THEN 4 END, object_name;
