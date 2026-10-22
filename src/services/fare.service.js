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
const { getDatasetMode, resolveTripCoverage, estimateDatasetFare } = require("./fairFareDataset.service");

function safeYangoDiagnostics(value) {
  const categories = new Set(["AUTH_ERROR", "BAD_REQUEST", "FORBIDDEN", "RATE_LIMITED", "UPSTREAM_ERROR", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE", "NO_VALID_TARIFFS"]);
  if (!value || value.provider !== "yango" || !categories.has(value.errorCategory) || ![true, false, "unknown"].includes(value.requestReachedUpstream)) return null;
  const status = value.upstreamStatus === null ? null : Number(value.upstreamStatus);
  if (status !== null && (!Number.isInteger(status) || status <= 0)) return null;
  return { provider: "yango", upstreamStatus: status, errorCategory: value.errorCategory, requestReachedUpstream: value.requestReachedUpstream };
}

async function boundedPersistence(work, timeoutMs = 1500) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error("Non-critical persistence timed out"); error.code = "PERSISTENCE_TIMEOUT"; reject(error); }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function dataSourceForAdapter(adapter) {
  if (process.env.NODE_ENV === "test") return "TEST";
  return adapter.liveTransportEnabled === true && ["real", "authorized-live"].includes(adapter.mode) ? "REAL" : "NONE";
}

function isLiveFareResult(result) {
  const source = String(result?.dataSource || result?.source || "").toUpperCase();
  const fare = Number(result?.fare);
  const testFixture = process.env.NODE_ENV === "test" && ["TEST", "REAL"].includes(source);
  return (source === "REAL" || testFixture) && Number.isFinite(fare) && fare > 0 && result?.isAvailable !== false;
}

function unavailableLiveResult(provider, code = "LIVE_INTEGRATION_NOT_CONFIGURED") {
  return {
    provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
    fare: null, etaMin: null, isAvailable: false, status: "unavailable", source: "none", dataSource: "NONE",
    estimates: [],
    error: { code, message: "Live fare data is currently unavailable." },
    badges: [], breakdown: null,
  };
}

function logDevelopmentProviderDiagnostics(providers, results) {
  if (process.env.NODE_ENV === "production") return;
  const diagnostics = providers.map((provider, index) => {
    const adapter = getAdapter(provider.name);
    const result = results[index] || {};
    const errorCode = typeof result.error === "string" ? result.error : result.error?.code || null;
    const upstream = result.errorDiagnostics || result.error?.diagnostics || null;
    return {
      provider: provider.display_name || provider.name,
      configured: adapter.liveTransportEnabled === true,
      attempted: upstream?.requestReachedUpstream === true || result.dataSource === "REAL" || result.source === "live",
      httpStatus: Number.isInteger(upstream?.upstreamStatus) ? upstream.upstreamStatus : null,
      status: result.status || (result.isAvailable ? "available" : "unavailable"),
      errorCode,
      fareCategories: Array.isArray(result.quotes) ? result.quotes.length : 0,
      availabilityReason: result.availabilityReason?.code || result.availability || errorCode || null,
    };
  });
  console.info("[fare] provider diagnostics", diagnostics);
}

// Statements are prepared fresh inside each function rather than once at
// module load — see the comment in app.js's readiness middleware for why a
// module-load-time prepared statement isn't safe to trust on this platform.

async function persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results }) {
  if (!pickup?.name || !dropoff?.name) {
    const error = new Error("Verified pickup and destination names are required for fare_searches persistence");
    error.code = "PERSISTENCE_MISSING_LOCATION_NAME";
    throw error;
  }
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
  const startedAt = Date.now();
  const timing = (stage, stageStartedAt) => {
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.info("[fare][timing]", { stage, elapsedMs: Date.now() - stageStartedAt, totalMs: Date.now() - startedAt });
  };
  if (route?.compareFaresEligible === false) {
    throw new AppError("Fare comparison is blocked until the selected locations are confirmed for this route.", 422, [route.eligibilityReason || "ROUTE_NOT_ELIGIBLE"]);
  }
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
  const datasetMode = getDatasetMode();
  // Weather is contextual enrichment: one pickup lookup is shared by every
  // provider/category and a failure returns UNKNOWN without blocking fares.
  const weatherContext = await resolveWeatherContext({ latitude: pickup.lat, longitude: pickup.lng, observedAt });
  const providerStartedAt = Date.now();
  const settledResults = await Promise.allSettled(providers.map(async (provider) => {
    const adapter = getAdapter(provider.name);
    if (process.env.NODE_ENV !== "test" && (adapter.liveTransportEnabled !== true || dataSourceForAdapter(adapter) !== "REAL")) {
      return unavailableLiveResult(provider);
    }
    const coverage = resolveTripCoverage({ pickup, dropoff, provider: provider.name, vehicleType });
    if (datasetMode === "verified" && !coverage.supported) {
      return {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: null, etaMin: null, isAvailable: false,
        availability: "unverified", error: coverage.status, coverage,
        badges: [], breakdown: null,
      };
    }
    if (datasetMode === "verified") {
      const estimate = estimateDatasetFare({
        vehicleType,
        distanceKm,
        durationMin,
        hourOfDay: simulationContext.hourOfDay,
        dayOfWeek: simulationContext.dayOfWeek,
        weather: weatherContext,
      });
      if (!estimate) {
        return {
          provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
          fare: null, etaMin: null, isAvailable: false,
          availability: "unverified", error: "VEHICLE_MODEL_UNAVAILABLE", coverage,
          badges: [], breakdown: null,
        };
      }
      const etaMin = typeof adapter.getPickupEtaMin === "function" ? adapter.getPickupEtaMin(vehicleType) : null;
      const quote = { providerId: provider.name, providerName: provider.display_name, categoryId: vehicleType, categoryName: vehicleType, fare: estimate.fare, fareMin: null, fareMax: null, currency: estimate.currency, fareType: estimate.fareType, pickupEtaSeconds: etaMin == null ? null : etaMin * 60, isAvailable: true, metadata: estimate.metadata };
      return {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: estimate.fare, etaMin, isAvailable: true, fareMin: null, fareMax: null,
        currency: estimate.currency, fareType: estimate.fareType, breakdown: estimate.metadata.breakdown,
        uncertaintyMarginPkr: estimate.uncertaintyMarginPkr, metadata: estimate.metadata, quotes: [quote],
        dataSource: "SYNTHETIC_DATASET", coverage,
      };
    }

    const usesAuthorizedLiveTransport = adapter.liveTransportEnabled === true && dataSourceForAdapter(adapter) === "REAL";
    const rate = usesAuthorizedLiveTransport
      ? null
      : (await query(`SELECT * FROM vehicle_rates WHERE provider_id = $1 AND vehicle_type = $2`, [provider.id, vehicleType])).rows[0];
    if (!rate && !usesAuthorizedLiveTransport) {
      return {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: null, etaMin: null, isAvailable: false,
        error: "PROVIDER_BAD_RESPONSE", coverage, badges: [], breakdown: null,
      };
    }

    try {
      const adapter = getAdapter(provider.name);
      if (typeof adapter.getQuotes === "function") {
        const quotes = await adapter.getQuotes({ route: routeData, rate, vehicleType, observedAt, context: { hour: simulationContext.hourOfDay, dayOfWeek: simulationContext.dayOfWeek, isWeekend: Boolean(simulationContext.isWeekend) }, weather: weatherContext });
        const quote = quotes.find((candidate) => candidate.fare !== null && candidate.fare !== undefined);
        if (!quote) throw new Error("No quote returned");
        if (!Number.isFinite(Number(quote.fare)) || Number(quote.fare) <= 0) throw new Error("Invalid fare returned");
        return {
          provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
          fare: quote.fare, etaMin: quote.pickupEtaSeconds == null ? null : quote.pickupEtaSeconds / 60,
          isAvailable: quote.isAvailable, fareMin: quote.fareMin, fareMax: quote.fareMax,
          currency: quote.currency, fareType: quote.fareType, breakdown: quote.metadata?.breakdown || null,
          vehicleCategory: quote.vehicleCategory || "unknown",
          providerServiceName: quote.providerServiceName || quote.categoryName || null,
          providerServiceLabel: quote.providerServiceLabel || null,
          serviceTier: quote.serviceTier || "unknown",
          features: Array.isArray(quote.features) ? quote.features : [],
          service_code: quote.service_code,
          metadata: quote.metadata,
          quotes,
          dataSource: dataSourceForAdapter(adapter),
          source: dataSourceForAdapter(adapter) === "REAL" ? "live" : "test",
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
        const result = {
        provider: { id: provider.id, name: provider.name, displayName: provider.display_name },
        fare: null, etaMin: null, isAvailable: false,
        error: error.code || "PROVIDER_UNAVAILABLE", badges: [], breakdown: null,
      };
        const diagnostics = provider.name === "quickride" ? safeYangoDiagnostics(error?.yangoDiagnostics) : null;
        if (diagnostics) result.errorDiagnostics = diagnostics;
        return result;
    }
  }));
  timing("providers_complete", providerStartedAt);
  const rawResults = settledResults.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const provider = providers[index];
    const errorCode = entry.reason?.code || "PROVIDER_UNAVAILABLE";
    console.error(`[${provider.display_name}] provider request failed: ${errorCode}`);
    return process.env.NODE_ENV === "test"
      ? { provider: { id: provider.id, name: provider.name, displayName: provider.display_name }, fare: null, etaMin: null, isAvailable: false, error: errorCode, availability: errorCode === "PROVIDER_TIMEOUT" ? "timeout" : "unavailable", badges: [], breakdown: null }
      : unavailableLiveResult(provider, errorCode);
  });
  logDevelopmentProviderDiagnostics(providers, rawResults);

  const available = rawResults.filter(isLiveFareResult);
  // Only verified mode changes the public result set. Legacy and preview retain
  // the existing provider response contract; preview adds diagnostics below.
  const results = datasetMode === "verified"
    ? [...applyRecommendation(available), ...rawResults.filter((result) => !available.includes(result) && (!result.coverage || result.coverage.supported))]
    : [...applyRecommendation(available), ...rawResults.filter((result) => !available.includes(result))];

  const datasetPreview = process.env.NODE_ENV === "test" && datasetMode === "preview"
    ? providers.map((provider) => {
      const coverage = resolveTripCoverage({ pickup, dropoff, provider: provider.name, vehicleType });
      const estimate = estimateDatasetFare({ vehicleType, distanceKm, durationMin, hourOfDay: simulationContext.hourOfDay, dayOfWeek: simulationContext.dayOfWeek, weather: weatherContext });
      return {
        provider: { id: provider.name, displayName: provider.display_name },
        coverage,
        estimate: estimate ? { ...estimate, experimental: true, notPublicResult: true } : null,
        provenance: "Synthetic Fair Fare dataset; not an observed provider quotation",
      };
    })
    : null;

  let searchId = null;
  const searchPersistenceStartedAt = Date.now();
  try {
    searchId = await boundedPersistence(() => persistSearchAndResults({ pickup, dropoff, vehicleType, distanceKm, durationMin, results }));
  } catch (error) {
    // Provider quotes are already verified by the adapters. A history/search
    // persistence mismatch must not turn a successful live comparison into an
    // AI outage or discard the real quotes.
    console.error("[fare] non-critical search persistence failed", {
      code: error.code || "PERSISTENCE_FAILED",
      table: error.table || null,
      column: error.column || null,
      constraint: error.constraint || null,
    });
  } finally {
    timing("fare_searches_persistence", searchPersistenceStartedAt);
  }

  let comparisonId = null;
  if (available.length > 0) {
    const historyPersistenceStartedAt = Date.now();
    try {
      comparisonId = await boundedPersistence(() => createComparisonHistory({ userId, pickup, dropoff, distanceKm, durationMin, vehicleType, results }));
    } catch (error) {
      console.error("[fare] non-critical comparison history persistence failed", {
        code: error.code || "HISTORY_PERSISTENCE_FAILED",
        table: error.table || null,
        column: error.column || null,
        constraint: error.constraint || null,
      });
    } finally {
      timing("comparison_history_persistence", historyPersistenceStartedAt);
    }
    try {
      await boundedPersistence(() => persistFareObservations({
        comparisonId,
        pickup,
        dropoff,
        distanceMeters: routeData.distanceMeters,
        durationSeconds: routeData.durationSeconds,
        requestedVehicleType: vehicleType,
        observedAt,
        weatherContext,
        results: available,
      }), 1200);
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
      result.prediction = await boundedPersistence(() => predictFare({
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
      }), 800);
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
    await boundedPersistence(() => updateComparisonEnrichment({ id: comparisonId, userId, results }), 800);
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
    coverage: {
      mode: datasetMode,
      city: rawResults.find((result) => result.coverage?.city)?.coverage?.city || null,
      pickupCity: rawResults.find((result) => result.coverage)?.coverage?.pickupCity || null,
      dropoffCity: rawResults.find((result) => result.coverage)?.coverage?.dropoffCity || null,
      intercity: rawResults.some((result) => result.coverage?.intercity === true),
      providers: rawResults.map((result) => ({ provider: result.provider.name, displayName: result.provider.displayName, status: result.coverage?.status || (result.fare != null ? "LEGACY_APPROVED" : "UNKNOWN"), supported: result.coverage?.supported === true })),
      provenance: "Live provider data only; provider availability is not inferred locally",
    },
    results: personalizedResults,
  };
  if (datasetPreview) comparison.datasetPreview = datasetPreview;
  if (comparisonId) rememberComparison({ userId, comparison });
  return comparison;
}

module.exports = { compareFares, isLiveFareResult, unavailableLiveResult };
