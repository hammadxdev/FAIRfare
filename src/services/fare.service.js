const db = require("../config/database");
const { estimateDistanceAndDuration } = require("./distance.service");
const { applyRecommendation } = require("./recommendation.service");
const { getAdapter } = require("../providers/provider.registry");
const AppError = require("../utils/AppError");
const { createComparisonHistory } = require("./history.service");
const { persistFareObservations } = require("./fareObservation.service");
const { deriveTimeFeatures } = require("./fareObservation.service");
const { normalizeVehicleType } = require("./vehicleType.service");
const { predictFare } = require("./farePrediction.service");
const { recommendRide } = require("./rideRecommendation.service");
const { rankPersonalizedRides } = require("./personalizedRideRecommendation.service");
const { getPreferences } = require("./userPreference.service");
const { rememberComparison } = require("./currentComparison.service");

function dataSourceForAdapter(adapter) {
  if (process.env.NODE_ENV === "test") return "TEST";
  return adapter.mode === "real" ? "REAL" : "SIMULATED";
}

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
      if (result.fare === null || result.fare === undefined) continue;
      insertResultStmt.run({
        search_id: searchId,
        provider_id: result.provider.id,
        estimated_fare: result.fare,
        eta_min: result.etaMin ?? 0,
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

async function compareFares({ userId, pickup, dropoff, vehicleType, route }) {
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

  const routeData = {
    pickup: { latitude: pickup.lat, longitude: pickup.lng },
    destination: { latitude: dropoff.lat, longitude: dropoff.lng },
    distanceMeters: Math.round(distanceKm * 1000),
    durationSeconds: Math.round(durationMin * 60),
  };

  const rawResults = await Promise.all(providers.map(async (provider) => {
    const rate = getRateStmt.get(provider.id, vehicleType);
    if (!rate) {
      return {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: null, etaMin: null, isAvailable: false,
        error: "PROVIDER_BAD_RESPONSE", badges: [], breakdown: null,
      };
    }

    try {
      const adapter = getAdapter(provider.name);
      if (typeof adapter.getQuotes === "function") {
        const quotes = await adapter.getQuotes({ route: routeData, rate, vehicleType });
        const quote = quotes.find((candidate) => candidate.fare !== null && candidate.fare !== undefined);
        if (!quote) throw new Error("No quote returned");
        return {
          provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
          fare: quote.fare, etaMin: quote.pickupEtaSeconds == null ? null : quote.pickupEtaSeconds / 60,
          isAvailable: quote.isAvailable, fareMin: quote.fareMin, fareMax: quote.fareMax,
          currency: quote.currency, fareType: quote.fareType, breakdown: quote.metadata?.breakdown || null,
          metadata: quote.metadata,
          quotes,
          dataSource: dataSourceForAdapter(adapter),
        };
      }
      const { finalFare, breakdown } = adapter.getFareQuote({ rate, distanceKm, durationMin });
      const quote = {
        providerId: provider.name,
        providerName: provider.display_name,
        categoryId: vehicleType,
        categoryName: vehicleType,
        fare: finalFare,
        fareMin: null,
        fareMax: null,
        currency: "PKR",
        fareType: "ESTIMATE",
        pickupEtaSeconds: adapter.getPickupEtaMin(vehicleType) * 60,
        isAvailable: true,
        metadata: { breakdown },
      };
      return {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: finalFare, etaMin: adapter.getPickupEtaMin(vehicleType), breakdown, quotes: [quote], dataSource: dataSourceForAdapter(adapter),
      };
    } catch (error) {
      console.error(`[${provider.display_name}] provider request failed: ${error.code || "UNAVAILABLE"}`);
      return {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: null, etaMin: null, isAvailable: false,
        error: error.code || "PROVIDER_UNAVAILABLE", badges: [], breakdown: null,
      };
    }
  }));

  const available = rawResults.filter((result) => result.fare !== null && result.fare !== undefined);
  const results = [...applyRecommendation(available), ...rawResults.filter((result) => !available.includes(result))];

  const searchId = persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results });

  let comparisonId = null;
  if (available.length > 0) {
    comparisonId = createComparisonHistory({ userId, pickup, dropoff, distanceKm, durationMin, vehicleType, results });
    try {
      persistFareObservations({
        comparisonId,
        pickup,
        dropoff,
        distanceMeters: routeData.distanceMeters,
        durationSeconds: routeData.durationSeconds,
        requestedVehicleType: vehicleType,
        results: available,
      });
    } catch (error) {
      // Dataset logging is deliberately non-critical to fare comparison.
      console.error("[observations] persistence failed:", error.message || error);
    }
  }

  const nowFeatures = deriveTimeFeatures(Date.now());
  await Promise.all(available.map(async (result) => {
    const quote = result.quotes?.find((candidate) => candidate.fare !== null && candidate.fare !== undefined) || result;
    const normalizedType = normalizeVehicleType({
      provider: result.provider.name,
      providerCategoryId: quote.categoryId,
      providerCategoryName: quote.categoryName,
      requestedVehicleType: vehicleType,
    });
    try {
      result.prediction = await predictFare({
        providerId: result.provider.id,
        providerName: result.provider.name,
        providerCategoryId: quote.categoryId || vehicleType,
        providerCategoryName: quote.categoryName || vehicleType,
        vehicleType: normalizedType,
        pickupLatitude: pickup.lat,
        pickupLongitude: pickup.lng,
        destinationLatitude: dropoff.lat,
        destinationLongitude: dropoff.lng,
        distanceMeters: routeData.distanceMeters,
        durationSeconds: routeData.durationSeconds,
        hourOfDay: nowFeatures.hourOfDay,
        dayOfWeek: nowFeatures.dayOfWeek,
        isWeekend: nowFeatures.isWeekend,
        dataSource: result.dataSource || "UNKNOWN",
      });
      result.recommendation = recommendRide({ currentFare: result.fare, prediction: result.prediction });
    } catch (error) {
      result.prediction = { status: "PREDICTION_FAILED", predictedFare: null, confidence: null };
      result.recommendation = recommendRide({ currentFare: result.fare, prediction: result.prediction });
      console.error("[prediction] non-critical prediction failure:", error.message || error);
    }
  }));
  // applyRecommendation returns copied result objects, so copy the optional
  // prediction back onto the response objects without replacing current fare.
  for (const result of results) {
    const source = available.find((candidate) => candidate.provider.id === result.provider.id);
    if (source?.prediction) result.prediction = source.prediction;
    if (source?.recommendation) result.recommendation = source.recommendation;
  }

  // Preferences are read once per authenticated comparison. Personalization
  // is response enrichment only; it does not alter fares, ML inputs, or the
  // historical fare snapshot created above.
  const preferences = getPreferences(userId);
  const personalizedResults = rankPersonalizedRides({
    results,
    preferences,
    requestedVehicleType: vehicleType,
  });

  const comparison = {
    searchId,
    comparisonId,
    pickup,
    dropoff,
    vehicleType,
    distanceKm,
    durationMin,
    results: personalizedResults,
  };
  if (comparisonId) rememberComparison({ userId, comparison });
  return comparison;
}

module.exports = { compareFares };
