# Fair Fare Production Release Checklist

## Approval gates

- [ ] Explicit approval to release the reviewed backend commit.
- [ ] No unreviewed generated evaluation files or accidental files are included.
- [ ] `tatus --short`, local databases, logs, and ML dependency caches are excluded.
- [ ] Required implementation files are tracked, including the trip-aware route/services and coverage register.
- [ ] `FAIR_FARE_DATASET_MODE=legacy` is confirmed in Vercel.
- [ ] `FAIRFARE_APPROVED_COVERAGE` remains empty unless separately approved.
- [ ] `FAIRFARE_ALLOWED_ORIGINS` contains only approved browser origins; native clients do not require an entry.
- [ ] `HEALTH_DIAGNOSTICS_TOKEN` is unset unless internal diagnostics are explicitly required and securely managed.
- [ ] Provider IDs remain `indrive`, `quickride`, and `urbancab`.

## Runtime/package gates

- [ ] `api/index.js`, `src/app.js`, and all route/controller/service imports pass CommonJS syntax checks.
- [ ] `vercel.json` includes the Node fare model, coverage register, and Fair Fare dataset CSV/JSON assets.
- [ ] `package-lock.json` matches `package.json`.
- [ ] No runtime path depends on a writable serverless filesystem.
- [ ] PostgreSQL is used in Vercel; SQLite is not enabled there.
- [ ] Database pool limits/timeouts are appropriate for the selected Supabase/PostgreSQL plan.

## Environment checklist (names only; never commit values)

- [ ] `DATABASE_URL`
- [ ] `JWT_ACCESS_SECRET`
- [ ] `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_FALLBACK_MODEL`
- [ ] `AI_ASSISTANT_ENABLED`, fallback/timeout settings
- [ ] `GEOAPIFY_API_KEY`, `MAPS_PROVIDER`
- [ ] `NODE_ENV=production`
- [ ] `FAIR_FARE_DATASET_MODE=legacy`
- [ ] `FAIRFARE_APPROVED_COVERAGE` empty
- [ ] Email/OAuth/verification variables configured only if those features are enabled

## Pre-release tests

- [ ] Serial backend test suite passes in CI; Windows `spawn EPERM` is avoided by single-process execution.
- [ ] Authenticated AI endpoint smoke test passes.
- [ ] Geoapify resolution/routing smoke tests pass.
- [ ] Legacy fare comparison passes.
- [ ] Real Groq primary smoke passes.
- [ ] Real Groq fallback canary passes and reports `fallbackUsed=true`.
- [ ] Conversation persistence and refresh-token behavior pass against staging PostgreSQL.
- [ ] No coverage row is approved or production-enabled accidentally.

## Release sequence

1. Review the worktree and stage only intended source/assets/tests.
2. Deploy a Vercel preview connected to a non-production database.
3. Run `STAGING_VALIDATION_REPORT.md` checks and record the preview URL.
4. Review logs for secrets, stack traces, timeout behavior, and fallback use.
5. Obtain explicit release approval.
6. Deploy production without changing dataset mode or coverage flags.
7. Run read-only health/auth/fare/AI smoke checks.
8. Monitor errors, latency, database saturation, map failures, and LLM fallback rate.

## Rollback

- Promote the last known-good Vercel deployment.
- Keep `FAIR_FARE_DATASET_MODE=legacy` and approvals unchanged.
- Do not run migrations as part of rollback.
- Recheck health, authentication, fare comparison, and AI grounding.
- Preserve logs and the deployment identifier for incident review.
