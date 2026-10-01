# inDrive Provider Research

## Purpose

This is an independently observed integration/research contract for Fair Fare.
It is not an official inDrive SDK or API specification, and it does not claim
permission, partnership, or provider endorsement.

## Evidence Status

- **VERIFIED** — directly observed in current captures.
- **HISTORICAL** — observed in an older capture and retained for compatibility;
  the current response contract is not reconfirmed.
- **PARTIALLY VERIFIED** — some semantics are established, but stronger claims
  require more evidence.
- **UNKNOWN** — not guessed or inferred here.
- **SECURITY-OPAQUE** — provider security/device state that Fair Fare does not
  manufacture.

## Architecture

```text
Fair Fare Backend -> Provider Orchestrator -> inDrive Adapter -> normalized Fair Fare quote
```

## Pricing Endpoint

**VERIFIED** current pricing endpoint:

```text
POST https://api-gw-cf.sa.apse1.aws.indriverapp.com/recprice-gateway-backend/api/pricing/v5/price
```

Authentication is `Authorization: Bearer <access-token>`. Observed request
context includes `Referer: order_form`, a fresh `X-Local-Req-Id`, locale/OS/app
headers, opaque fingerprint headers, content type, and user agent. Observed does
not prove every header is mandatory; request IDs are generated per request.

Sanitized single-category request example:

```json
{
  "order_type_id": 2,
  "route": [
    { "latitude": 31.5000, "longitude": 74.3000 },
    { "latitude": 31.6000, "longitude": 74.4000 }
  ],
  "geo": {
    "distance_meters": 19124,
    "duration_seconds": 2178,
    "toll_cost": 0.0,
    "provider": "",
    "points": []
  }
}
```

Coordinates and route values are request inputs, not constants from a capture.

## Pricing Response

Both shapes below are **VERIFIED** observations, represented with synthetic
dynamic values.

Single-category shape:

```json
{
  "autofill_price": { "currency": { "code": "PKR", "multiplier": 100, "symbol": "PKR" }, "value": 10900 },
  "city_id": 123,
  "created_at": "synthetic-timestamp",
  "debug_id": "synthetic-debug-id",
  "id": "synthetic-quote-id",
  "order_type_id": 2,
  "price": { "currency": { "code": "PKR", "multiplier": 100, "symbol": "PKR" }, "value": 11000 },
  "price_max": { "currency": { "code": "PKR", "multiplier": 100, "symbol": "PKR" }, "value": 12000 },
  "price_min": { "currency": { "code": "PKR", "multiplier": 100, "symbol": "PKR" }, "value": 10000 },
  "rush_hour": { "is_rush": false, "labels": {} },
  "text": "synthetic text",
  "ttl": 300
}
```

Multi-category shape:

```json
{
  "calculations": [
    {
      "autofill_price": 10900,
      "id": "synthetic-calculation-id",
      "is_rush": false,
      "order_type_id": 33,
      "price": 11000,
      "price_max": 12000,
      "price_min": 10000,
      "price_steps": { "delta_up": 100, "values": [10000, 11000, 12000] }
    }
  ],
  "city_id": 123,
  "created_at": "synthetic-timestamp",
  "currency": { "code": "PKR", "multiplier": 100, "symbol": "PKR" },
  "debug_id": "synthetic-debug-id",
  "route": [],
  "texts": {},
  "ttl": 300
}
```

## Currency

Provider integer monetary values are normalized as `value / multiplier`. For
example, `10900` with multiplier `100` is `PKR 109`. The adapter uses the
response multiplier only when it is positive and finite; missing or invalid
multipliers produce an unavailable monetary value rather than a guessed amount.

## Categories

| order_type_id | provider category | Fair Fare vehicle type |
|---:|---|---|
| 2 | Moto | BIKE |
| 33 | Mini | ECONOMY_CAR |
| 31 | Rickshaw | RICKSHAW |
| 29 | Ride AC | STANDARD_CAR |
| 11 | Premium | PREMIUM_CAR |

Unknown future IDs remain available as raw provider category IDs with
`vehicleType: UNKNOWN` and no guessed name.

## Fare Semantics

The provider `autofill_price` is the current recommended/comparison fare.
`price`, `price_min`, and `price_max` are preserved separately. `price_steps`
is provider adjustment metadata. The latter fields are not described as a
conventional predicted fare range. Fair Fare's ML Expected Fare never replaces
the provider's current/recommended fare. Pickup ETA is null unless genuinely
provided by an established source.

The observed `ttl` of `300` seconds is retained as provider TTL metadata. Its
stronger validity guarantees are **UNKNOWN**.

## Session Authentication

Current pricing/profile captures use backend-held `Authorization: Bearer
<access-token>` credentials. Fair Fare persists provider session state on the
backend, refreshes before expiry, uses single-flight refresh, and performs one
forced refresh/retry after a pricing 401. Credentials are never sent to the
mobile client or stored in fare observations.

The following renewal endpoint is **VERIFIED** in a current successful renewal
capture:

```text
POST https://ath-gw-cf.euce1.indriverapp.com/api/auth/v1/token/renew
```

The request body is **VERIFIED** as:

```json
{
  "refresh_token": "<synthetic-refresh-token>"
}
```

The successful HTTP 200 response fields below are **VERIFIED**:

```json
{
  "access_token": "<synthetic-access-token>",
  "expires_in": 10800,
  "refresh_token": "<synthetic-rotated-refresh-token>"
}
```

The returned refresh token differed from the request refresh token in this
capture, so refresh-token rotation is **VERIFIED**. Fair Fare converts
`expires_in` seconds to the BIGINT millisecond `access_expires_at` convention
used by `provider_sessions`, and persists the access token, expiry, and returned
refresh token together. A returned refresh token replaces the previous stored
refresh token.

The official client also sent `X-Device-Fingerprint` and `X-Fingerprint` on
this renewal request. Their presence is **VERIFIED**; whether either header is
strictly mandatory remains **PARTIALLY VERIFIED / UNKNOWN**. Fair Fare does not
generate, spoof, reverse-engineer, or bypass these values.

## Profile Endpoint

**VERIFIED** observed authenticated endpoint:

```text
GET https://api-gw-cf.sa.apse1.aws.indriverapp.com/profile-api/api/profile-api/v1/profile?latitude=<lat>&longitude=<lng>
```

It demonstrates that the captured Bearer credential authorizes an authenticated
request. Profile lookup is not part of fare comparison and profile PII is not
persisted in fare observations.

## Device Security

The official client uses **SECURITY-OPAQUE** device/fingerprint security
context, including opaque fingerprint headers and a fingerprint service. Fair
Fare does not generate, spoof, reverse-engineer, or bypass fingerprints,
CAPTCHA, attestation, anti-abuse controls, or signatures. No captured device
payloads or identifiers are published here.

## Data Handling

Access/refresh credentials, cookies, fingerprints, device identifiers, account
or profile identifiers, phone numbers, and security headers are excluded from
normalized outputs and recursively sanitized raw observations. Tests and docs
use synthetic placeholders only.

## Known Unknowns

- failure response contract for invalid or expired refresh credentials;
- whether device fingerprint headers are strictly mandatory;
- pickup ETA source;
- stronger semantics of TTL;
- future/new `order_type_id` values.

## Example Normalized Quote

```json
{
  "provider": "inDrive",
  "providerCategoryId": "2",
  "providerCategoryName": "Moto",
  "vehicleType": "BIKE",
  "fare": 109,
  "currency": "PKR",
  "availability": true,
  "pickupEtaSeconds": null,
  "providerMetadata": { "providerTtlSeconds": 300, "isRush": false },
  "dataSource": "REAL"
}
```

## Change Log / Evidence Log

| date | finding | status |
|---|---|---|
| 2026-09-30 | Pricing v5 request and response shapes verified | VERIFIED |
| 2026-09-30 | Category IDs 2, 33, 31, 29, and 11 mapped from captures/UI ordering | VERIFIED |
| 2026-09-30 | Money multiplier, recommended fare, rush state, TTL, and price steps reconciled | VERIFIED |
| 2026-10-01 | Renewal endpoint, request body, successful response fields, and refresh-token rotation verified from a current successful capture | VERIFIED |
| 2026-10-01 | Device fingerprint headers observed on renewal; strict necessity and invalid/expired-credential failures remain unestablished | PARTIAL / UNKNOWN |
