const { query, withTransaction } = require("../config/postgres");
const { estimateDistanceAndDuration } = require("./distance.service");
const { applyRecommendation } = require("./recommendation.service");
const { getAdapter } = require("../providers/provider.registry");
const AppError = require("../utils/AppError");
const { createComparisonHistory, updateComparisonEnrichment } = require("./history.service");
const { persistFareObservations } = require("./fareObservation.service");
const { deriveTimeFeatures } = require("./fareObservation.service");
const { normalizeVehicleType } = require("./vehicleType.service");
const { predictFare } = require("./farePrediction.service");
const { recommendRide } = require("./rideRecommendation.service");
const { rankPersonalizedRides } = require("./personalizedRideRecommendation.service");
const { getPreferences } = require("./userPreference.service");
const { rememberComparison } = require("./currentComparison.service");
const { resolveWeatherContext } = require("./weatherContext.service");

function dataSourceForAdapter(adapter) {
  if (process.env.NODE_ENV === "test") return "TEST";
  return adapter.mode === "real" ? "REAL" : "SIMULATED";
}

// Statements are prepared fresh inside each function rather than once at
// module load — see the comment in app.js's readiness middleware for why a
// module-load-time prepared statement isn't safe to trust on this platform.

async function persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results }) {
  return withTransaction(async (client) => {
  const searchInfo = await client.query(`
    INSERT INTO fare_searches
      (pickup_name, pickup_lat, pickup_lng, dropoff_name, dropoff_lat, dropoff_lng, vehicle_type, distance_km, duration_min)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
  `, [pickup.name,pickup.lat,pickup.lng,dropoff.name,dropoff.lat,dropoff.lng,vehicleType,distanceKm,durationMin]);
  const searchId = searchInfo.rows[0].id;
  for (const result of results) {
    if (result.fare == null) continue;
    await client.query(`
    INSERT INTO fare_results
      (search_id, provider_id, estimated_fare, eta_min, is_cheapest, is_fastest, is_recommended, breakdown_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [searchId,result.provider.id,result.fare,result.etaMin??0,Boolean(result.isCheapest),Boolean(result.isFastest),Boolean(result.isRecommended),JSON.stringify(result.breakdown)]);
  } return searchId; });
}

async function compareFares({ userId, pickup, dropoff, vehicleType, route }) {
  const providers = (await query(`SELECT * FROM providers WHERE is_active = true`)).rows;
  if (providers.length === 0) {
    throw new AppError("No active providers configured", 500);
  }

  // Prefer real map-provider route distance/duration when the frontend has it;
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

  const observedAt = Date.now();
  const simulationContext = deriveTimeFeatures(observedAt);
  // Weather is contextual enrichment: one pickup lookup is shared by every
  // provider/category and a failure returns UNKNOWN without blocking fares.
  const weatherContext = await resolveWeatherContext({ latitude: pickup.lat, longitude: pickup.lng, observedAt });
  const rawResults = await Promise.all(providers.map(async (provider) => {
    const rate = (await query(`SELECT * FROM vehicle_rates WHERE provider_id = $1 AND vehicle_type = $2`, [provider.id, vehicleType])).rows[0];
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
        const quotes = await adapter.getQuotes({ route: routeData, rate, vehicleType, observedAt, context: { hour: simulationContext.hourOfDay, dayOfWeek: simulationContext.dayOfWeek, isWeekend: Boolean(simulationContext.isWeekend) }, weather: weatherContext });
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

  const searchId = await persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results });

  let comparisonId = null;
  if (available.length > 0) {
    comparisonId = await createComparisonHistory({ userId, pickup, dropoff, distanceKm, durationMin, vehicleType, results });
    try {
      await persistFareObservations({
        comparisonId,
        pickup,
        dropoff,
        distanceMeters: routeData.distanceMeters,
        durationSeconds: routeData.durationSeconds,
        requestedVehicleType: vehicleType,
        observedAt,
        weatherContext,
        results: available,
      });
    } catch (error) {
      // Dataset logging is deliberately non-critical to fare comparison.
      console.error("[observations] persistence failed:", error.message || error);
    }
  }

  const nowFeatures = simulationContext;
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
        weatherCondition: weatherContext.condition,
        weatherSeverity: weatherContext.weatherSeverity,
        precipitationMm: weatherContext.precipitationMm,
        temperatureC: weatherContext.temperatureC,
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

  if (comparisonId) {
    await updateComparisonEnrichment({ id: comparisonId, userId, results });
  }

  // Preferences are read once per authenticated comparison. Personalization
  // is response enrichment only; it does not alter fares, ML inputs, or the
  // historical fare snapshot created above.
  const preferences = await getPreferences(userId);
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
    weather: weatherContext,
    results: personalizedResults,
  };
  if (comparisonId) rememberComparison({ userId, comparison });
  return comparison;
}

module.exports = { compareFares };
