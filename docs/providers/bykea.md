# Bykea integration configuration

Bykea is registered internally as `urbancab` so existing database and fare
comparison contracts remain unchanged. The provider is fail-closed: it does
not call a live service unless an authorized request contract is implemented
and injected into `createBykeaHttpTransport`.

## Environment configuration

Place these values in the backend `.env` file for local development, or in the
server deployment's secret/environment configuration. Do not place them in the
frontend or mobile repositories.

| Variable | Purpose | Authorized source | Example placeholder | Required |
| --- | --- | --- | --- | --- |
| `BYKEA_MODE` | Requested provider mode | FairFare deployment configuration | `authorized_live` | Yes |
| `BYKEA_AUTHORIZED_LIVE` | Explicit live authorization gate | FairFare deployment approval | `false` | Yes |
| `BYKEA_API_BASE_URL` | HTTPS API origin | Bykea partner/API documentation | `https://api.example.invalid` | For live mode |
| `BYKEA_FARE_ENDPOINT` | Fare-estimation path | Bykea-authorized API documentation | `/talos/api/v3/users/estimation/fare` | For live mode |
| `BYKEA_DEVICE_ID` | Registered server-side device identity sent as `device_id` | Bykea authorization handoff | `<BYKEA_DEVICE_ID>` | For live mode |
| `BYKEA_APP_USER_ID` | Authorized app user identity for the header contract | Bykea authorization handoff | `<BYKEA_APP_USER_ID>` | For live mode |
| `BYKEA_APP_USER_TOKEN` | Authorized app user token passed only to the injected header builder | Bykea authorization handoff | `<BYKEA_APP_USER_TOKEN>` | For live mode |
| `BYKEA_APP_VERSION` | Registered application version, if required by the contract | Bykea authorization handoff | `<BYKEA_APP_VERSION>` | Contract-dependent |
| `BYKEA_APP_LANGUAGE` | Application language | Bykea contract | `en` | Optional |
| `BYKEA_APP_USER_TYPE` | Required app user type header | Bykea server-side contract | `passenger` | For live mode |
| `BYKEA_HEADER_LATITUDE` | Registered-device location header latitude | Authorized registered-device source | `<latitude>` | For live mode |
| `BYKEA_HEADER_LONGITUDE` | Registered-device location header longitude | Authorized registered-device source | `<longitude>` | For live mode |
| `BYKEA_HEADER_ALTITUDE` | Registered-device altitude header | Authorized registered-device source | `<altitude>` | For live mode |
| `BYKEA_USER_AGENT` | Required Bykea client identity header | Bykea server-side contract | `<BYKEA_USER_AGENT>` | For live mode |
| `BYKEA_SERVICE_CODES` | Comma-separated configuration values serialized as a JSON array in the query | Bykea fare contract | `23,70,44,45,48` | For live mode |
| `BYKEA_REQUEST_TYPE` | Contract-defined `type` query value | Bykea fare contract | `<BYKEA_REQUEST_TYPE>` | For live mode |
| `BYKEA_VEHICLE_TYPE` | Contract-defined `v_type` query value | Bykea fare contract | `<BYKEA_VEHICLE_TYPE>` | For live mode |
| `BYKEA_CURRENCY` | Currency expected by the contract | Bykea contract or deployment policy | `PKR` | Optional |
| `BYKEA_CURRENCY_MULTIPLIER` | Converts provider minor units to major units | Bykea response documentation | `1` | Optional |
| `BYKEA_REQUEST_TIMEOUT_MS` | Per-request timeout | FairFare operational policy | `10000` | Optional |

The fare endpoint and query shape are implemented. The normal comparison flow
uses the same explicit request contract as the guarded local diagnostic. The
contract supplies the documented user, device-location, app, and client
identity headers; it does not invent trace/signing/session-refresh behavior or
reproduce undocumented transport headers. The Bykea adapter normalizes its
top-level `data` entries using `mstr`.

Device-location headers are independent from the trip query coordinates. The
configured device location is validated as latitude/longitude plus numeric
altitude; it is not replaced with the user's pickup location. If Bykea requires
fresh device GPS rather than configured coordinates, a live location provider
must be supplied before enabling authorized-live mode.

## Values that must not be copied

Do not copy consumer-app access tokens, refresh tokens, cookies, device IDs,
user IDs, app fingerprints, captured headers, or private mobile-app endpoints
into these variables. A consumer session is not evidence of an authorized
server API contract.

## Request and response seam

`buildFareQuery()` produces the dynamic query plus configured identity values:

```json
{
  "s_lat": 31.4742,
  "s_lng": 74.4163,
  "e_lat": 31.5204,
  "e_lng": 74.3587,
  "device_id": "<BYKEA_DEVICE_ID>",
  "type": "<BYKEA_REQUEST_TYPE>",
  "v_type": "<BYKEA_VEHICLE_TYPE>",
  "service_codes": "[23,70,44,45,48]"
}
```

The transport validates coordinate ranges for every request. Category mapping
is response-driven; undocumented numeric service codes are not translated.
The existing adapter normalizes category, fare, optional fare range, currency,
ETA, availability, and expiry into FairFare's fare contract.
