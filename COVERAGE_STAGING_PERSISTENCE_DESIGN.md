# Staging-only coverage evidence and approval design

This design is service-only. It exposes no public approval endpoint, performs no migration, and does not change the current register or active dataset mode.

## Intake contract

`validateEvidenceSubmission()` accepts only the four exact Bykea keys and requires:

- canonical city ID/name and exact `urbancab` + `BIKE`/`RICKSHAW` mapping;
- pickup zone;
- ISO observation timestamp with an explicit `+05:00` Asia/Karachi offset;
- a `private://coverage/...` screenshot reference, never a public URL;
- boolean category selectability;
- a reviewer decision and future `reviewBy` expiration date.

Reviewer identity is taken from authenticated server context (`authContext.reviewerId`), never from the submitted evidence body.

## Authorized persistence boundary

`persistStagingApproval()` requires an authenticated `coverage_reviewer` or `coverage_admin`, valid non-expired evidence, `APPROVE_CANDIDATE`, and `categorySelectable:true`. The repository adapter must provide one transaction with:

1. append an immutable audit record;
2. upsert one exact city/provider/vehicle row with `reviewerApproved=true` and `productionEnabled=false`;
3. return the audit ID and exact key.

The adapter should be implemented over the existing PostgreSQL/Supabase connection when staging persistence is authorized. The production application must not call this service from a public route.

## Reversal

`rollbackStagingApproval()` requires the same authenticated reviewer boundary, appends a rollback audit event, and deactivates only the requested exact key by setting both flags false. It never clears the provider register or performs a provider-wide rollback.

## Rollout

Use an effective-coverage overlay scoped by exact city/provider/vehicle keys in staging. Existing fare cards remain visible; only the exact approved rows may receive verified-mode synthetic estimates. Other providers, cities, and vehicles remain governed by their existing coverage status. AI recommendations must use the same effective coverage result and must not recommend rows marked unverified or ambiguous.

Before persistence is authorized, the in-memory dry-run remains the only permitted activation test. No screenshot, observation, reviewer decision, or production flag is fabricated by this workflow.
