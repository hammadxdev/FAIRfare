# Fair Fare — synthetic dataset v1 (13 October 2026)

**30,000 synthetic scenario rows. NOT real inDrive/Yango/Bykea prices, routes, availability, traffic, or historical observations.**

Files:
- `cities.csv`: 21 initial city/locality names; geographic status provisional. Some entries (Raiwind, Wah, Taxila) may need parent-city normalization.
- `provider_city_coverage.csv`: 63 city-provider records; previously discussed published-listing claims have NOT been independently reverified here. `production_enabled=false` for every record. `unverified` does NOT mean unavailable.
- `vehicle_pricing_parameters.csv`: four illustrative baseline vehicles; **not actual provider tariffs**.
- `time_rules.csv`: 168 synthetic day/hour patterns, not measured demand.
- `weather_rules.csv`: five illustrative weather categories; no live weather feed.
- `event_rules.csv`: six policy rules; no current protests/closures asserted and no arbitrary event surcharges.
- `synthetic_fare_scenarios.csv`: 30,000 simulated records, seeded reproducibly. All `production_eligible=false`, vehicle coverage unverified. Route IDs are synthetic and are NOT real POIs or Geoapify routes.
- `assistant_context_example.json`: safe example of context retrieval; do not inject all 30k rows into an LLM prompt.

## Synthetic formula
`fare = round(max(minimum, base + distance_km * per_km + duration_min * per_minute) * peak_multiplier * weather_multiplier + conditional_popular_zone_adjustment)`
Uncertainty illustration: `max(15 PKR, 8% of fare)`; **not a statistically validated confidence interval**. Synthetic route duration already varies and can correlate with traffic; do not add further congestion surcharges without calibration.

## Production gates
1. Independently verify provider × city × vehicle coverage with sources and timestamps. Enable ONLY supported verified combinations.
2. Obtain real Geoapify road distances/durations for user-selected locations; resolve ambiguity and intercity eligibility.
3. Collect timestamped, consent-compliant provider-app quotations, then calibrate pricing per city/provider/vehicle.
4. Keep synthetic and observed data strictly separate; evaluate MAE/MAPE and error distribution by city/vehicle.
5. Use a deterministic backend fare engine and give the assistant only the filtered grounded comparison context.
6. Do not advertise any generated figure as a live provider quote, driver ETA, active road closure, or guaranteed future fare.

Dataset is intended for prototyping, algorithm tests and UI demos, not for live price claims.
