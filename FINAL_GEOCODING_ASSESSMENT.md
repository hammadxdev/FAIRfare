# Final Fair Fare Geocoding Assessment

Date: 2026-10-13

## Recommendation

**GO for controlled staging validation of the geocoding path.** Do not enable provider coverage or change the production dataset mode. The resolver now handles the tested Lahore routes with approximate labels and continues to fail closed when Geoapify cannot provide a trustworthy candidate.

## Root cause

`Gulberg III → Liberty Market` was not failing because the place name was unsupported. It failed because Geoapify returned unstable, context-sensitive candidate sets:

- `Gulberg III` without a city sometimes returned unrelated Lahore POIs, buildings, or only a generic `Gulberg` suburb.
- `Gulberg 3, Lahore` returned a high-confidence `street` candidate with `Lahore District` context.
- `Liberty Market` returned several same-name candidates: Lahore amenity, Lahore Cant suburb/street, and a Karachi amenity.
- The resolver could receive `Lahore Cant` as the destination city and use that literal label in the pickup fallback. Geoapify then returned weaker `Gulberg` candidates instead of the specific `Gulberg 3` area.

This was a city-context normalization issue combined with provider candidate variability, not a reason to lower global matching thresholds.

## Live candidate evidence

| Query | Selected/leading candidate | Context | Type | Score | Decision |
|---|---|---|---|---:|---|
| `Gulberg III` | Ambassador Travel & Tours | Lahore / Lahore District | amenity | -10000 | Reject: unrelated POI; address-token match only. |
| `Gulberg 3` | 3 Gulberg 3 | Model Town Tehsil / Lahore District | building | -10000 | Reject: non-area building result. |
| `Gulberg 3, Lahore` | Gulberg 3 | Model Town Tehsil / Lahore District | street, confidence 0.9 | 865 | Accept as approximate area match. |
| `Liberty Market` | Liberty Market | Lahore / Lahore District | amenity, confidence 1 | 1917 | Not selected alone because same-name candidates conflicted. |
| `Liberty Market` | Liberty Market | Lahore Cant / Lahore District | suburb, confidence 1 | 1889 | Not selected alone because same-name candidates conflicted. |
| `Liberty Market, Lahore` | Liberty Market | Lahore Cant / Lahore District | suburb | 1640 | Accept as approximate, city-scoped match. |

The selected pickup and destination share `Lahore District`. `Lahore Cant`, `Model Town Tehsil`, and `Lahore` are normalized as compatible local administrative labels; Karachi District remains incompatible.

No coordinates were hardcoded. All route coordinates came from the live Geoapify response.

## Changes

- Canonicalized `Lahore Cant` to `Lahore` when constructing city-scoped fallback queries.
- Kept fallback queries limited to unresolved candidates and removed proximity bias only for those fallback aliases.
- Preserved strict rejection of unrelated POIs, non-area building results, low token coverage, and conflicting generic candidates.
- Normalized the confirmed Geoapify display spelling `Lahore Garission University` to `Lahore Garrison University` without changing its source identity or coordinates.
- Added/retained approximate labels for area-level route estimates.

## Before and after

Previous Liberty response:

> I found the destination, but could not resolve the pickup location confidently. Please clarify only that location.

Final authenticated endpoint response:

> I found Gulberg 3 to Liberty Market. The approximate map-based road route is 4.8 km and about 6 minutes. Fair Fare does not have a verified provider comparison for this message yet, so I will not invent a fare or availability.

The authenticated Scenario 2 response now displays:

> I found Gulberg 3 to Lahore Garrison University. The approximate map-based road route is 15 km and about 18 minutes. Fair Fare does not have a verified provider comparison for this message yet, so I will not invent a fare or availability.

## Verification results

- `Gulberg III → Liberty Market`: live resolver and authenticated `POST /api/ai/chat` resolved; route marked approximate.
- `Gulberg III → Lahore Garrison University`: authenticated endpoint resolved; display spelling corrected.
- `Gulberg 3 → LGU`: live resolver resolved through the full-name alias.
- `North Nazimabad → Gulshan-e-Hameed Phase 2`: live resolver resolved.
- `Saddar → airport`: remains ambiguous and asks for targeted clarification.
- Unrelated POI rejection: passed.
- No fabricated coordinates, routes, fares, availability, or ETAs: passed.

Focused automated results:

- Trip extraction/resolution: 9 passed.
- Authenticated AI endpoint regression: passed.
- Geoapify service tests: 16 passed.
- Mobile route/location regressions: previously 18 passed.
- Dataset and fare regression suites remain green in isolated single-process runs.

The known Windows `spawn EPERM` issue remains when Node runs tests in parallel or when unrelated database suites share one process. The supported isolated single-process runs passed.

## Accepted limitations

1. Area-level routes are approximate map estimates, not exact pickup points.
2. Geoapify candidate ordering and availability can vary. If the city-scoped fallback does not produce a strong candidate, Fair Fare must ask for one targeted clarification rather than force a route.
3. No provider fare or availability is claimed; dataset mode remains `legacy` and coverage approvals remain zero.

No commit, push, deployment, production configuration change, migration, or coverage activation was performed.
