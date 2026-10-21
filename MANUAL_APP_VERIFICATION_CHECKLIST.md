# Manual app verification checklist

Purpose: obtain dated, reproducible evidence before enabling any exact city × provider × vehicle record. Complete each check with a real provider app session or an approved documented observation. Do not use search snippets or an undated screenshot as approval.

## Required evidence per record

- [ ] City/locality selected in the provider app, with the exact spelling and any parent-zone label recorded.
- [ ] Pickup pin placed inside the locality and destination pin placed inside the same locality.
- [ ] Provider service category visibly selectable: Bike, Rickshaw, Economy, Comfort/standard, or Premium.
- [ ] Screenshot or screen recording captured with device date/time and app version.
- [ ] Source URL or app observation reference recorded; reviewer and review date recorded.
- [ ] Service-area scope marked city-wide, zone-specific, or unclear.
- [ ] Intercity test kept separate; same-city availability is not evidence for intercity trips.
- [ ] `reviewer_approved` remains false until a second review confirms the record.
- [ ] `production_enabled` remains false until the exact internal category mapping is accepted.

## 63 city-provider records

Run the five vehicle checks for each row. `*` marks a preliminary research candidate, not a confirmed claim.

| City | inDrive | Yango | Bykea |
|---|---|---|---|
| Lahore* | [ ] | [ ] | [ ] |
| Karachi* | [ ] | [ ] | [ ] |
| Islamabad* | [ ] | [ ] | [ ] |
| Rawalpindi* | [ ] | [ ] | [ ] |
| Faisalabad* | [ ] | [ ] | [ ] |
| Multan* | [ ] | [ ] | [ ] |
| Hyderabad* | [ ] | [ ] | [ ] |
| Peshawar* | [ ] | [ ] | [ ] |
| Sialkot* | [ ] | [ ] | [ ] |
| Sahiwal* | [ ] | [ ] | [ ] |
| Abbottabad* | [ ] | [ ] | [ ] |
| Gujranwala* | [ ] | [ ] | [ ] |
| Larkana* | [ ] | [ ] | [ ] |
| Kamoke* | [ ] | [ ] | [ ] |
| Sheikhupura* | [ ] | [ ] | [ ] |
| Hafizabad* | [ ] | [ ] | [ ] |
| Okara* | [ ] | [ ] | [ ] |
| Wah* | [ ] | [ ] | [ ] |
| Taxila* | [ ] | [ ] | [ ] |
| Quetta* | [ ] | [ ] | [ ] |
| Raiwind* | [ ] | [ ] | [ ] |

For each checked category, append a row to `COVERAGE_EVIDENCE_REGISTER.csv` or update the corresponding reviewed register through the approved data workflow. Never change the synthetic scenario CSV to represent app evidence.

## Special locality checks

- [ ] Wah: determine whether the provider app treats it as a standalone city or Islamabad/Rawalpindi zone.
- [ ] Taxila: determine whether it is standalone or part of the Islamabad/Rawalpindi service area.
- [ ] Raiwind: determine whether it is a Lahore locality alias or a separate selectable service area.
- [ ] Islamabad and Rawalpindi: test and record separately even when an app groups them.
- [ ] Test one route that crosses each city boundary; do not infer intercity support from a successful city ride.
