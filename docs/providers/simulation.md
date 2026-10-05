# Fair Fare provider simulation

This is the backend developer reference for the FYP/demo fare simulation. It
is not a provider reverse-engineering document and does not claim to reproduce
the proprietary pricing algorithms of inDrive, Yango, or Bykea.

## Modes and stable IDs

`INDRIVE_MODE=simulated`, `YANGO_MODE=simulated`, and
`BYKEA_MODE=simulated` select deterministic adapters. In simulated mode no
provider authentication, token refresh, or live pricing request is attempted.
All simulator quotes and eligible observations carry `dataSource=SIMULATED`.

The internal IDs remain `indrive`, `quickride`, and `urbancab`; their consumer
names are inDrive, Yango, and Bykea respectively. This preserves database,
history, test, and mobile contracts.

## Methodology

The shared engine calculates `baseFare + distanceKm * perKm + durationMinutes *
perMinute`, applies a modest deterministic context factor, enforces the
category minimum, and rounds to whole PKR. Context is injected once per fare
comparison as hour, day of week, and weekend status. A bounded congestion proxy
uses duration per kilometre; it is intentionally modest because duration is
already part of the formula. ETA is deterministic and normally 2–12 minutes.

The exact coefficients are in `src/providers/simulation.engine.js` and are
Fair Fare FYP/demo simulation coefficients. They are configuration for this
project, not verified provider pricing.

inDrive is simulated as negotiated: `fare` is the recommended/autofill offer,
while `fareMin`, `fareMax`, and deterministic `metadata.priceSteps` represent
adjustable boundaries. They are not a conventional predicted fare range.
Yango and Bykea are simulated as independent upfront estimated-fare models;
neither is derived as a multiplier of another provider.

## Provenance and downstream behavior

Quotes retain the normalized schema (`providerCategoryId`, category name,
normalized taxonomy, fare type, currency, ETA, availability, and metadata).
The existing observation, prediction, Book/Wait, recommendation, and
personalization pipeline remains downstream of the adapter seam. Current fare
and model expected fare remain separate. Prediction failure preserves a valid
quote, avoided vehicles remain visible and launchable, and missing ETA is not
treated as zero.

The system distinguishes:

- **VERIFIED**: provider behavior supported by repository/provider evidence,
  including inDrive category IDs and the parked real adapter contract.
- **SIMULATED**: Fair Fare deterministic demo behavior documented here.
- **UNKNOWN**: provider responses or categories not mapped by the contract.

Use `calibrationMatrix()` from the simulation engine with fixed context for a
reproducible SHORT, MEDIUM, LONG, and HEAVY_TRAFFIC review. Never add provider
credentials or security/fingerprint values to tests or documentation.
