# Lahore transit planning API

`POST /api/transit/plan` returns only verified transit data currently present in the Lahore dataset.

Request:

```json
{
  "origin": { "name": "Gajjumata", "lat": 31.42, "lng": 74.32 },
  "destination": { "name": "Shahdara", "lat": 31.62, "lng": 74.29 }
}
```

The response includes `status`, `plans`, `source`, official fare data, operating hours, and explicit warnings. `INSUFFICIENT_VERIFIED_COVERAGE` is a valid result: callers must show the limitation instead of presenting a guessed route. Community reports will be added as a separate, non-authoritative source layer and must never overwrite official values.
