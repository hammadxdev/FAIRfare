# Scenario 2 Geoapify Diagnostics

Local, non-production Geoapify verification for `Gulberg III to Lahore Garrison University`.
The snapshot records names and administrative metadata only; API keys and exact user addresses are not included.

## Initial candidate searches

| Query | Candidate display name | Administrative city | District/county | Location type | Confidence | Match score | Result |
|---|---|---|---|---|---:|---:|---|
| `Gulberg III, Lahore` | Asif Computers | Lahore | Lahore District | amenity / commercial.shopping_mall | 0 | not accepted | Unrelated POI; query text appeared only in the address. |
| `Gulberg III, Lahore` | IT Tower | Lahore | Lahore District | amenity / commercial.shopping_mall | 0 | not accepted | Unrelated POI; query text appeared only in the address. |
| `Gulberg III, Lahore` | ASKARI CORPORATE TOWER | Lahore | Lahore District | amenity / building.commercial | 0 | not accepted | Unrelated building/POI; no trustworthy area-name match. |
| `Gulberg III, Lahore` | Lahore | Lahore | Lahore | city | 0.5 | 779 | Rejected for low query coverage; city fallback is too broad. |
| `Gulberg III, Lahore` | Sheikhupura | — | Sheikhupura | county | 0 | not accepted | Wrong administrative context. |
| `Gulberg 3, Lahore` | Gulberg 3 | Model Town Tehsil | Lahore District | street | 0.9 | 865 | Accepted area-level candidate; approximate. Equivalent duplicate street results were treated as one area match. |
| `Gulberg 3, Lahore` | Gulberg 3 | Amar Sidhu | Lahore District | street | 0.9 | 863 | Candidate in the same district; retained as an ambiguity input, not a different-city match. |
| `Lahore Garrison University` | Lahore Garrison University (provider spelling: `Garission`) | Lahore | Lahore District | amenity / education.university | 0.6667 | 669 after typo normalization | Accepted exact university identity after `Garission` spelling normalization and city preference. |
| `Lahore Garrison University` | Lahore Garrison University (provider spelling: `Garission`) | Lidher | Lahore District | amenity / education.university | 0.6667 | lower than Lahore candidate | Same university identity but less preferred city metadata; not selected. |
| `Lahore Garrison University` | LUMS | Defense | Lahore District | amenity / education.university | 0 | not accepted | Different university. |
| `Lahore Garrison University` | Lahore College for Women University | Model Town Tehsil | Lahore District | amenity / education.university | 0 | not accepted | Different university. |
| `LGU, Lahore` | Lahore Grammar School For Boys (LGS JT) | Lahore | Lahore District | amenity / education.college | 0 | not accepted | Acronym search returned an unrelated school. |
| `LGU, Lahore` | LGS International | Lahore | Lahore District | amenity / school | 0 | not accepted | Unrelated school. |
| `LGU, Lahore` | LGS Shalimar Branch | Lahore | Lahore District | amenity / school | 0 | not accepted | Unrelated school. |

`Gulberg III` therefore does not accept the first returned POI. When that query is unresolved, the resolver tries the explicit spelling alias `Gulberg 3` with the city context supplied by the destination, producing the accepted street/area match. `LGU` is handled similarly: its initial results are rejected, then the full-name alias `Lahore Garrison University` is queried.

## Final selected evidence

The live resolver selected:

| Endpoint | Selected display name | City/district context | Type | Approximate | Evidence basis |
|---|---|---|---|---|---|
| Pickup | Gulberg 3 | Model Town Tehsil / Lahore District | street | Yes | High-confidence Geoapify area-name match after spelling and city-context fallback. |
| Destination | Lahore Garrison University | Lahore / Lahore District | amenity / education.university | No | City-matched university candidate; provider spelling `Garission` is normalized for matching and user display. |

The live routing request then returned a valid Geoapify road geometry with endpoint snaps of approximately 0.02 m and 41.84 m in the final run. The route is an estimate from the selected map points, not a live provider quote.

## Safety decisions

- Area-like queries require a place-like result type such as street, locality, suburb, town, or city. A building or commercial POI is not accepted merely because the address contains `Gulberg`.
- University/landmark POIs may be accepted only when the candidate name itself matches the requested identity, including the bounded spelling correction above, and administrative city preference is satisfied.
- `Lahore` and `Lahore District` are treated as compatible administrative labels; unrelated districts remain cross-city.
- No coordinates were hardcoded or invented. All selected coordinates came from the live Geoapify response.
