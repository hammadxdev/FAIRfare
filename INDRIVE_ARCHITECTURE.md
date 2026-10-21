# Fair Fare inDrive provider architecture

This integration is mock-only. It uses sanitized fixtures and never replays captured private consumer traffic, OTPs, fingerprints, signatures, or tokens.

## Files and configuration

`src/providers/indrive-architecture.js` exposes normalized suggestions, route, fare, nearby-driver, provider-status, and provider-session operations. The provider registry, provider controller, provider routes, mobile API client, and Home screen use existing Fair Fare seams. `src/tests/indriveArchitecture.test.js` contains offline lifecycle and normalization tests.

`INDRIVE_REGION`, `INDRIVE_CURRENCY`, `INDRIVE_CURRENCY_MULTIPLIER`, `INDRIVE_REQUEST_TIMEOUT_MS`, and `INDRIVE_REFRESH_BUFFER_SECONDS` are nonsecret configuration values. Live transport is disabled by design. Provider sessions are independent from Fair Fare user sessions and support access-token lookup, expiry-buffer checks, single-flight refresh, rotated credential replacement, clearing, status inspection, and reauthentication-required state. Production storage must provide secure server-side persistence and compare-and-swap/version protection.

## Normalized endpoints

- `GET /api/providers/indrive/suggestions?text=...&latitude=...&longitude=...`
- `POST /api/providers/indrive/route`
- `POST /api/providers/indrive/fares`
- `GET /api/providers/indrive/drivers?latitude=...&longitude=...`
- `GET /api/providers/indrive/status`

Existing `/api/maps/*` and `/api/fares/compare` contracts remain intact. Geoapify remains the primary location/routing provider. Mobile uses the inDrive mock suggestion endpoint only as an explicitly labeled fallback when primary search returns no results.

Supported statuses are `available`, `no_drivers`, `busy`, `timeout`, `auth_error`, `unavailable`, `invalid_request`, and `provider_error`. An empty mock driver list is `unavailable`, never `no_drivers`, because no live provider signal was received.

## Tests

```text
node src/tests/indriveArchitecture.test.js
node src/tests/indrive.test.js
```

These are offline tests only. They do not prove live provider access or authorization. Live transport requires an authorized provider contract, approved credentials, documented rate limits, secure secret storage, and explicit approval. The captured HTML is not an official API specification.
