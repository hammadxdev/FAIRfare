const db = require("../config/database");
const { estimateDistanceAndDuration } = require("./distance.service");
const { applyRecommendation } = require("./recommendation.service");
const { getAdapter } = require("../providers/provider.registry");
const AppError = require("../utils/AppError");

// Statements are prepared fresh inside each function rather than once at
// module load — see the comment in app.js's readiness middleware for why a
// module-load-time prepared statement isn't safe to trust on this platform.

function persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results }) {
  const insertSearchStmt = db.prepare(`
    INSERT INTO fare_searches
      (pickup_name, pickup_lat, pickup_lng, dropoff_name, dropoff_lat, dropoff_lng, vehicle_type, distance_km, duration_min)
    VALUES (@pickup_name, @pickup_lat, @pickup_lng, @dropoff_name, @dropoff_lat, @dropoff_lng, @vehicle_type, @distance_km, @duration_min)
  `);

  const insertResultStmt = db.prepare(`
    INSERT INTO fare_results
      (search_id, provider_id, estimated_fare, eta_min, is_cheapest, is_fastest, is_recommended, breakdown_json)
    VALUES (@search_id, @provider_id, @estimated_fare, @eta_min, @is_cheapest, @is_fastest, @is_recommended, @breakdown_json)
  `);

  const insertAll = db.transaction(() => {
    const searchInfo = insertSearchStmt.run({
      pickup_name: pickup.name,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_name: dropoff.name,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      vehicle_type: vehicleType,
      distance_km: distanceKm,
      duration_min: durationMin,
    });

    const searchId = searchInfo.lastInsertRowid;

    for (const result of results) {
      insertResultStmt.run({
        search_id: searchId,
        provider_id: result.provider.id,
        estimated_fare: result.fare,
        eta_min: result.etaMin,
        is_cheapest: result.isCheapest ? 1 : 0,
        is_fastest: result.isFastest ? 1 : 0,
        is_recommended: result.isRecommended ? 1 : 0,
        breakdown_json: JSON.stringify(result.breakdown),
      });
    }

    return searchId;
  });

  return insertAll();
}

function compareFares({ pickup, dropoff, vehicleType, route }) {
  const getActiveProvidersStmt = db.prepare(`SELECT * FROM providers WHERE is_active = 1`);
  const getRateStmt = db.prepare(`SELECT * FROM vehicle_rates WHERE provider_id = ? AND vehicle_type = ?`);

  const providers = getActiveProvidersStmt.all();
  if (providers.length === 0) {
    throw new AppError("No active providers configured", 500);
  }

  // Prefer real Google route distance/duration when the frontend has it;
  // otherwise fall back to the haversine-based estimate.
  const { distanceKm, durationMin } =
    route && route.distanceKm && route.durationMin
      ? { distanceKm: route.distanceKm, durationMin: route.durationMin }
      : estimateDistanceAndDuration({ pickup, dropoff, vehicleType });

  const rawResults = providers.map((provider) => {
    const rate = getRateStmt.get(provider.id, vehicleType);
    if (!rate) {
      throw new AppError(
        `No rate configured for provider "${provider.name}" and vehicle type "${vehicleType}"`,
        500
      );
    }

    const adapter = getAdapter(provider.name);
    const { finalFare, breakdown } = adapter.getFareQuote({ rate, distanceKm, durationMin });
    const etaMin = adapter.getPickupEtaMin(vehicleType);

    return {
      provider: {
        id: provider.id,
        name: provider.name,
        displayName: provider.display_name,
      },
      fare: finalFare,
      etaMin,
      breakdown,
    };
  });

  const results = applyRecommendation(rawResults);

  const searchId = persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results });

  return {
    searchId,
    pickup,
    dropoff,
    vehicleType,
    distanceKm,
    durationMin,
    results,
  };
}

module.exports = { compareFares };
