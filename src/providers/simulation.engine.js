// Fair Fare FYP/demo coefficients. These are deterministic stand-ins, not
// claims about the proprietary pricing algorithms of any provider.
const SIMULATION_CONFIG = Object.freeze({
  indrive: Object.freeze({ mode: "negotiated", contextSensitivity: 0.018, etaBase: 5, categories: Object.freeze({
    bike: Object.freeze({ id: "2", name: "Moto", normalized: "BIKE", baseFare: 60, perKm: 20, perMinute: 1, minimumFare: 120, offerSpread: 0.16, etaOffset: -1 }),
    mini: Object.freeze({ id: "33", name: "Mini", normalized: "ECONOMY_CAR", baseFare: 100, perKm: 34, perMinute: 1.8, minimumFare: 200, offerSpread: 0.15, etaOffset: 1 }),
    rickshaw: Object.freeze({ id: "31", name: "Rickshaw", normalized: "RICKSHAW", baseFare: 80, perKm: 28, perMinute: 1.4, minimumFare: 150, offerSpread: 0.15, etaOffset: 0 }),
    car: Object.freeze({ id: "29", name: "Ride AC", normalized: "STANDARD_CAR", baseFare: 120, perKm: 42, perMinute: 2.2, minimumFare: 250, offerSpread: 0.14, etaOffset: 1 }),
    premium: Object.freeze({ id: "11", name: "Premium", normalized: "PREMIUM_CAR", baseFare: 170, perKm: 55, perMinute: 2.8, minimumFare: 340, offerSpread: 0.13, etaOffset: 2 }),
  }) }),
  quickride: Object.freeze({ mode: "upfront", contextSensitivity: 0.024, etaBase: 7, categories: Object.freeze({
    bike: Object.freeze({ id: "bike", name: "Bike", normalized: "BIKE", baseFare: 50, perKm: 18, perMinute: 1, minimumFare: 110, etaOffset: -1 }),
    rickshaw: Object.freeze({ id: "rickshaw", name: "Rickshaw", normalized: "RICKSHAW", baseFare: 70, perKm: 25, perMinute: 1.3, minimumFare: 140, etaOffset: 0 }),
    mini: Object.freeze({ id: "mini", name: "Mini", normalized: "ECONOMY_CAR", baseFare: 90, perKm: 30, perMinute: 1.6, minimumFare: 190, etaOffset: 1 }),
    car: Object.freeze({ id: "car", name: "Car", normalized: "STANDARD_CAR", baseFare: 110, perKm: 38, perMinute: 2, minimumFare: 230, etaOffset: 1 }),
  }) }),
  urbancab: Object.freeze({ mode: "upfront", contextSensitivity: 0.021, etaBase: 4, categories: Object.freeze({
    bike: Object.freeze({ id: "bike", name: "Bike", normalized: "BIKE", baseFare: 70, perKm: 22, perMinute: 1.2, minimumFare: 130, etaOffset: -1 }),
    rickshaw: Object.freeze({ id: "rickshaw", name: "Rickshaw", normalized: "RICKSHAW", baseFare: 90, perKm: 30, perMinute: 1.6, minimumFare: 160, etaOffset: 0 }),
    mini: Object.freeze({ id: "mini", name: "Mini", normalized: "ECONOMY_CAR", baseFare: 110, perKm: 38, perMinute: 2, minimumFare: 210, etaOffset: 1 }),
    car: Object.freeze({ id: "car", name: "Car", normalized: "STANDARD_CAR", baseFare: 130, perKm: 48, perMinute: 2.6, minimumFare: 270, etaOffset: 1 }),
  }) }),
});

function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function roundFare(value) { return Math.max(0, Math.round(Number.isFinite(value) ? value : 0)); }

function contextFrom({ context, observedAt = 0 } = {}) {
  if (context && Number.isFinite(Number(context.hour)) && Number.isFinite(Number(context.dayOfWeek))) {
    const day = Math.max(0, Math.min(6, Math.trunc(Number(context.dayOfWeek))));
    return { hour: Math.max(0, Math.min(23, Math.trunc(Number(context.hour)))), dayOfWeek: day, isWeekend: Boolean(context.isWeekend ?? (day === 0 || day === 6)) };
  }
  const date = new Date(observedAt);
  const day = date.getUTCDay();
  return { hour: date.getUTCHours(), dayOfWeek: day, isWeekend: day === 0 || day === 6 };
}

function contextFactor(provider, context, distanceKm, durationMin) {
  const profile = SIMULATION_CONFIG[provider] || SIMULATION_CONFIG.indrive;
  const peak = (context.hour >= 7 && context.hour <= 10) || (context.hour >= 16 && context.hour <= 19);
  const lateNight = context.hour >= 0 && context.hour <= 5;
  const speed = distanceKm > 0 ? durationMin / distanceKm : 0;
  const congestion = speed > 4.5 ? Math.min(0.045, (speed - 4.5) * 0.008) : 0;
  return 1 + (peak ? profile.contextSensitivity : 0) + (context.isWeekend ? 0.008 : 0) + (lateNight ? -0.01 : 0) + congestion;
}

function categoryFor(provider, vehicleType) {
  const profile = SIMULATION_CONFIG[provider] || SIMULATION_CONFIG.indrive;
  const category = profile.categories[String(vehicleType || "").toLowerCase()];
  return category ? { id: category.id, name: category.name, normalized: category.normalized } : { id: null, name: null, normalized: "UNKNOWN" };
}

function calculateSimulatedFare({ provider, vehicleType, rate, route, observedAt = 0, context } = {}) {
  const profile = SIMULATION_CONFIG[provider] || SIMULATION_CONFIG.indrive;
  const category = (SIMULATION_CONFIG[provider] || SIMULATION_CONFIG.indrive).categories[String(vehicleType || "").toLowerCase()] || categoryFor(provider, vehicleType);
  const distanceKm = Math.max(0, finite(route?.distanceMeters) / 1000);
  const durationMin = Math.max(0, finite(route?.durationSeconds) / 60);
  const simulationContext = contextFrom({ context, observedAt });
  const baseFare = Math.max(0, finite(category.baseFare ?? rate?.base_fare));
  const perKm = Math.max(0, finite(category.perKm ?? rate?.per_km_rate));
  const perMinute = Math.max(0, finite(category.perMinute ?? rate?.per_min_rate));
  const minimumFare = Math.max(0, finite(category.minimumFare ?? rate?.minimum_fare));
  const routeCost = baseFare + distanceKm * perKm + durationMin * perMinute;
  const factor = contextFactor(provider, simulationContext, distanceKm, durationMin);
  const recommendedFare = roundFare(Math.max(minimumFare, routeCost * factor));
  const etaMin = Math.max(2, Math.min(12, Math.round(profile.etaBase + (category.etaOffset || 0) + (simulationContext.isWeekend ? 1 : 0))));
  const breakdown = { baseFare, distanceFare: roundFare(distanceKm * perKm), timeFare: roundFare(durationMin * perMinute), routeCost: roundFare(routeCost), contextFactor: Number(factor.toFixed(4)), recommendedFare };
  const result = { providerId: provider, providerCategoryId: category.id, providerCategoryName: category.name, normalizedCategory: category.normalized, fare: recommendedFare, fareRecommended: recommendedFare, fareMin: null, fareMax: null, currency: "PKR", fareType: provider === "indrive" ? "RECOMMENDED" : "ESTIMATE", pickupEtaSeconds: etaMin * 60, isAvailable: true, metadata: { simulated: true, dataSource: "SIMULATED", model: "FAIR_FARE_SIMULATION_V2", context: simulationContext, breakdown } };
  if (provider === "indrive") {
    const spread = category.offerSpread || 0.15;
    const min = roundFare(Math.max(minimumFare, recommendedFare * (1 - spread)));
    const max = roundFare(recommendedFare * (1 + spread));
    result.fareMin = min;
    result.fareMax = Math.max(min, max);
    result.metadata = { ...result.metadata, semantics: "RECOMMENDED_AUTOFILL_WITH_ADJUSTABLE_BOUNDARIES", priceSteps: { down: min, recommended: recommendedFare, up: result.fareMax } };
  }
  return result;
}

function calibrationMatrix({ context = { hour: 13, dayOfWeek: 2, isWeekend: false } } = {}) {
  const routes = { SHORT: [3, 10], MEDIUM: [8, 25], LONG: [15, 45], HEAVY_TRAFFIC: [8, 40] };
  return Object.entries(routes).flatMap(([scenario, [distanceKm, durationMin]]) => Object.keys(SIMULATION_CONFIG).flatMap((provider) => Object.keys(SIMULATION_CONFIG[provider].categories).map((vehicleType) => {
    const quote = calculateSimulatedFare({ provider, vehicleType, route: { distanceMeters: distanceKm * 1000, durationSeconds: durationMin * 60 }, context });
    return { scenario, provider, vehicleType, fare: quote.fare, fareMin: quote.fareMin, fareMax: quote.fareMax, pickupEtaMin: quote.pickupEtaSeconds / 60 };
  })));
}

module.exports = { SIMULATION_CONFIG, contextFrom, contextFactor, categoryFor, calculateSimulatedFare, calibrationMatrix };
