# Coverage review summary

Checked 2026-10-13 using official public sources where available. No database migration, deployment, or provider app login was used.

## Findings

- Dataset matrix: 21 cities × 3 providers = 63 rows; all 63 are represented.
- Dataset scenarios: 30,000 synthetic rows. They are model/test data, not observed provider quotations.
- Verified provider-city rows in the dataset: 0.
- Verified vehicle-coverage rows in the dataset: 0.
- Production-enabled rows: 0.
- Current provider IDs remain `indrive` → inDrive, `quickride` → Yango, `urbancab` → Bykea.
- Yango has official current city evidence for Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad and Multan.
- Bykea has current official city/service evidence for Karachi, Lahore and Islamabad. Rawalpindi has older operational material and a current office listing, so it remains review-required.
- inDrive official evidence found here is either an undifferentiated 11-city Pakistan statement or an airport-feature list. It does not provide a complete city-wide 21-city register, so no inDrive row is production-enabled.

## Status totals in this register

| Status | City-provider records | Meaning |
|---|---:|---|
| OFFICIAL_LISTED | 9 | Yango six cities + Bykea three cities |
| REVIEW_REQUIRED | 5 | inDrive airport-feature rows for Lahore/Karachi/Islamabad/Rawalpindi plus Bykea Rawalpindi |
| UNVERIFIED | 17 | inDrive rows without enumerated city evidence |
| NOT_LISTED | 32 | No qualifying public listing found; not confirmed unsupported |
| CONFIRMED_UNSUPPORTED | 0 | No credible explicit unsupported evidence found |

The machine register is authoritative for counts; status totals should be read from it rather than this compact summary.

## Vehicle findings

Yango's official service classes include Economy, Comfort, Bike and Rickshaw. Bike and Rickshaw map directly to Fair Fare `BIKE` and `RICKSHAW`. Economy maps to `ECONOMY_CAR`. Comfort is a provider class and its mapping to Fair Fare `STANDARD_CAR` requires manual review. No official source reviewed here establishes `PREMIUM_CAR` coverage.

Bykea's official page names motorbikes, rickshaws and cars. Bike and Rickshaw map directly; the generic Cars label does not prove Economy, Comfort or Premium and remains `REVIEW_REQUIRED` for mapping.

## Locality and evidence gaps

- Confirm whether Wah and Taxila are selectable in each provider app as standalone service areas or covered under a metropolitan zone.
- Confirm whether Raiwind is a selectable area rather than a Lahore locality alias.
- Do not copy coverage between Islamabad and Rawalpindi.
- Obtain dated app observations for every provider/city/category that may be production-enabled.
- Obtain city-specific inDrive evidence for the 21 candidates and explicit service-category evidence.
- Review Yango city pages for exact boundaries; a city page does not itself prove every neighborhood or intercity route.

## Current production state

No coverage record is production-enabled. Keep `FAIR_FARE_DATASET_MODE=legacy` in production. Use `preview` only for internal QA; use `verified` only after a reviewer has approved exact city/provider/vehicle rows and the backend approval configuration is populated.
