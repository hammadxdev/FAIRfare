# FairFare Backend

Backend API for **FairFare**, a React Native app that compares ride fares across
multiple providers. It supports simulated providers and an authorized inDrive
integration using backend-only session credentials.
It's built with a provider-adapter architecture so real APIs can be swapped in
later without touching the routes/controllers/services layer.

## Tech Stack

- Node.js + Express
- PostgreSQL via `pg` for production (Supabase Transaction Pooler)
- SQLite via `better-sqlite3` remains local/test-only during the migration
- CORS, dotenv
- Node's built-in test runner (`node --test`) + `supertest`
- JWT authentication with rotating refresh sessions
- User-owned comparison history and private preferences
- AI Chat remains a navigation placeholder; provider booking/recommendation flows are not implemented

## Folder Structure

```
backend/
  src/
    app.js                 # express app wiring (middleware, routes)
    server.js               # entrypoint, starts the HTTP server

    config/
      database.js            # better-sqlite3 connection singleton

    db/
      schema.sql              # table definitions
      migrate.js               # applies schema.sql
      seed.js                   # inserts providers + vehicle rates

    routes/                     # thin HTTP -> controller mappings
      health.routes.js
      provider.routes.js
      fare.routes.js
      map.routes.js

    controllers/                 # request parsing / response shaping
      fare.controller.js
      provider.controller.js
      map.controller.js

    services/                     # business logic, framework-agnostic
      distance.service.js           # haversine distance + duration (fallback)
      fare.service.js                 # orchestrates providers, persists results
      recommendation.service.js         # fare comparison badges
      rideRecommendation.service.js     # ML expected-fare Book/Wait status
      personalizedRideRecommendation.service.js # user-specific quote ranking
      googleMaps.service.js             # raw Google Maps Platform HTTP calls
      cache.service.js                    # in-memory TTL cache (autocomplete/details/geocode/route)
      mapUsage.service.js                   # daily Google request counters + limit
      polyline.service.js                     # decodes Google encoded polylines

    providers/                          # one adapter per ride provider
      formula.js                          # shared pure fare formula
      indrive/                            # session, client, mapper, adapter, errors
      quickride.provider.js
      urbancab.provider.js
      provider.registry.js                  # name -> adapter lookup

    middlewares/
      error.middleware.js
      notFound.middleware.js
      mapRateLimit.middleware.js

    utils/
      apiResponse.js
      asyncHandler.js
      validators.js
      AppError.js

    tests/
      setup.js                # isolated test DB + migrate/seed before tests
      health.test.js
      fare.test.js
      map.test.js              # Google service is mocked, never calls real APIs

  .env.example
  package.json
  README.md
```

## Provider-Adapter Architecture (for future real APIs)

Each file in `src/providers/` exports the same shape:

```js
{
  name: "ridego",
  getFareQuote({ rate, distanceKm, durationMin }) -> { finalFare, breakdown },
  getPickupEtaMin(vehicleType) -> number,
}
```

`fare.service.js` only talks to `provider.registry.js`, never to a specific
provider file. To integrate a real provider later:

1. Create `src/providers/<name>.provider.js` implementing the same interface,
   calling the real API instead of `formula.js`.
2. Register it in `provider.registry.js`.
3. No changes needed in routes, controllers, or services.

## Fare Formula (simulated)

```
fare = (baseFare + distanceKm * perKmRate + durationMin * perMinRate) * surgeMultiplier
finalFare = round(max(fare, minimumFare))
```

## Distance / Duration (simulated, no external maps API)

```
straightLineKm = haversine(pickup, dropoff)
roadDistanceKm = straightLineKm * 1.3
durationMin = (roadDistanceKm / averageSpeedKmh) * 60
```

Average speeds: bike 24 km/h, rickshaw 20 km/h, mini 26 km/h, car 28 km/h.

## Recommendation Logic

```
normalizedFare = fare / highestFare
normalizedEta   = etaMin / highestEta
score = normalizedFare * 0.7 + normalizedEta * 0.3
```

Lowest fare → `isCheapest`. Lowest ETA → `isFastest`. Lowest score → `isRecommended`.
Badges (`Cheapest`, `Fastest`, `Recommended`) are attached automatically. Results
are always returned sorted by ascending fare.

### Three separate recommendation concepts

Fair Fare keeps these concepts separate:

- **Personalized Recommendation** selects the current quote that best matches
  the authenticated user's configured vehicle, avoided-vehicle, budget, and
  priority preferences. It is calculated fresh for each comparison and is not
  stored in history.
- **Book/Wait** (`rideRecommendation.service.js`) compares a quote's current
  fare with its model expected fare and returns `BOOK_NOW`, `WAIT`, `NEUTRAL`,
  or `INSUFFICIENT_DATA`.
- **ML Prediction** estimates fare from global eligible fare observations and
  trip/provider conditions. User IDs and user preferences are not ML features.

Personalized ranking uses normalized fare and pickup ETA scores within the
current comparison set. Product-rule weights are centralized in
`personalizedRideRecommendation.service.js`: `CHEAPEST` is fare-heavy,
`FASTEST_PICKUP` is ETA-heavy, and `BALANCED` combines fare, ETA, preferred
vehicle, and budget fit. These prototype weights are deterministic rules, not
scientifically optimized values.

Avoided vehicles remain visible in normal fare comparison and keep their
provider launch action, but receive `eligible: false` and cannot be the top
personalized recommendation. Invalid fares also cannot win. A typical budget
sets `withinBudget` and `budgetDifference` (`budget - fare`); over-budget quotes
are not hidden. Missing ETA is never treated as zero: its dimension is ignored
for that quote and its weight is redistributed deterministically. If all ETA
values are missing, the ETA weight is redistributed for every eligible quote.

Exactly one eligible quote is marked `isTopRecommendation` when possible.
Ties are resolved by score, lower fare, lower available ETA, then stable
provider/category identifier. If all quotes are avoided or have invalid fares,
there is no personalized winner while normal results remain available.

## Database

Production migration status: the repository is being converted from the
legacy synchronous SQLite access pattern to an async PostgreSQL repository.
Production Vercel deployments must provide `DATABASE_URL`; they must not use
`/tmp/fairfair.sqlite`. The additive compatibility SQL is in
`src/db/migrations/001_supabase_compatibility.sql` and must be reviewed against
the already-created Supabase schema before execution.

SQLite file lives at `DB_PATH` (default `./data/fairfair.sqlite`), created
automatically on first migration.

Tables: `users`, `user_sessions`, `user_preferences`, `saved_routes`,
`comparison_history`, `comparison_history_quotes`, `providers`, `vehicle_rates`,
`fare_searches`, `fare_results`, `provider_sessions`, `fare_observations`.
Saved Routes are private, user-owned pickup/destination shortcuts and do not
store fares; History remains the immutable record of completed comparisons.
(see `src/db/schema.sql`). Every `/api/fares/compare` call persists a search
row and one result row per provider.

## Install & Run

```bash
cd backend
npm install
cp .env.example .env

npm run migrate   # creates tables
npm run seed      # inserts 3 providers + rates for bike/rickshaw/mini/car

npm run dev        # http://localhost:4000 (nodemon)
# or
npm start
```

## Run Tests

```bash
npm test
```

Tests run against an isolated SQLite file (`data/test.sqlite`), migrated and
seeded automatically via `src/tests/setup.js`. Covers: health check, providers
list, valid fare comparison (3 results), fare-ascending sort order, cheapest
flag correctness, invalid vehicle type validation, missing pickup/dropoff
validation, fare comparison with/without a `route` override, and all 4 map
endpoints (validation, normalization, and the missing-API-key error path) —
see `src/tests/map.test.js`, which mocks `googleMaps.service.js` and never
calls real Google APIs.

## API Endpoints

### Saved Routes

Authenticated clients can use `GET/POST /api/saved-routes` and
`GET/PUT/DELETE /api/saved-routes/:id`. Ownership always comes from the access
token user, never a client-supplied user ID. A Saved Route stores normalized
location names/addresses and coordinates only. Comparing one always calls the
normal fresh fare comparison flow; it never treats a saved or historical fare
as current.

### `GET /api/health`

```bash
curl http://localhost:4000/api/health
```

### `GET /api/providers`

```bash
curl http://localhost:4000/api/providers
```

### `POST /api/fares/compare`

```bash
curl -X POST http://localhost:4000/api/fares/compare \
  -H "Content-Type: application/json" \
  -d '{
    "pickup": { "name": "University Road, Sialkot", "lat": 32.4945, "lng": 74.5229 },
    "dropoff": { "name": "Sialkot Cantt", "lat": 32.5201, "lng": 74.5600 },
    "vehicleType": "bike"
  }'
```

`vehicleType` must be one of: `bike`, `rickshaw`, `mini`, `car`.

Validation error example:

```bash
curl -X POST http://localhost:4000/api/fares/compare \
  -H "Content-Type: application/json" \
  -d '{ "vehicleType": "helicopter" }'
```

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": ["pickup is required", "dropoff is required", "vehicleType must be one of: bike, rickshaw, mini, car"]
}
```

`POST /api/fares/compare` also accepts an optional `route` field — when the
frontend already has a real Google route (from `POST /api/maps/route`), pass
its distance/duration through so the fare estimate uses the real road
distance instead of the haversine fallback:

```bash
curl -X POST http://localhost:4000/api/fares/compare \
  -H "Content-Type: application/json" \
  -d '{
    "pickup": { "name": "University Road, Sialkot", "lat": 32.4945, "lng": 74.5229 },
    "dropoff": { "name": "Sialkot Cantt", "lat": 32.5201, "lng": 74.5600 },
    "vehicleType": "bike",
    "route": { "distanceKm": 6.8, "durationMin": 18 }
  }'
```

If `route` is omitted, the endpoint behaves exactly as before (haversine
estimate). If `route` is present, both `distanceKm` and `durationMin` must be
positive numbers or the request fails validation.

## Active Geoapify Maps Setup

Fair Fare V1 uses Geoapify for autocomplete, place details, reverse geocoding,
and road routing. Set `MAPS_PROVIDER=geoapify` and `GEOAPIFY_API_KEY` in the
backend environment; the key never ships to mobile. The legacy Google section
below is retained as parked historical setup only and is not used by the
normal runtime.

## Legacy Google Maps Setup

The map module (`/api/maps/*`) proxies four Google Maps Platform APIs so the
API key **never** ships to the frontend. In [Google Cloud Console](https://console.cloud.google.com/):

1. Create/select a project and enable these APIs:
   - **Places API** (autocomplete + place details)
   - **Geocoding API** (reverse geocoding)
   - **Routes API** (compute routes / polyline)
2. Create an API key under **APIs & Services → Credentials**.
3. **Restrict the key** (APIs & Services → Credentials → your key):
   - **Application restrictions:** "IP addresses" and list your server's IP
     (or your dev machine's public IP while testing). Never use "None" in
     production.
   - **API restrictions:** limit to exactly the 3 APIs above — this key is
     only ever called from this backend, never from the mobile app, so there
     is no need for Android/iOS app restrictions on this key.
4. Put the key in `backend/.env`:
   ```env
   GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
   GOOGLE_MAPS_DAILY_REQUEST_LIMIT=500
   GOOGLE_MAPS_ENABLE_CACHE=true
   ```

If `GOOGLE_MAPS_API_KEY` is missing or left as the placeholder value, every
map endpoint returns a clear `500` error instead of crashing:

```json
{ "success": false, "message": "Google Maps API key is missing. Set GOOGLE_MAPS_API_KEY in backend/.env to enable map features." }
```

### Billing / quota safety

- **Debounce + 3-char minimum** — the frontend waits for 500ms of no typing
  and at least 3 characters before calling `/autocomplete`; the backend
  re-validates the 3-char minimum itself (returns `{ success: true, data: [] }`
  below that, no Google call at all).
- **Session tokens** — one Places session token per search session, reused
  across `/autocomplete` → `/place-details`, then reset by the frontend after
  selection. This groups a whole search into one billing session instead of
  billing every keystroke.
- **In-memory caching** (`cache.service.js`, disable with
  `GOOGLE_MAPS_ENABLE_CACHE=false`) — autocomplete results cached by
  input+sessionToken (2 min TTL), place details by placeId (30 min), reverse
  geocode by rounded lat/lng (30 min), routes by origin+destination+vehicleType
  (10 min). Cache hits never call Google and never count against the daily
  limit.
- **Daily request limit** (`mapUsage.service.js`, `GOOGLE_MAPS_DAILY_REQUEST_LIMIT`)
  — counts real Google calls (not cache hits) across all 4 endpoints. Once the
  limit is hit, every map endpoint returns:
  ```json
  { "success": false, "message": "Daily Google Maps request limit reached for demo safety." }
  ```
- **Rate limiting** (`mapRateLimit.middleware.js`) — a simple per-IP window
  limiter (60 requests/min) on all `/api/maps/*` routes, independent of the
  daily Google quota, to blunt any buggy/rapid client loop.
- **Request logging** — every `/api/maps/*` call logs the endpoint, key
  params, and whether it was served from cache (`console.log("[maps] ...")`).

### Map Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/maps/autocomplete?input=&sessionToken=` | Places Autocomplete (min 3 chars) |
| GET | `/api/maps/place-details?placeId=&sessionToken=` | Place Details (name/address/lat/lng) |
| GET | `/api/maps/reverse-geocode?lat=&lng=` | Reverse Geocoding for a tapped map point |
| POST | `/api/maps/route` | Routes API — distance/duration/decoded polyline |
| GET | `/api/maps/usage` | Current usage counters vs. `dailyLimit` |

`POST /api/maps/route` body:

```json
{
  "origin": { "lat": 32.4945, "lng": 74.5229 },
  "destination": { "lat": 32.5201, "lng": 74.5600 },
  "vehicleType": "bike"
}
```

`vehicleType` maps to Google's travel mode: `car`/`mini`/`rickshaw` → `DRIVE`,
`bike` → `TWO_WHEELER` (falls back to `DRIVE` automatically if `TWO_WHEELER`
isn't supported for that region/route).

### Testing the map endpoints

```bash
curl "http://localhost:4000/api/maps/autocomplete?input=university&sessionToken=demo-1"
curl "http://localhost:4000/api/maps/place-details?placeId=<id-from-above>&sessionToken=demo-1"
curl "http://localhost:4000/api/maps/reverse-geocode?lat=32.4945&lng=74.5229"
curl -X POST http://localhost:4000/api/maps/route \
  -H "Content-Type: application/json" \
  -d '{"origin":{"lat":32.4945,"lng":74.5229},"destination":{"lat":32.5201,"lng":74.5600},"vehicleType":"bike"}'
curl "http://localhost:4000/api/maps/usage"
```

These require a real `GOOGLE_MAPS_API_KEY` in `.env` and will count against
your quota. **`npm test` never hits real Google APIs** — `src/tests/map.test.js`
monkey-patches `googleMaps.service.js`'s exported functions with fakes, so CI
and local test runs are free and deterministic.

## inDrive integration

See the [inDrive Provider Research](docs/providers/indrive.md) document for the
observed, independently maintained integration contract. It is not an official
inDrive SDK or API specification.

Set `INDRIVE_MODE=simulated` for deterministic local development. Set
`INDRIVE_MODE=real` and provide an authorized `INDRIVE_REFRESH_TOKEN`,
`INDRIVE_DEVICE_FINGERPRINT`, and `INDRIVE_FINGERPRINT` through the backend
environment only. The official client was observed sending both fingerprint
headers during renewal, but their strict necessity is not established. The
seed refresh token is used only when no persisted
session exists; a rotated refresh token returned by inDrive is persisted and
becomes authoritative. Access tokens renew inside a five-minute buffer with a
process-level single-flight lock. A pricing 401 triggers exactly one forced
renewal and retry; a second 401 marks the provider `AUTH_REQUIRED`.

`GET /api/providers/status` returns only provider id, enabled, mode, and safe
status (`READY`, `AUTH_REQUIRED`, `NOT_CONFIGURED`, `TEMPORARILY_UNAVAILABLE`,
or `DISABLED`). Provider failures are returned as unavailable comparison cards,
so other providers can still succeed. Successful normalized quotes are stored
in `fare_observations`; failed responses are never stored as observations.

Supported configuration variables are `INDRIVE_ENABLED`, `INDRIVE_MODE`,
`INDRIVE_REFRESH_TOKEN`, `INDRIVE_DEVICE_FINGERPRINT`, `INDRIVE_FINGERPRINT`,
`INDRIVE_APP_VERSION`, `INDRIVE_LANGUAGE`, `INDRIVE_OS_TYPE`,
`INDRIVE_APP_FLAVOR`, `INDRIVE_REQUEST_TIMEOUT_MS`, and
`INDRIVE_REFRESH_BUFFER_SECONDS`.

Fair Fare does not implement inDrive authentication bypass. An authorized
session credential must be supplied before the real provider integration can
become READY.

## ML Fare Prediction

Fair Fare's first tabular prediction pipeline is separated from the Express
business layer under `ml/`. It reads normalized `fare_observations`, prepares
numeric and categorical features, performs a reproducible grouped split by
`comparison_id`, compares a provider/vehicle historical-mean baseline with
Linear Regression, Random Forest, and Gradient Boosting, and saves the
selected sklearn pipeline plus JSON metadata under `ml/artifacts/`.

The prediction target is `fare`. Features are provider ID/name, provider
category ID/name, normalized vehicle type, pickup/destination coordinates and
zones, numeric distance/duration, hour, weekday, and weekend flag. The
observation ID, comparison ID, fare ranges, ETA, and raw provider JSON are
excluded from the primary model to avoid leakage. Missing optional categories
are encoded as `UNKNOWN`; invalid target/route rows are rejected and reported.

Every observation carries `data_source`: `REAL`, `SIMULATED`, `TEST`, or
`UNKNOWN`. Test requests are labelled `TEST`; simulated development adapters
are labelled `SIMULATED`; legacy rows remain `UNKNOWN`. Training requires an
explicit source and defaults to `SIMULATED`, so automated test rows are not
silently trained as development data.

Install the ML dependencies from `requirements.txt`. The local development
commands are:

```bash
npm run ml:train:simulated
npm run ml:evaluate
npm run ml:test-prediction
```

`POST /api/predictions/fare` invokes the saved Python predictor through a
structured stdin/stdout child process with no shell interpolation. Missing
artifacts, unavailable Python, invalid input, and timeouts return a safe
status instead of breaking fare comparison. Current provider fares remain
primary; predictions are attached separately and are never guarantees.

Example request:

```json
{
  "providerId": 1,
  "providerCategoryId": "31",
  "providerCategoryName": "Rickshaw",
  "vehicleType": "RICKSHAW",
  "pickupLatitude": 31.5,
  "pickupLongitude": 74.3,
  "destinationLatitude": 31.4,
  "destinationLongitude": 74.4,
  "distanceMeters": 5800,
  "durationSeconds": 900,
  "hourOfDay": 18,
  "dayOfWeek": 5,
  "isWeekend": 0
}
```

The response reports `AVAILABLE`, `MODEL_NOT_TRAINED`, or a safe failure
status. `confidence` is currently `null`; no statistical confidence interval
is claimed.

The mobile results card shows `Current fare`, `Expected fare`, and a
deterministic Book/Wait recommendation when prediction data is available.
`BOOK_NOW` means the current quote is materially below the model reference;
`WAIT` means it is materially above the reference; `NEUTRAL` means it is
close. `INSUFFICIENT_DATA` keeps the quote usable when prediction data is not
available. The recommendation does not predict future fare movement and does
not guarantee that waiting will lower a fare.

The current development model uses simulated or test-derived observations.
Recommendations preserve that provenance and are not validated real-world
forecasting.

## Book/Wait Recommendation

`src/services/rideRecommendation.service.js` compares each provider's current
fare with its available ML expected fare. The default material-difference
threshold is 10 percent and can be changed with
`FAIRFARE_RECOMMENDATION_THRESHOLD_PERCENT`. The output statuses are
`BOOK_NOW`, `WAIT`, `NEUTRAL`, and `INSUFFICIENT_DATA`.

This recommendation is separate from the provider action button. The mobile
action opens the provider; it remains available even when the recommendation
is `WAIT`. No future price claim, confidence score, personalized preference
logic, or chatbot is involved.

There is no standalone recommendation endpoint in Version 1; comparison
enrichment is the single path so prediction input construction is not
duplicated.

## Fare Observation Dataset

`fare_observations` is the research/ML dataset and remains separate from the
user-facing `comparison_history` snapshot. One observation is one valid fare
quote for one provider vehicle/category at one comparison timestamp. A single
comparison can therefore create multiple observation rows when an adapter
returns multiple categories. Failed providers and quotes without a fare never
create fabricated observations.

Observations retain the provider category ID/name alongside a centralized
`vehicle_type` normalization. Verified inDrive mappings are order types `2`
(`Moto` → `BIKE`), `33` (`Mini` → `ECONOMY_CAR`), `31` (`Rickshaw` →
`RICKSHAW`), `29` (`Ride AC` → `STANDARD_CAR`), and `11` (`Premium` →
`PREMIUM_CAR`). Unknown future IDs remain `UNKNOWN` with their IDs preserved.
Provider-specific category names are never replaced by the normalized value.

Coordinates, numeric route distance/duration, fare/fare-range semantics,
currency, ETA, and the UTC `observed_at` timestamp are stored when available.
`hour_of_day`, `day_of_week`, and `is_weekend` are derived centrally using the
configurable `FAIRFARE_MARKET_TIMEZONE` setting, which defaults to
`Asia/Karachi`. Pickup/destination zones remain null unless a verified zone is
already supplied by the caller.

Adapters may provide a pricing-response fragment as `metadata.raw`. It is
stored only as `raw_response_sanitized`; keys containing authorization,
OAuth/token, refresh/session, cookie, credential, fingerprint/device, phone,
or account data are removed recursively. Authenticated request headers and
sessions are never stored. The normalized columns are the intended ML input.

Development/research utilities:

```bash
npm run export:dataset   # writes data/exports/fare_observations.csv
npm run stats:dataset    # prints counts, fare stats, date range, missing fields
```

The CSV contains normalized, non-secret columns only and is not generated or
committed automatically. Current simulated provider comparisons are useful for
pipeline validation but must not be described as real provider observations.
Yango and Bykea are represented by the existing `quickride` and `urbancab`
internal provider IDs and now use deterministic Fair Fare simulation adapters.
Set `INDRIVE_MODE=simulated`, `YANGO_MODE=simulated`, and
`BYKEA_MODE=simulated` for the FYP/demo configuration. These formulas use
provider/category rate configuration, route distance/duration, and a stable
context adjustment; they are Fair Fare demo models, not the providers' pricing
algorithms. Simulated quotes and fare observations are marked `SIMULATED` and
must not be presented as confirmed live prices. `REAL` remains available for
inDrive only; Yango/Bykea report unavailable until a separately approved real
adapter exists. `FAIRFARE_SIMULATION_ONLY` defaults to `true`; while it is true,
missing, invalid, or real-valued provider mode settings fail closed to
`SIMULATED`, including the provider status endpoint. Real inDrive mode requires
an explicit `FAIRFARE_SIMULATION_ONLY=false` opt-out in a separately controlled
environment. Provider authentication is independent from Fair Fare user
authentication.

See [Fair Fare provider simulation](docs/providers/simulation.md) for the
developer methodology, exact demo coefficients, context modifiers, ETA
simulation, weather normalization, weather-aware demo coefficients, and
provenance rules.

## Notes for Frontend Integration

### Persistent auth sessions

`ACCESS_TOKEN_TTL` remains the short-lived access JWT lifetime. The existing
`REFRESH_TOKEN_TTL_SECONDS` setting is the single refresh-session lifetime;
its default is 2,592,000 seconds (30 days). Refresh sessions use a sliding
policy: a successful atomic rotation updates the stored hash, `last_used_at`,
and `expires_at` to approximately 30 days from that use. Plaintext refresh
tokens are never stored.

- All responses share the shape `{ success, message, data }` (or
  `{ success: false, message, errors }` for validation failures).
- `POST /api/fares/compare` is the only endpoint the app needs for the core
  comparison screen; `results` is pre-sorted cheapest-first and each entry
  already has `badges` ready to render. Pass an optional `route` field to use
  real Google distance/duration instead of the haversine estimate.
- The mobile app only ever talks to `/api/maps/*` on this backend — it never
  calls Google directly, so the Google API key is never present in the app
  bundle.
- Authenticated fare comparison, history, and preference requests require
  `Authorization: Bearer <accessToken>`. The mobile client stores the session
  in Expo SecureStore and refreshes expired access tokens once.
- CORS is open (`cors()` with no restrictions) for the current FYP development
  setup; tighten it before production deployment.
- Base URL during development: `http://localhost:4000` (or your machine's LAN
  IP if testing on a physical device — set `PORT` in `.env` if 4000 is taken).

## AI Ride Assistant

`POST /api/ai/chat` is an authenticated natural-language explanation layer.
The backend builds bounded context from the authenticated user's own current
comparison, preferences, and recent history, then supplies existing ML,
Book/Wait, and personalization outputs to the configured LLM. The LLM does
not calculate fares or rerank rides. Current comparisons use a short-lived
server-owned enriched context; historical entries remain snapshots.

Set `AI_ASSISTANT_ENABLED=true`, `GROQ_API_KEY`, and, when OpenRouter fallback
is enabled, `OPENROUTER_API_KEY`. `AI_API_KEY` remains supported as a legacy
OpenRouter alias. Optionally set `AI_MODEL`,
`AI_API_URL`, and `AI_REQUEST_TIMEOUT_MS` in the backend environment. When
disabled or unconfigured, the endpoint returns a safe unavailable response
and does not affect fare comparison. Automated tests inject a mock client and
never require a live paid provider.

## User Preferences

Preferences are stored privately in one `user_preferences` row per account.
The API is authenticated and derives ownership from the access token rather
than a client-supplied user ID:

```text
GET /api/preferences
PUT /api/preferences
```

The response uses normalized values such as `BIKE`, `RICKSHAW`,
`ECONOMY_CAR`, `STANDARD_CAR`, `PREMIUM_CAR`, and `OTHER`; `UNKNOWN` is not a
mobile selection. Supported priorities are `CHEAPEST`, `FASTEST_PICKUP`, and
`BALANCED`. `typicalBudget` is an optional positive PKR amount.

Preferences are a future personalization input only. They are not stored in
`fare_observations` and are not features of the global fare-prediction model.

## FYP Architecture Summary

Fair Fare keeps decision authority outside the language model:

```text
Provider layer        -> current provider quotes
ML layer              -> expected fare/reference estimate
Book/Wait layer       -> current fare vs expected reference
Personalization layer -> user-fit ranking from preferences
AI layer              -> grounded natural-language explanation
```

Expected fare is not a guaranteed future fare. Book/Wait is advisory. The
current development model uses SIMULATED observations and is not evidence of
real-world generalization.

## Final Version 1 Feature Matrix

| Feature | Status | Evidence/Test | Limitation |
|---|---|---|---|
| Authentication | Implemented | `src/tests/auth.test.js` | No social login |
| Persistent session | Implemented | Auth regression suite | Device validation pending |
| Maps/routes | Implemented | `src/tests/map.test.js` | Real key/device validation pending |
| Fare comparison | Implemented | `src/tests/fare.test.js` | Simulated providers |
| History | Implemented | `src/tests/history.test.js` | SQLite persistence depends on hosting volume |
| Preferences | Implemented | `src/tests/userPreference.test.js` | User-entered preferences |
| Fare observations | Implemented | `src/tests/fareObservation.test.js` | Current dataset is development data |
| ML prediction | Implemented | `ml/test_pipeline.py`, prediction smoke | SIMULATED training data |
| Book/Wait | Implemented | `src/tests/rideRecommendation.test.js` | Advisory reference comparison |
| Personalization | Implemented | personalized recommendation tests | Deterministic prototype rules |
| AI Ride Assistant | Implemented | `src/tests/aiRideAssistant.test.js`, `npm run evaluate:ai` | Requires backend LLM configuration for live answers |
| Provider handoff | Implemented | Mobile launcher behavior | Verified links are limited |
| Real provider APIs | Postponed / not part of current demo | Provider adapters remain simulated | Requires authorized integrations |

## Deployment

This is already deploy-ready for any standard Node.js host (Render, Railway,
Fly.io, a VPS, etc.) — no code changes were needed:

- `PORT` is read from `process.env.PORT`, falling back to `4000` only when
  unset — most PaaS providers inject their own `PORT`.
- `npm start` runs `node src/server.js` (no build step required).
- `DB_PATH` resolves relative to the process's working directory and
  auto-creates its parent folder, so it works unmodified on a fresh host.
- `better-sqlite3` is a native addon — any host that runs a normal
  `npm install` during its build step (which is all of them) rebuilds/fetches
  the correct binary for that platform automatically.
- CORS is fully open, so it accepts requests from the mobile app and the web
  fallback without extra configuration.

**One thing to know, not a blocker:** many free/starter PaaS tiers use an
**ephemeral filesystem** — anything written to disk (including the SQLite
file at `DB_PATH`) is wiped on every redeploy or restart. That only affects
persisted *search history* (`fare_searches`/`fare_results` rows); it does not
affect fare-comparison correctness, since providers/rates are reseeded via
`npm run migrate && npm run seed`. If you want search history to survive
restarts, attach a persistent volume/disk and point `DB_PATH` at it.

**Deploy checklist:**
1. Push this backend to your host of choice (or connect the repo).
2. Set the start command to `npm start` and build command to `npm install && npm run migrate && npm run seed`.
3. Set environment variables on the host (never commit real values):
   `GEOAPIFY_API_KEY`, `MAPS_DAILY_REQUEST_LIMIT`, `MAPS_ENABLE_CACHE`,
   and optionally `PORT`/`DB_PATH` if the host
   requires specific values.
4. Once live, note the public URL (e.g. `https://fairfare-backend.example.com`)
   — the mobile app needs `https://fairfare-backend.example.com/api` as its
   `EXPO_PUBLIC_API_BASE_URL`.
5. Smoke test before pointing the app at it: `curl https://YOUR_URL/api/health`.
