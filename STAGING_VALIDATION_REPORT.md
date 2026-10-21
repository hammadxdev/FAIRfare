# Fair Fare Staging Validation Report

Date: 2026-10-13

## Status

**No staging deployment was performed.** No separately verified Vercel preview URL and non-production PostgreSQL/Supabase database were provided or configured for this audit. The production URL was not used for mutating tests. It would be unsafe to claim staging success without those isolated resources.

## Locally verified staging-equivalent checks

The following checks ran against the local Express app with test credentials, mocks where documented, and no production writes:

- Authenticated trip-aware AI endpoint: passed.
- AI extraction, route resolution, and conversation-context tests: passed.
- Geoapify adapter regression suite: 16/16 passed.
- Fare API regression suite: 13/13 passed.
- Dataset/mode suite: 8/8 passed; legacy remains the default.
- Coverage approval/gating suites: 8/8 and 4/4 passed; zero approvals remain active.
- AI grounding/intent/quality suites: 7/7, 13/13, and 3/3 passed.
- Fallback failure-injection suite: 15/15 passed.
- CORS and public health security suite: 7/7 passed.

## Security surface validation

- Allowed browser origins receive CORS headers only when listed in `FAIRFARE_ALLOWED_ORIGINS`.
- Unlisted browser origins receive no CORS permission.
- Native/no-Origin requests remain compatible.
- Allowed `OPTIONS` preflight returns 204 with the configured origin.
- Public health returns only `{ application: "alive" }`.
- Health configuration diagnostics return 404 unless an internal token is explicitly configured and supplied.

## Real Groq fallback canary

An isolated child process intentionally configured an invalid primary model only for that process. It did not modify production or global environment settings.

- Primary failure: HTTP 404, classified `LLM_MODEL_ERROR`.
- Fallback model: `openai/gpt-oss-20b`.
- Provider: Groq.
- Result: successful real response.
- Fallback used: `true`.
- Latency: 884 ms.
- Grounding checks: passed; no PKR fare or live/guaranteed-fare claim in the response.
- API keys and response text were not written to this report.

## Required isolated staging verification

After an authorized preview deployment exists, run the following against the preview URL and a separate database:

1. `GET /api/health`.
2. Register/login/refresh using a staging-only test account.
3. Authenticated map resolution and route calls.
4. Authenticated fare comparison in legacy mode.
5. Authenticated AI chat and multi-turn conversation persistence.
6. Primary Groq response and the fallback canary.
7. Cold-start and timeout/error checks.
8. Confirm the preview database is not the production database.

## Blockers

- No isolated staging deployment/database was available for verification.
- Production still needs an explicit `FAIRFARE_ALLOWED_ORIGINS` value for browser clients; no production environment variable was changed.
- `/api/health/config` is disabled unless an internal diagnostics token is configured.
- The root coverage register must be tracked and included in the deployment artifact.
