# Fair Fare coverage approval candidates

Checked 2026-10-13. This is a reviewer queue, not an approval. All 315 exact city-provider-vehicle rows remain `reviewer_approved=false` and `production_enabled=false`.

The machine-readable matrix is produced by `src/services/coverageApproval.service.js`. It deliberately has one row per exact `city_id|provider_internal_id|vehicleType` key. National listings are not used as city evidence, and a provider listing never expands to every vehicle.

## Best-supported combinations — prior queue (24 audited rows)

The prior queue mixed provider-level category listings with exact city-category evidence. The final audit in `COVERAGE_FINAL_REVIEW.md` downgrades 20 rows to `APP_CHECK_REQUIRED`; only four Bykea Lahore/Karachi rows remain approval candidates. A human must still verify the exact pickup in the app and explicitly approve the one row.

| Exact key pattern | Cities | Provider ID / display name | Internal vehicle | Official evidence | Remaining reviewer question |
|---|---|---|---|---|---|
| `PK001..PK006|quickride|BIKE` | Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan | `quickride` / Yango | `BIKE` ← Bike | [Yango Pakistan rider page](https://yango.com/rur_pk/rider/); [Multan launch](https://yango.com/en_int/news/no-bargains-just-better-rides-yango-launches-in-multan-with-safer-affordable-mobility) | Is Bike selectable for this exact city and pickup today? |
| `PK001..PK006|quickride|RICKSHAW` | Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan | `quickride` / Yango | `RICKSHAW` ← Rickshaw | [Yango Pakistan rider page](https://yango.com/rur_pk/rider/); [Multan launch](https://yango.com/en_int/news/no-bargains-just-better-rides-yango-launches-in-multan-with-safer-affordable-mobility) | Is Rickshaw selectable for this exact city and pickup today? |
| `PK001..PK006|quickride|ECONOMY_CAR` | Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan | `quickride` / Yango | `ECONOMY_CAR` ← Economy | [Yango Pakistan rider page](https://yango.com/rur_pk/rider/); [Multan launch](https://yango.com/en_int/news/no-bargains-just-better-rides-yango-launches-in-multan-with-safer-affordable-mobility) | Is Economy selectable for this exact city and pickup today? |
| `PK001..PK003|urbancab|BIKE` | Lahore, Karachi, Islamabad | `urbancab` / Bykea | `BIKE` ← Motorbike | [Bykea Pakistan page](https://www.bykea.com/pk/) | Is Motorbike selectable at the tested pickup? |
| `PK001..PK003|urbancab|RICKSHAW` | Lahore, Karachi, Islamabad | `urbancab` / Bykea | `RICKSHAW` ← Rickshaw | [Bykea Pakistan page](https://www.bykea.com/pk/) | Is Rickshaw selectable at the tested pickup? |

The range notation above expands to individual keys and is not a bulk approval instruction. See `COVERAGE_FINAL_REVIEW.md` for the numbered decisions.

## Requires more evidence

| Classification | Count | What is missing |
|---|---:|---|
| `APP_CHECK_REQUIRED` | 55 | City evidence exists, but the exact vehicle mapping, city-category association, or current app availability is unclear. This includes the 20 downgraded former candidates, Yango Comfort → `STANDARD_CAR`, Bykea generic Car → `STANDARD_CAR`, Bykea Rawalpindi, and inDrive’s city-specific airport rows. |
| `MORE_RESEARCH_REQUIRED` | 256 | No enumerated official city-specific evidence, ambiguous locality/zone boundary, or no vehicle evidence. National inDrive claims and `NOT_LISTED` rows stay here. |
| `CONFLICTING_EVIDENCE` | 0 | No direct source conflict was recorded; historical Rawalpindi evidence is treated as insufficient current evidence, not as a conflict. |

No row should be approved from this document alone. For unresolved rows, record the exact app category, city label, pickup pin, app version, timestamp, screenshot reference, and reviewer decision in the evidence register through the approved data workflow.
