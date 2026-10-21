# inDrive pricing contract review

Reviewed source: `D:\ride\inDrive-Developer-Implementation-Guide.html`.

## Documented request shape

The HTML documents the pricing request as:

```json
{
  "order_type_ids": [2, 33, 31, 29, 11],
  "route": ["pickup", "destination"],
  "geo": {
    "distance_meters": "from waypoints",
    "duration_seconds": "from waypoints",
    "toll_cost": 0.0,
    "points": []
  }
}
```

The route entries are described as coordinates in the preceding waypoint section (`lat`/`lng`). The pure mapper in `src/providers/indrive-pricing.contract.js` emits that coordinate shape and validates coordinate/routing values.

The five numeric ride-type IDs are the only categories explicitly documented in the HTML. The HTML does not name or describe those categories. The names currently used by FairFare (Moto, Mini, Rickshaw, Ride AC, Premium) are application-side metadata and are not claimed as documented inDrive labels.

## Missing or contradictory response contract

The HTML does not provide a pricing response example or define:

- required fare, category, or price-type response fields;
- whether amounts are major or minor currency units;
- a PKR currency multiplier;
- a quote TTL or expiry field;
- minimum/maximum fare field names;
- the response envelope or whether prices are fixed, suggested, or negotiable.

Therefore the sanitized response fixtures and the `currencyMultiplier: 100` test option are explicit integration assumptions only. They must be replaced or confirmed by an authorized provider contract before live pricing is enabled. No captured credentials, device data, OTPs, or personal information are used.

## FairFare comparison

FairFare's normalized `getFareEstimates()` shape requires provider status/source/currency and estimate entries with a positive fare, category identity, price type, timestamps, and optional range fields. The normalizer preserves `fareMin`/`fareMax` when supplied, rejects missing/invalid amounts and expired responses, and keeps unavailable providers from producing fallback live fares.

Only the inDrive adapter's explicit authorized-live transport may return live pricing. The default configuration remains unavailable/simulation-only; Yango and Bykea remain unavailable unless a separately authorized transport is intentionally configured.

No second inDrive HTML/API documentation file was found in the project tree.
