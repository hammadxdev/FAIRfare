# Fair Fare backend release allowlist

Reviewed 2026-10-13. This file is a review record only. It is not a staging,
commit, push, deployment, or migration command.

## Release invariants

- `FAIR_FARE_DATASET_MODE=legacy`.
- `FAIRFARE_APPROVED_COVERAGE=` (empty).
- `ml/node_artifacts/synthetic_600/fare_model.json` is the portable Node model.
- `src/data/Fair_Fare_Synthetic_Dataset_v1/` and `COVERAGE_EVIDENCE_REGISTER.csv`
  are intentional runtime assets.
- `009_production_schema_gaps.sql` is excluded. The final read-only Supabase
  schema checker completed with 246 PASS and 0 MISSING.

## Required tracked runtime baseline

These files are already tracked on `main`; they are listed to define the
runtime closure of the release, but unchanged files do not need to appear in
the selective staging command:

```text
api/index.js
package.json
package-lock.json
vercel.json
src/app.js
src/config/env.js
src/config/postgres.js
src/controllers/ai.controller.js
src/controllers/auth.controller.js
src/controllers/fare.controller.js
src/controllers/provider.controller.js
src/providers/provider.registry.js
src/routes/health.routes.js
src/services/ai/aiRideAssistant.service.js
src/services/ai/llmClient.js
src/services/fare.service.js
src/services/maps/geoapifyMaps.service.js
src/db/migrations/001_supabase_compatibility.sql
src/db/migrations/002_runtime_postgres_additive.sql
src/db/migrations/003_auth_session_schema.sql
src/db/migrations/004_email_auth.sql
src/db/migrations/005_runtime_schema_reconciliation.sql
src/db/migrations/006_ai_message_idempotency.sql
src/db/migrations/007_weather_observation_columns.sql
src/db/migrations/008_comparison_enrichment.sql
```

## Approved changed and newly added release files

```text
.env.example
.gitignore
README.md
package.json
vercel.json
src/app.js
src/providers/provider.registry.js
src/routes/health.routes.js
src/services/fare.service.js
src/services/maps/geoapifyMaps.service.js
src/tests/aiRideAssistant.test.js
src/tests/fare.test.js
src/tests/fareDataset.test.js
src/tests/setup.js
src/config/cors.js
src/controllers/tripAwareAi.controller.js
src/routes/tripAwareAi.routes.js
src/services/coverageActivationDryRun.service.js
src/services/coverageApproval.service.js
src/services/coverageEvidenceIntake.service.js
src/services/fairFareDataset.service.js
src/services/fairFareDatasetValidator.service.js
src/services/providerRecommendationGuard.service.js
src/services/qualityAwareAssistant.service.js
src/services/tripAwareAiAssistant.service.js
src/services/tripContext.service.js
src/services/tripExtraction.service.js
src/services/tripResolution.service.js
fairFareDatasetValidator.js
COVERAGE_EVIDENCE_REGISTER.csv
ml/node_artifacts/synthetic_600/fare_model.json
```

## Approved dataset assets

```text
src/data/Fair_Fare_Synthetic_Dataset_v1/README.md
src/data/Fair_Fare_Synthetic_Dataset_v1/assistant_context_example.json
src/data/Fair_Fare_Synthetic_Dataset_v1/cities.csv
src/data/Fair_Fare_Synthetic_Dataset_v1/event_rules.csv
src/data/Fair_Fare_Synthetic_Dataset_v1/provider_city_coverage.csv
src/data/Fair_Fare_Synthetic_Dataset_v1/synthetic_fare_scenarios.csv
src/data/Fair_Fare_Synthetic_Dataset_v1/time_rules.csv
src/data/Fair_Fare_Synthetic_Dataset_v1/vehicle_pricing_parameters.csv
src/data/Fair_Fare_Synthetic_Dataset_v1/weather_rules.csv
```

## Approved regression tests and release records

```text
src/tests/aiFallback.test.js
src/tests/aiGroqProvider.test.js
src/tests/aiConversations.test.js
src/tests/aiQualityPolicy.test.js
src/tests/providerRecommendationGuard.test.js
src/tests/tripContext.test.js
src/tests/tripExtraction.test.js
src/tests/tripAwareAiEndpoint.test.js
src/tests/securitySurface.test.js
src/tests/coverageApproval.test.js
src/tests/coverageActivationDryRun.test.js
src/tests/coverageEvidenceIntake.test.js
src/tests/deploymentStabilization.test.js
PRODUCTION_SCHEMA_READONLY_CHECK.sql
PRODUCTION_RELEASE_CHECKLIST.md
DEPLOYMENT_READINESS_REPORT.md
RELEASE_FILE_ALLOWLIST.md
```

## Explicit exclusions

Do not stage or release:

```text
009_production_schema_gaps.sql         # explicitly excluded production migration
.env                                   # secrets
data/                                  # local databases and runtime data
*.log                                  # runtime logs
release-evidence/                      # local test logs; never stage
tatus --short                          # accidental temporary file
ml/artifacts/                          # generated Python model artifacts
ml/.deps/                              # Python dependency cache
scripts/smoke-production.ps1           # review-only operational script
src/tests/realAiModelEvaluation.runner.cjs
src/tests/realAiModelEvaluationV3.runner.cjs
AI_MODEL_EVALUATION*_RAW.json
AI_MODEL_EVALUATION*_REPORT.md
AI_PROVIDER_RECOMMENDATION_GROUNDING_REPORT.md
SCENARIO2_*_RAW.json
STAGING_*.md
COVERAGE_*_GUIDE.md
COVERAGE_*_CANDIDATES.md
COVERAGE_FINAL_REVIEW.md
COVERAGE_REVIEW_SUMMARY.md
COVERAGE_STAGING_PERSISTENCE_DESIGN.md
FAIR_FARE_DATASET_INTEGRATION.md
FINAL_GEOCODING_ASSESSMENT.md
GEOCODING_SCENARIO2_DIAGNOSTICS.md
MANUAL_APP_VERIFICATION_CHECKLIST.md
PROVIDER_CITY_COVERAGE_REPORT.md
PROVIDER_VEHICLE_COVERAGE_REPORT.md
```

No private keys, API tokens, JWTs, provider refresh tokens, database URLs,
generated APK/AAB files, or unrelated mobile/frontend files are approved.

Before any staging operation, reconcile the README/009 conflict. The complete
backend test log is retained at `release-evidence/backend-suite-unrestricted.log`
and remains ignored; it must not be staged.
