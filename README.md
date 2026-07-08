# FAIRfair Backend

Backend API for **FAIRfair**, a React Native app that compares ride fares across
multiple providers. Real provider APIs aren't available yet, so this backend
**simulates** 3 ride providers using configurable fare formulas stored in SQLite.
It's built with a provider-adapter architecture so real APIs can be swapped in
later without touching the routes/controllers/services layer.

## Tech Stack

- Node.js + Express
- SQLite via `better-sqlite3`
- CORS, dotenv
- Node's built-in test runner (`node --test`) + `supertest`
- No auth, no frontend, no AI — API only

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
      recommendation.service.js         # cheapest/fastest/recommended scoring
      googleMaps.service.js             # raw Google Maps Platform HTTP calls
      cache.service.js                    # in-memory TTL cache (autocomplete/details/geocode/route)
      mapUsage.service.js                   # daily Google request counters + limit
      polyline.service.js                     # decodes Google encoded polylines

    providers/                          # one adapter per ride provider
      formula.js                          # shared pure fare formula
      ridego.provider.js
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

## Database

SQLite file lives at `DB_PATH` (default `./data/fairfair.sqlite`), created
automatically on first migration.

Tables: `providers`, `vehicle_rates`, `fare_searches`, `fare_results`
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

## Google Maps Setup

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

## Notes for Frontend Integration

- All responses share the shape `{ success, message, data }` (or
  `{ success: false, message, errors }` for validation failures).
- `POST /api/fares/compare` is the only endpoint the app needs for the core
  comparison screen; `results` is pre-sorted cheapest-first and each entry
  already has `badges` ready to render. Pass an optional `route` field to use
  real Google distance/duration instead of the haversine estimate.
- The mobile app only ever talks to `/api/maps/*` on this backend — it never
  calls Google directly, so the Google API key is never present in the app
  bundle.
- CORS is open (`cors()` with no restrictions) since there's no auth layer —
  fine for FYP demo purposes, tighten before any real deployment.
- Base URL during development: `http://localhost:4000` (or your machine's LAN
  IP if testing on a physical device — set `PORT` in `.env` if 4000 is taken).

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
   `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_DAILY_REQUEST_LIMIT`,
   `GOOGLE_MAPS_ENABLE_CACHE`, and optionally `PORT`/`DB_PATH` if the host
   requires specific values.
4. Once live, note the public URL (e.g. `https://fairfair-backend.example.com`)
   — the mobile app needs `https://fairfair-backend.example.com/api` as its
   `EXPO_PUBLIC_API_BASE_URL`.
5. Smoke test before pointing the app at it: `curl https://YOUR_URL/api/health`.
