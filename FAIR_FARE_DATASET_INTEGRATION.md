# Fair Fare dataset integration

The bundled v1 dataset is synthetic model/test data. It is not provider
quotations, live availability, routes, traffic, closures, or measured demand.

## Coverage gate

`resolveTripCoverage()` accepts a provider/city/vehicle combination only when
the dataset marks both provider-city coverage and vehicle coverage as verified
and production-enabled. An exact explicit approval can be supplied with
`FAIRFARE_APPROVED_COVERAGE=City|provider|vehicle,...` after independent review.
Unknown cities, missing rows, unverified rows, and intercity trips fail closed
with a status and no fare. The current dataset enables none of these paths.

The provider registry intentionally keeps internal IDs stable:

| Internal ID | Display name | Dataset provider label | Mobile/deep-link identity |
|---|---|---|---|
| `indrive` | `inDrive` | `inDrive` | `indrive` |
| `quickride` | `Yango` | `Yango` | `quickride` |
| `urbancab` | `Bykea` | `Bykea` | `urbancab` |

`quickride` and `urbancab` are existing application identifiers, not claims
that those brands share an implementation. The database seed and provider
registry are the source of truth for the mapping; the dataset service only
normalizes dataset labels to those existing IDs.

## Verification workflow

For each city/provider/vehicle approval, record the provider's official source
URL, service type/category, evidence capture date, reviewer, review status, and
an expiry/recheck date. A reviewer must independently confirm the city and the
specific vehicle category. Do not treat `provisional_listed`, `unverified`,
missing evidence, or an old URL as support. Until both city-provider and
vehicle evidence are approved, leave `FAIR_FARE_DATASET_MODE=legacy` or use
`preview` for diagnostics.

The reviewed public-source register is `COVERAGE_EVIDENCE_REGISTER.csv`, with
the city report, vehicle report, and app checklist in this backend folder. It
is intentionally separate from the synthetic scenario files. The register
uses `OFFICIAL_LISTED`, `APP_CONFIRMED`, `UNVERIFIED`, `REVIEW_REQUIRED`,
`NOT_LISTED`, and `CONFIRMED_UNSUPPORTED`; all current `reviewer_approved` and
`production_enabled` values are false. `NOT_LISTED` is not treated as
unsupported. A human reviewer must approve the exact vehicle mapping before
adding an exact `City|internal-provider-id|vehicle` entry to the opt-in
approval configuration.

## Fare model

`FAIR_FARE_DATASET_MODE` controls rollout:

- `legacy` (default): existing provider adapters and public results are unchanged.
- `preview`: legacy public results remain authoritative; `datasetPreview` contains isolated synthetic estimates and coverage diagnostics.
- `verified`: only explicitly verified/approved city-provider-vehicle combinations receive dataset estimates.

For an explicitly supported combination only:

`round(max(minimum, base + distance_km * per_km + duration_min * per_minute) * time_multiplier * weather_multiplier)`

Distance and duration come from the existing Geoapify route when provided by
the client/backend flow; the existing fallback remains available. Time rules
are synthetic illustrative weekday/hour rules. Weather adjustments are applied
only when the existing weather service supplies a non-unknown, reliable source.
No event surcharge, popular-location surcharge, fuel adjustment, or extra
congestion adjustment is applied. Route duration already carries the route
condition signal, avoiding double-counting.

The response keeps the scalar `fare`; uncertainty is separate as
`uncertaintyMarginPkr` and is explicitly labelled as the uncalibrated synthetic
assumption `max(15 PKR, 8%)`. It is not a real-world accuracy claim.

## Validation

Run `npm run validate:dataset:v1`. It parses the large scenario CSV only for
the audit and checks headers, counts, references, numeric route/fare values,
duplicates, and unsafe production flags. Request handling loads only the small
reference CSVs once per process and never sends scenario rows to Groq.

`FAIR_FARE_DATASET_MODE` defaults to `legacy`. Set it explicitly to `preview`
for diagnostics or `verified` only after coverage approvals are independently
 reviewed. Invalid values also fall back to `legacy`.

The AI assistant receives the same public comparison results used by the mobile
UI. Preview-only diagnostics are not included in its grounding context, and
verified-mode unavailable rows cannot produce cheapest-fare, Book/Wait, or ETA
facts. The assistant must describe these as model estimates rather than live
provider quotations or availability.
