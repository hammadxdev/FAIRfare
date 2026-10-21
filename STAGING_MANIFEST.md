# Fair Fare Backend Staging Manifest

Prepared 2026-10-13. This is a review manifest only; no files were staged or committed.

## Include in the future backend commit after review

### Application/runtime source

- `.env.example`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `vercel.json`
- `README.md`
- `api/index.js`
- `src/app.js`
- `src/config/cors.js`
- `src/controllers/tripAwareAi.controller.js`
- `src/routes/tripAwareAi.routes.js`
- `src/services/coverageApproval.service.js`
- `src/services/coverageActivationDryRun.service.js`
- `src/services/coverageEvidenceIntake.service.js`
- `src/services/fairFareDataset.service.js`
- `src/services/fairFareDatasetValidator.service.js`
- `src/services/qualityAwareAssistant.service.js`
- `src/services/tripAwareAiAssistant.service.js`
- `src/services/tripContext.service.js`
- `src/services/tripExtraction.service.js`
- `src/services/tripResolution.service.js`
- `src/db/migrate.js`
- `src/db/schema.sql` (reference only; SQLite, not for direct PostgreSQL execution)
- `src/db/seed.js` (staging-only seed utility)
- `src/db/migrations/001_supabase_compatibility.sql`
- `src/db/migrations/002_runtime_postgres_additive.sql`
- `src/db/migrations/003_auth_session_schema.sql`
- `src/db/migrations/004_email_auth.sql`
- `src/db/migrations/005_runtime_schema_reconciliation.sql`
- `src/db/migrations/006_ai_message_idempotency.sql`
- `src/db/migrations/007_weather_observation_columns.sql`
- `src/db/migrations/008_comparison_enrichment.sql`
- Modified existing source files shown by `git status`, including `src/services/fare.service.js`, `src/services/maps/geoapifyMaps.service.js`, and `src/app.js`.

### Required runtime assets

- `COVERAGE_EVIDENCE_REGISTER.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/assistant_context_example.json`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/cities.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/event_rules.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/provider_city_coverage.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/synthetic_fare_scenarios.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/time_rules.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/vehicle_pricing_parameters.csv`
- `src/data/Fair_Fare_Synthetic_Dataset_v1/weather_rules.csv`
- `ml/node_artifacts/synthetic_600/fare_model.json` (already tracked)

`vercel.json` includes the model, coverage register, and dataset CSV/JSON assets. The dataset must be intentionally included in the future commit; it was previously hidden by the broad `data/` ignore rule.

### Tests

- Modified existing AI, fare, dataset, and setup tests shown by `git status`.
- `src/tests/aiQualityPolicy.test.js`
- `src/tests/coverageActivationDryRun.test.js`
- `src/tests/coverageApproval.test.js`
- `src/tests/coverageEvidenceIntake.test.js`
- `src/tests/realAiModelEvaluation.runner.cjs`
- `src/tests/realAiModelEvaluationV3.runner.cjs`
- `src/tests/securitySurface.test.js`
- `src/tests/tripAwareAiEndpoint.test.js`
- `src/tests/tripContext.test.js`
- `src/tests/tripExtraction.test.js`

### Documentation and review artifacts

- `DEPLOYMENT_READINESS_REPORT.md`
- `STAGING_VALIDATION_REPORT.md`
- `PRODUCTION_RELEASE_CHECKLIST.md`
- `AI_MODEL_EVALUATION_V3_REPORT.md`
- `COVERAGE_ACTIVATION_DRY_RUN.md`
- `COVERAGE_ACTIVATION_GUIDE.md`
- `COVERAGE_APPROVAL_CANDIDATES.md`
- `COVERAGE_FINAL_REVIEW.md`
- `COVERAGE_REVIEW_SUMMARY.md`
- `COVERAGE_STAGING_PERSISTENCE_DESIGN.md`
- `FAIR_FARE_DATASET_INTEGRATION.md`
- `FINAL_GEOCODING_ASSESSMENT.md`
- `GEOCODING_SCENARIO2_DIAGNOSTICS.md`
- `MANUAL_APP_VERIFICATION_CHECKLIST.md`
- `PROVIDER_CITY_COVERAGE_REPORT.md`
- `PROVIDER_VEHICLE_COVERAGE_REPORT.md`
- `fairFareDatasetValidator.js`

## Do not include in a release commit

### Generated evaluation artifacts

All `AI_MODEL_EVALUATION*_RAW.json` files, scenario raw JSON files, and other generated evaluation dumps. Keep them in a secure evaluation archive if needed; they are not runtime dependencies and may contain model-response data.

### Build outputs/local state

- `ml/artifacts/synthetic_600/` — generated training/build output; not required by the Vercel Node runtime.
- `data/` — local SQLite databases, WAL/SHM files, and exported datasets.
- `ml/.deps/` — local Python dependency cache.
- `server-runtime.log` and `server-runtime-error.log`.
- Local APKs or mobile artifacts (outside this backend scope).

### Accidental or review-only files

- `tatus --short` — accidental untracked file; do not commit.
- `scripts/smoke-production.ps1` — review separately before any inclusion; it is not required by the server runtime.
- Coverage/report Markdown not listed above should remain review-only.

### Secrets

- `.env` and any credential/token file.
- Database files containing local user/session data.
- API keys, JWT secrets, provider refresh tokens, or private screenshots.

## Release review rule

Do not use `git add -A`. Stage only an approved subset of this manifest after confirming the source diff, runtime asset sizes, and absence of secrets.
