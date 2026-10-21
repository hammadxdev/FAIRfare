# Fair Fare Bykea activation dry run

Prepared 2026-10-13. This is an in-memory staging simulation for exactly four keys. It does not write `COVERAGE_EVIDENCE_REGISTER.csv`, change environment variables, change dataset mode, or enable production.

## Revalidated exact candidates

| Key | City | Public provider | Internal provider ID | Internal vehicle | Source |
|---|---|---|---|---|---|
| `PK001|urbancab|BIKE` | Lahore | Bykea | `urbancab` | `BIKE` ← Motorbike | [Bykea Pakistan page](https://www.bykea.com/pk/) |
| `PK001|urbancab|RICKSHAW` | Lahore | Bykea | `urbancab` | `RICKSHAW` ← Rickshaw | [Bykea Pakistan page](https://www.bykea.com/pk/) |
| `PK002|urbancab|BIKE` | Karachi | Bykea | `urbancab` | `BIKE` ← Motorbike | [Bykea Pakistan page](https://www.bykea.com/pk/) |
| `PK002|urbancab|RICKSHAW` | Karachi | Bykea | `urbancab` | `RICKSHAW` ← Rickshaw | [Bykea Pakistan page](https://www.bykea.com/pk/) |

The internal ID remains `urbancab`; `Bykea` is the public display name. No Yango (`quickride`) or inDrive key is in this staging allow-list.

## Explicit reviewer API

The approval mechanism is `createStagingApprovalPlan()` in `src/services/coverageApproval.service.js`. It requires one explicit request for each exact key, a reviewer ID, `approve: true`, and `mappingAccepted: true`. It rejects arrays with missing keys, duplicates, other cities, other vehicles, Yango, and inDrive.

```js
const { BYKEA_STAGING_KEYS, createStagingApprovalPlan } = require("./src/services/coverageApproval.service");

const requests = BYKEA_STAGING_KEYS.map((key) => ({
  key,
  reviewerId: "named-human-reviewer",
  approve: true,
  mappingAccepted: true,
  productionEnabled: false,
}));

const plan = createStagingApprovalPlan(requests);
```

The returned plan is auditable and marked `applied:false`. It is not a persistence command. A real persistence layer must separately require the reviewer’s explicit confirmation and update only the returned exact key.

## Verified-mode dry run

```js
const { dryRunBykeaActivation } = require("./src/services/coverageActivationDryRun.service");

const result = dryRunBykeaActivation({
  requests,
  distanceKm: 8,
  durationMin: 24,
  hourOfDay: 12,
  dayOfWeek: 2,
  weather: { condition: "CLEAR", source: "OPEN_METEO" },
});
```

Expected behavior:

- Actual mode remains `legacy`.
- Hypothetical mode is `verified` only inside the returned dry-run description.
- Four results are modeled as `APPROVED_CONFIGURATION` in memory.
- Bike and Rickshaw use valid Fair Fare synthetic parameters.
- Estimates are labeled `FAIR_FARE_SYNTHETIC_MODEL_ESTIMATE` and `liveProviderQuote:false`.
- The example route produces Bike PKR 239 and Rickshaw PKR 341 under the synthetic model assumptions. These are not Bykea quotes, observed fares, or availability claims.

## Rollback

No rollback migration is needed because the dry run has no side effects. Discard the returned `plan` and `result`; the `rollback.applied` field remains false. If a future staging persistence layer is added, rollback must delete only the four exact staging keys or restore their previous false flags from an auditable snapshot. Never clear or rewrite the full provider register.

## Risks and blockers

- App screenshots and current pickup-zone confirmation are still required before human approval, even for these four candidates.
- Official web evidence does not prove live drivers, live availability, or live Bykea pricing.
- Synthetic fare parameters are illustrative and not calibrated to Bykea rates.
- No staging persistence endpoint exists in this change; a human-approved staging test still needs an authorized persistence layer to apply the returned exact-key patches.
- AI recommendations must consume only authoritative `APPROVED_CONFIGURATION` results; unverified coverage remains blocked.

## Test outcomes

`src/tests/coverageActivationDryRun.test.js` covers exact-key approval, rejection of other cities/categories/providers, Lahore/Karachi Bike/Rickshaw synthetic fare behavior, legacy and preview mode preservation, no mutation, and the authoritative AI coverage guard. The existing coverage approval and dataset tests remain required. The real register remains 63 rows with zero reviewer-approved and zero production-enabled records.
