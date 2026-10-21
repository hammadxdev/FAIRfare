# Fair Fare Isolated Vercel Staging Execution Plan

Date: 2026-10-13

## Recommendation

**NOT READY to deploy.** This audit was read-only. Vercel CLI is not installed, no `.vercel/project.json` linkage exists, no separate staging Vercel project or non-production database was verifiably configured, and staging-only secrets were not available for confirmation.

No resource was created, no migration was executed, and no deployment was attempted.

## Phase 1 audit results

| Check | Result |
|---|---|
| Vercel CLI | Not installed; `vercel` was not found on PATH |
| Local Vercel linkage | None; `.vercel/project.json` is absent |
| Git remote | `https://github.com/hammadxdev/FAIRfare.git` |
| Production isolation | Not verifiable locally; must use a separate Vercel project or explicitly isolated preview configuration |
| Staging database | No separate Supabase/PostgreSQL URL was verifiably available |
| Staging secrets | Not verifiable; local `.env` is not staging configuration |
| Dataset mode | Defaults to `legacy` |
| Coverage approvals | Empty/zero; must remain empty in staging |
| Required files | Several source, dataset, register, test, and documentation files remain untracked; see `STAGING_MANIFEST.md` |

The existing `src/db/migrate.js` is informational and does not execute migrations. Its printed migration list should be reviewed before staging because migrations `003` and `004` are prerequisites for `005`. The file could not be changed during this audit because it was locked; no migration was run.

## Required isolation model

Create or obtain all of the following before deployment:

1. A separate Vercel project, for example `fairfare-backend-staging`, not merely a production deployment alias.
2. A separate Supabase/PostgreSQL project/database with separate credentials and connection pool.
3. A staging-only JWT access secret and refresh/session state.
4. Staging-only Groq and Geoapify credentials or explicitly authorized shared provider credentials with isolated usage monitoring.
5. A staging browser-origin allowlist, for example the actual approved preview frontend origin, entered only in staging `FAIRFARE_ALLOWED_ORIGINS`.
6. `FAIR_FARE_DATASET_MODE=legacy` and an empty `FAIRFARE_APPROVED_COVERAGE`.

Never point staging `DATABASE_URL` at the production Supabase project. Confirm the hostname/project identifier in the Vercel preview environment before running any write test.

## Release manifest

Use [STAGING_MANIFEST.md](STAGING_MANIFEST.md) as the allowlist. Do not use `git add -A`.

Include reviewed source, tests, documentation, `COVERAGE_EVIDENCE_REGISTER.csv`, `src/data/Fair_Fare_Synthetic_Dataset_v1` CSV/JSON assets, and the tracked Node fare model. Exclude `.env`, credentials, raw evaluation JSON, local databases, logs, Python caches, generated `ml/artifacts`, and `tatus --short`.

The `data/` ignore rule was narrowed so `src/data/**` is visible for intentional review. The dataset is approximately 6.5 MB including the synthetic scenario CSV; verify the final Vercel bundle size before release.

## Staging environment checklist

Set these names in the staging Vercel Preview environment without printing values:

### Required

- `NODE_ENV=production`
- `DATABASE_URL` — staging-only PostgreSQL/Supabase URL
- `JWT_ACCESS_SECRET` — staging-only random secret
- `GROQ_API_KEY`
- `GROQ_MODEL=openai/gpt-oss-120b`
- `GROQ_FALLBACK_MODEL=openai/gpt-oss-20b`
- `AI_ASSISTANT_ENABLED=true`
- `AI_PRIMARY_PROVIDER=groq`
- `AI_MODEL_FALLBACK_ENABLED=true`
- `GEOAPIFY_API_KEY`
- `FAIR_FARE_DATASET_MODE=legacy`
- `FAIRFARE_APPROVED_COVERAGE=` (empty)
- `FAIRFARE_ALLOWED_ORIGINS` — only approved staging browser origins

### Recommended runtime controls

- `PG_POOL_MAX=2`
- `PG_CONNECT_RETRIES=1`
- `PG_SSL_DISABLE=false`
- `AI_REQUEST_TIMEOUT_MS=4000`
- `AI_TOTAL_REQUEST_TIMEOUT_MS=12000`
- `AI_MAX_MODEL_ATTEMPTS=2` or another reviewed bounded value
- `AI_MODEL_COOLDOWN_MS=30000`
- `AI_MODEL_UNAVAILABLE_COOLDOWN_MS=300000`
- `GROQ_REASONING_EFFORT=low`
- `GROQ_MAX_COMPLETION_TOKENS=450`
- `FAIRFARE_PREDICTION_TIMEOUT_MS=3000`
- `FAIRFARE_WEATHER_ENABLED=true`
- `FAIRFARE_WEATHER_TIMEOUT_MS=2500`
- `FAIRFARE_COMPARISON_CONTEXT_TTL_MS=1800000`
- `FAIRFARE_MARKET_TIMEZONE=Asia/Karachi`
- `MAPS_PROVIDER=geoapify`

### Optional features

Configure only if intentionally tested: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_LOGO_URL`, email OTP TTL variables, `GOOGLE_OAUTH_CLIENT_ID`, and Twilio verification variables. Keep `MOCK_VERIFICATION_PROVIDER=false` in staging if testing the real provider; otherwise document the mock explicitly.

Do not configure `HEALTH_DIAGNOSTICS_TOKEN` unless internal diagnostics are required. Never expose it to a browser or mobile app.

## Staging database initialization

Do not execute these steps until the separate database has been created and its identity has been confirmed.

1. Create a new empty Supabase/PostgreSQL project. Do not clone production credentials into it.
2. Obtain the authoritative baseline PostgreSQL schema used by the current Supabase deployment. `src/db/schema.sql` is SQLite-oriented and must not be run directly against PostgreSQL.
3. Apply the baseline schema to the empty staging database using the Supabase SQL Editor or reviewed `psql` session.
4. Apply migrations `001_supabase_compatibility.sql` through `008_comparison_enrichment.sql` in numeric order. `003` and `004` must not be skipped because `005` declares them as prerequisites.
5. Review row counts and table names without copying production user, session, conversation, or fare data.
6. Seed only non-sensitive simulated provider/rate reference data if required. Run `src/db/seed.js` only with the staging `DATABASE_URL`, after review; never run it against production.
7. Create one staging test account through the API and verify registration, email verification behavior, login, refresh rotation, logout, and authenticated conversation persistence.
8. Confirm `SELECT current_database(), current_user` identifies staging before any write test. Do not include connection values in reports.

The repository migration command is intentionally non-mutating and currently only prints guidance. Do not run `npm run migrate` expecting it to apply SQL.

## Exact command plan

These commands are prepared for the authorized operator; they were not executed here.

### Local validation

```powershell
cd D:\ride\backend
npm ci
node --check api/index.js
node --check src/app.js
node --test --test-isolation=none src/tests/securitySurface.test.js
node --test --test-isolation=none src/tests/auth.test.js
node --test --test-isolation=none src/tests/tripContext.test.js
node --test --test-isolation=none src/tests/tripExtraction.test.js
node --test --test-isolation=none src/tests/tripAwareAiEndpoint.test.js
node --test --test-isolation=none src/tests/aiFallback.test.js
node --test --test-isolation=none src/tests/geoapifyMaps.test.js
node --test --test-isolation=none src/tests/fare.test.js
node --test --test-isolation=none src/tests/fareDataset.test.js
node --test --test-isolation=none src/tests/coverageApproval.test.js
node --test --test-isolation=none src/tests/coverageActivationDryRun.test.js
node fairFareDatasetValidator.js
```

### Vercel setup, after user authorization

```powershell
npm install --global vercel
vercel login
vercel link --project <SEPARATE_STAGING_PROJECT_NAME>
vercel project ls
vercel env add DATABASE_URL preview
vercel env add JWT_ACCESS_SECRET preview
vercel env add GROQ_API_KEY preview
vercel env add GEOAPIFY_API_KEY preview
vercel env add FAIR_FARE_DATASET_MODE preview
vercel env add FAIRFARE_APPROVED_COVERAGE preview
vercel env add FAIRFARE_ALLOWED_ORIGINS preview
```

Enter secret values interactively. Do not place them in source, command history, reports, or `.env` files committed to Git. Add the remaining reviewed variables from this plan through the Vercel dashboard or interactive CLI.

### Preview deployment, not production

```powershell
vercel --yes
vercel inspect <PREVIEW_URL>
vercel logs <PREVIEW_URL>
```

Do not use `vercel --prod`. Confirm the project name and environment before accepting the deployment.

### Staging smoke tests

```powershell
$stagingApi = "https://<staging-preview-domain>/api"
Invoke-RestMethod "$stagingApi/health"
Invoke-RestMethod "$stagingApi/health/config" -Headers @{ "x-health-diagnostics-token" = "<only-if-authorized>" }
```

Use a staging-only account/session for authenticated register/login, maps, fare comparison, AI chat, follow-up conversation, refresh, and logout tests. Do not paste tokens into shell history or reports. Verify that the response envelope matches the existing mobile contract.

### Staging rollback

```powershell
vercel ls <SEPARATE_STAGING_PROJECT_NAME>
vercel promote <LAST_KNOWN_GOOD_STAGING_DEPLOYMENT_URL>
```

If `vercel promote` is unavailable for the installed CLI version, use the Vercel dashboard to promote the last known-good staging deployment. Do not promote anything to production during staging validation.

## Smoke-test procedure

Against the actual staging URL, record only sanitized status/results:

1. Public health liveness and absence of database/secret details.
2. CORS allowed browser origin, disallowed browser origin, no-Origin request, and `OPTIONS` preflight.
3. Register/login/verification/refresh/logout with a staging test account.
4. Autocomplete, place details, reverse geocode, and route for a same-city trip.
5. Fare comparison in legacy mode; verify provider IDs and response schema.
6. Authenticated AI route and a follow-up using the same conversation ID.
7. Primary Groq response and isolated fallback canary.
8. Conversation persistence after a new request/cold start.
9. Invalid input, expired token, missing auth, Geoapify timeout, and LLM timeout behavior.
10. Confirm zero coverage approvals and no verified-mode activation.

Do not label a test passed until it runs against the actual staging URL. Local tests in `STAGING_VALIDATION_REPORT.md` remain staging-equivalent only.

## Approvals required from the user

- Confirm the separate Vercel staging project name and account/team scope.
- Confirm the separate Supabase/PostgreSQL staging project and database identity.
- Authorize use of staging-only Groq/Geoapify credentials.
- Approve the exact staging browser origin allowlist.
- Approve the reviewed release manifest before staging deployment.
- Explicitly authorize any Vercel CLI installation, resource setup, migration execution, and preview deployment.

