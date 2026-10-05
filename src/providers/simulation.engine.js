// Fair Fare demo pricing model. This is deliberately not a provider pricing
// algorithm; it is a deterministic stand-in behind the provider adapter seam.
const PROVIDER_PROFILES = Object.freeze({
  indrive: Object.freeze({ fareMultiplier: 1.00, etaBase: 5, contextSensitivity: 0.02 }),
  quickride: Object.freeze({ fareMultiplier: 0.96, etaBase: 7, contextSensitivity: 0.03 }),
  urbancab: Object.freeze({ fareMultiplier: 1.06, etaBase: 4, contextSensitivity: 0.025 }),
});

const CATEGORY_NAMES = Object.freeze({
  bike: "Bike",
  rickshaw: "Rickshaw",
  mini: "Mini",
  car: "Car",
});

function numberOr(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function stableContextMultiplier({ provider, vehicleType, route, observedAt }) {
  const pickup = route?.pickup || {};
  const destination = route?.destination || {};
  const locationSignal = Math.abs(
    numberOr(pickup.latitude) * 13.17 + numberOr(pickup.longitude) * 7.31
      + numberOr(destination.latitude) * 5.11 + numberOr(destination.longitude) * 3.07,
  );
  const hour = new Date(observedAt ?? 0).getUTCHours();
  const rush = hour >= 7 && hour <= 10 || hour >= 16 && hour <= 19 ? 1 : 0;
  const profile = PROVIDER_PROFILES[provider] || PROVIDER_PROFILES.indrive;
  const locationBand = Math.floor(locationSignal * 10) % 5;
  return 1 + rush * profile.contextSensitivity + locationBand * 0.005;
}

function categoryFor(provider, vehicleType) {
  const key = String(vehicleType || "").toLowerCase();
  if (provider === "indrive") {
    const mappings = {
      bike: { id: "2", name: "Moto", normalized: "BIKE" },
      mini: { id: "33", name: "Mini", normalized: "ECONOMY_CAR" },
      rickshaw: { id: "31", name: "Rickshaw", normalized: "RICKSHAW" },
      car: { id: "29", name: "Ride AC", normalized: "STANDARD_CAR" },
      premium: { id: "11", name: "Premium", normalized: "PREMIUM_CAR" },
    };
    return mappings[key] || { id: null, name: null, normalized: "UNKNOWN" };
  }
  return { id: key || null, name: CATEGORY_NAMES[key] || null, normalized: ({ bike: "BIKE", rickshaw: "RICKSHAW", mini: "ECONOMY_CAR", car: "STANDARD_CAR", premium: "PREMIUM_CAR" })[key] || "UNKNOWN" };
}

function calculateSimulatedFare({ provider, vehicleType, rate, route, observedAt = 0 }) {
  const distanceKm = Math.max(0, numberOr(route?.distanceMeters) / 1000);
  const durationMin = Math.max(0, numberOr(route?.durationSeconds) / 60);
  const profile = PROVIDER_PROFILES[provider] || PROVIDER_PROFILES.indrive;
  const contextMultiplier = stableContextMultiplier({ provider, vehicleType, route, observedAt });
  const baseFare = Math.max(0, numberOr(rate?.base_fare));
  const distanceFare = distanceKm * Math.max(0, numberOr(rate?.per_km_rate));
  const timeFare = durationMin * Math.max(0, numberOr(rate?.per_min_rate));
  const minimumFare = Math.max(0, numberOr(rate?.minimum_fare));
  const configuredMultiplier = Math.max(0, numberOr(rate?.surge_multiplier, 1));
  const rawFare = (baseFare + distanceFare + timeFare) * configuredMultiplier * profile.fareMultiplier * contextMultiplier;
  const fare = Math.max(0, Math.round(Math.max(rawFare, minimumFare)));
  const category = categoryFor(provider, vehicleType);
  const etaMin = Math.min(15, Math.max(3, profile.etaBase + (category.normalized === "BIKE" ? -1 : category.normalized === "PREMIUM_CAR" ? 1 : 0) + Math.floor(Math.abs(numberOr(route?.pickup?.latitude) * 10) % 3)));
  return {
    providerId: provider,
    providerCategoryId: category.id,
    providerCategoryName: category.name,
    normalizedCategory: category.normalized,
    fare,
    fareMin: null,
    fareMax: null,
    currency: "PKR",
    fareType: "ESTIMATE",
    pickupEtaSeconds: etaMin * 60,
    isAvailable: true,
    metadata: {
      simulated: true,
      model: "FAIR_FARE_SIMULATION_V1",
      breakdown: { baseFare, distanceFare: Math.round(distanceFare), timeFare: Math.round(timeFare), contextMultiplier, providerMultiplier: profile.fareMultiplier, minimumFare, finalFare: fare },
    },
  };
}

module.exports = { PROVIDER_PROFILES, categoryFor, calculateSimulatedFare };
