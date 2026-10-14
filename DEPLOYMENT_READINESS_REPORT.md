# Fair Fare Deployment Readiness Report

Date: 2026-10-13

Recommendation: **GO for commit review; NO-GO for deployment**.

The implementation is technically smoke-tested, but the worktree is not in a clean, reviewable release state. Required implementation files are still untracked, no isolated staging deployment/database was available, and coverage remains intentionally unapproved.

## Backend readiness

- `POST /api/ai/chat` is mounted exactly once in `src/app.js`.
- The mount uses `src/routes/tripAwareAi.routes.js`, whose chat and conversation routes retain `requireAuth`.
- The adapter calls `tripAwareAi.controller.chat`; it does not call the public controller recursively.
- The adapter preserves the existing conversation persistence and response envelope.
- When a `comparisonId` is supplied, the established AI grounding path remains authoritative for fare facts and Book/Wait semantics.
- CommonJS compatibility checks passed for the new route, controller, trip-aware service, trip extraction/resolution, Geoapify adapter, fare service, and app entrypoint.
- `api/index.js` remains a CommonJS Vercel entrypoint that exports the Express app.
- PostgreSQL is required in production/Vercel and the `pg` dependency is present. SQLite is not used in the Vercel production path.

## Mobile readiness

- `mobile/.env` and the EAS preview/production profiles point to `https://fai-rfare.vercel.app/api`.
- The inspected preview APK contains the production Vercel hostname. It is therefore not a local-backend APK.
- Expo config resolves HTTPS API usage with Android cleartext disabled.
- Mobile contract/regression tests passed: 23 test files, 23 passed.
- The mobile changes preserve authoritative location state, stale-request guards, route eligibility checks, and vehicle-switch behavior.

## Smoke and test results

### Live Geoapify smoke

Credentials were configured locally and were not printed.

Both non-destructive live cases passed after administrative-context normalization:

| Trip | Result | Route |
|---|---|---:|
| North Nazimabad → Gulshan-e-Hameed Phase 2 | `RESOLVED`, Karachi Division | 38.67 km, ~40.4 min |
| Gulberg III → Lahore Garrison University | `RESOLVED`; destination locality was `Lidher` within Lahore District | 13.65 km, ~18.3 min |

The second case initially produced a false cross-city result because Geoapify used `Lahore` and `Lidher` as city labels. The resolver now accepts matching authoritative administrative context such as `Lahore District`, while still treating genuinely conflicting contexts as cross-city.

### Local HTTP AI endpoint

Passed `src/tests/tripAwareAiEndpoint.test.js` using an authenticated test account/session and mocked geocoding/routing. The North Nazimabad message:

```text
ok so i wanna go from north nazimabad to gulshan e hameed phase 2
```

was extracted, geocoded, routed, and acknowledged without requesting redundant street-level pickup/drop-off details or fabricating fares/provider availability.

### Backend tests

### Final unrestricted Windows PowerShell backend suite

- Reported result: **252 tests passed, 0 failed, 0 skipped**.
- Reported duration: approximately 60 seconds.
- Dataset validation also passed; expected synthetic/unverified coverage warnings were observed.
- The complete console log is retained at `release-evidence/backend-suite-unrestricted.log`; it is ignored by Git and must not be staged.
- A local constrained rerun was archived at `release-evidence/backend-suite-2026-10-13.log`: **252 tests, 225 passed, 27 failed, 0 skipped**, exit code **1**, duration **174540.1151 ms**. The failures included environment/test-isolation `spawn EPERM` and verification-test setup errors; this run does not supersede the reported unrestricted result.

### Diagnosis of the constrained rerun failures

The archived failure list was read in full. The failures cluster around the
single-process constrained runner (`--test-isolation=none`) and its restricted
subprocess environment:

- 13 `aiFallback.test.js` failures observed Groq models where the file's
  fixture expected OpenRouter models. This is shared mutable process
  environment/LLM test state, not a production assertion result.
- 10 authenticated integration failures received `EMAIL_OTP_INVALID` after
  the test email provider returned `EMAIL_PROVIDER_ERROR`. This is shared
  email-provider/OTP fixture state under the single-process runner.
- 3 prediction/model parity failures attempted Python subprocesses and hit
  `spawn EPERM`; the affected code paths are explicitly subprocess-based.
- 1 AI conversation test found `global.__conversationContext` undefined after
  its conversation loop, consistent with the same shared test-client state
  contamination.

No archived failure provides evidence of a genuine application assertion
failure independent of test isolation or process permissions. The prior
unrestricted Windows PowerShell result of 252 passed remains a separate,
reported result and must be reproduced or retained with its original evidence
before changing the release recommendation.

Focused single-process test runs passed, including:

- Trip extraction/resolution: 4 tests.
- Public trip-aware AI endpoint: 1 test.
- Geoapify adapter: 16 tests.
- AI grounding/intent: 20 tests.
- Fare dataset/mode: 8 tests.
- Coverage approval: 8 tests.
- Relevant AI assistant, fare, and mobile integration regressions previously passed.

The package-level `npm test` command is not usable in this Windows environment because Node's parallel test runner attempts child processes and every file fails with `spawn EPERM`. A serial sweep was attempted but did not complete cleanly. Release CI must run the backend suite with test isolation disabled or one test file per process and record the complete result.

### Syntax/build checks

- Backend changed CommonJS files: passed `node --check`.
- Mobile changed utility/screen files: passed `node --check`.
- `npx expo config --json`: passed.
- Vercel model artifact path exists: `ml/node_artifacts/synthetic_600/fare_model.json`.
- `vercel.json` now explicitly includes the coverage register and Fair Fare dataset CSV/JSON assets; the root register still must be intentionally tracked in the release commit.

## Dataset and coverage safety

- `FAIR_FARE_DATASET_MODE` resolves to `legacy`.
- Coverage register contains 63 records.
- Reviewer-approved records: 0.
- Production-enabled records: 0.
- Existing internal provider IDs remain `indrive`, `quickride`, and `urbancab`; public names remain in the register as inDrive, Yango, and Bykea.
- No provider coverage was approved or activated during this audit.

### Final read-only Supabase schema evidence

- `PRODUCTION_SCHEMA_READONLY_CHECK.sql` was used without any migration or
  write operation.
- Result: **246 PASS, 0 MISSING**.
- `009_production_schema_gaps.sql` remains explicitly excluded.

## Git changes requiring review/commit

### Backend tracked modifications

`.env.example`, `package.json`, `src/app.js`, `src/services/fare.service.js`, `src/services/maps/geoapifyMaps.service.js`, and existing AI/fare/setup tests are modified.

### Backend untracked implementation/documentation

The new route and trip-aware implementation require review before commit:

- `src/controllers/tripAwareAi.controller.js`
- `src/routes/tripAwareAi.routes.js`
- `src/services/tripAwareAiAssistant.service.js`
- `src/services/tripExtraction.service.js`
- `src/services/tripResolution.service.js`
- `src/tests/tripAwareAiEndpoint.test.js`
- `src/tests/tripExtraction.test.js`
- Coverage services/tests and coverage Markdown/CSV artifacts
- Fair Fare dataset services/validator and related documentation

### Files requiring cleanup or explicit release decision

- `backend/tatus --short` appears to be an accidental untracked file and should not be committed.
- `ml/artifacts/synthetic_600/` is untracked; decide whether it is source/release material or generated output.
- Mobile contains multiple untracked APKs and `apk-inspect/`; these should not be committed as source unless the release process explicitly stores binaries.
- Mobile has many tracked UI/location changes and new contract tests; review them as one coherent mobile change set before release.

## Vercel compatibility blockers

The new JavaScript imports are CommonJS-compatible and the Vercel entrypoint loads the app. However, runtime file packaging must be verified before deployment:

- `coverageApproval.service.js` reads root-level `COVERAGE_EVIDENCE_REGISTER.csv` dynamically.
- `fairFareDataset.service.js` reads CSV files under `src/data/Fair_Fare_Synthetic_Dataset_v1` dynamically.
- `vercel.json` explicitly includes the synthetic Node fare model artifact, coverage register, and Fair Fare CSV/JSON directory. Confirm the final Vercel bundle after the release commit.
- Vercel environment configuration must include `DATABASE_URL`, `JWT_ACCESS_SECRET`, the AI provider secrets/model settings, and `GEOAPIFY_API_KEY`; local `.env` presence does not prove Vercel configuration.

## Security and packaging fixes completed

- Replaced unrestricted `cors()` with `FAIRFARE_ALLOWED_ORIGINS`; no-Origin native requests remain allowed and unlisted browser origins receive no CORS permission.
- Reduced public `/api/health` to a minimal liveness response.
- Restricted `/api/health/config` to an optional server-only `x-health-diagnostics-token`; it returns 404 when diagnostics are not enabled.
- Added `src/tests/securitySurface.test.js` covering allowed/disallowed origins, native requests, preflight, and health diagnostics.
- Added explicit Vercel inclusion for the coverage register and Fair Fare dataset CSV/JSON assets.
- Narrowed the `data/` ignore rule so required `src/data/**` assets are reviewable for commit.

## Remaining blockers

1. Worktree cleanup and code review are required; required route/service files are untracked.
2. The accidental `tatus --short` file and generated APK/artifact files need an explicit cleanup decision.
3. Vercel inclusion of the dynamically read coverage and dataset files must be confirmed after the release commit.
4. Vercel production environment variables and database connectivity must be checked in the deployment environment.
5. The complete unrestricted-suite console log is archived locally and ignored; do not stage it.
6. No isolated staging deployment and non-production database were available for verification.
7. Production Vercel requires an explicit `FAIRFARE_ALLOWED_ORIGINS` value for browser clients; no production environment variable was changed locally.
8. Coverage approvals remain zero by design; verified mode must not be enabled as part of this release.
9. The final Supabase schema checker returned 246 PASS and 0 MISSING; it was read-only, and `009_production_schema_gaps.sql` remains excluded from the release plan.
10. The reviewed allowlist must be reconciled with the deliberate tracked worktree changes (`.env.example`, `.gitignore`, `README.md`, provider/health/fare changes, and related tests) before operators execute the proposed staging command.

## Recommended deployment sequence

1. Review and stage only the intended backend/mobile source, tests, and documentation.
2. Remove or exclude accidental/generated artifacts from the release commit.
3. Add/verify Vercel file inclusion for required CSV/register files.
4. Configure and validate Vercel secrets and PostgreSQL connectivity without enabling coverage approvals.
5. Run the serial backend suite, mobile contract suite, syntax checks, and mocked endpoint test in CI.
6. Deploy backend to a non-production preview and test `/api/health`, authenticated `/api/ai/chat`, both live-style trip cases, and legacy fare comparison.
7. Verify the APK/API pairing against the preview environment before any production release.
8. Production deployment remains separate and requires explicit approval.

## Rollback procedure

- Revert the deployment to the previous Vercel deployment, or promote the last known-good deployment.
- Restore the previous mobile binary; do not modify provider IDs or fare data during rollback.
- Keep `FAIR_FARE_DATASET_MODE=legacy` and leave `FAIRFARE_APPROVED_COVERAGE` empty.
- If the new route adapter misbehaves, restore the previous `/api/ai` route registration while retaining database and coverage flags unchanged.
- Confirm `/api/health`, authenticated AI requests, fare comparison, and Book/Wait grounding after rollback.
