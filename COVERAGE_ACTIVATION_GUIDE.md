# Fair Fare coverage activation guide

This workflow activates one exact city-provider-vehicle combination at a time. It does not activate a provider, a city, or all vehicles by implication.

## 1. Select one candidate

Use `buildApprovalMatrix()` from `src/services/coverageApproval.service.js` and copy one exact key, for example `PK001|quickride|BIKE`. Never submit an array, wildcard, provider-only key, or city-only key. The matrix is separate from the 30,000 synthetic scenarios and does not modify them.

## 2. Complete evidence checks

For that exact row, follow `MANUAL_APP_VERIFICATION_CHECKLIST.md`: select the canonical city, place pickup and drop-off pins inside it, confirm the provider category is visibly selectable, and record the dated app evidence, app version, service-area scope, source/reference, reviewer, and unresolved questions. Keep intercity testing separate.

Official web evidence supports review; it does not establish live driver availability. Do not turn a national service statement into city evidence, and do not map generic “cars” to Economy, Comfort, or Premium.

## 3. Ask the approval service to validate the action

An integration or admin tool must call `createApprovalPatch()` with one object like:

```js
{
  key: "PK001|quickride|BIKE",
  reviewerId: "named-reviewer",
  approve: true,
  mappingAccepted: true,
  productionEnabled: false
}
```

The function rejects missing official evidence, ambiguous mappings, conflicting evidence, unknown keys, and non-explicit approval. `productionEnabled:true` additionally requires explicit `mappingAccepted:true`. It returns a patch for the caller to persist; it does not mutate the register or enable anything itself.

## 4. Persist only the returned exact-row patch

The persistence layer must update only the matching city ID, unchanged internal provider ID, and exact internal vehicle type. It must preserve all other rows and reject a request that would affect more than one key. Keep `reviewer_approved=false` and `production_enabled=false` until the reviewer action succeeds.

The legacy environment allow-list remains exact-key based. It is fail-closed against keys that are not `READY_FOR_REVIEW` with an unambiguous mapping. No provider or vehicle is enabled merely because it appears in a provider registry or synthetic fare model.

## 5. AI safety rules

The AI Assistant may use only supplied verified comparison facts. It must not recommend an unverified provider or vehicle, infer availability from national or generic-car evidence, or describe simulated estimates as live provider quotes. When exact coverage is unavailable, it should say that provider-app confirmation is required.

## Explicit prohibitions

- Do not set either activation flag by editing all rows, provider-wide defaults, or vehicle-wide defaults.
- Do not approve `APP_CHECK_REQUIRED`, `MORE_RESEARCH_REQUIRED`, or `CONFLICTING_EVIDENCE` rows.
- Do not infer Premium from Economy/Comfort, or Standard from a generic car claim.
- Do not switch dataset mode to `verified` as part of review. Approval is a separate, explicit release decision.
- Do not alter provider internal IDs: `indrive`, `quickride`, and `urbancab` are compatibility identifiers.
