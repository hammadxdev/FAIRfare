/**
 * Deterministic product rules for ranking the current comparison set.
 *
 * This is intentionally separate from rideRecommendation.service.js:
 * - this service matches current quotes to the logged-in user's preferences;
 * - rideRecommendation compares a current fare with the global ML expected fare.
 *
 * Scores are normalized within the current comparison set. They are product
 * rules for the prototype, not scientifically optimized probabilities.
 */
const { normalizeVehicleType } = require("./vehicleType.service");

const PRIORITY_WEIGHTS = Object.freeze({
  CHEAPEST: Object.freeze({ fare: 0.7, eta: 0.1, preferred: 0.15, budget: 0.05 }),
  FASTEST_PICKUP: Object.freeze({ fare: 0.1, eta: 0.7, preferred: 0.15, budget: 0.05 }),
  BALANCED: Object.freeze({ fare: 0.4, eta: 0.3, preferred: 0.2, budget: 0.1 }),
});

const DEFAULT_PRIORITY = "BALANCED";
const DEFAULT_PREFERENCES = Object.freeze({
  preferredVehicleType: null,
  avoidedVehicleTypes: [],
  typicalBudget: null,
  ridePriority: DEFAULT_PRIORITY,
});

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizePreferences(input = {}) {
  return {
    ...DEFAULT_PREFERENCES,
    ...input,
    avoidedVehicleTypes: Array.isArray(input.avoidedVehicleTypes) ? input.avoidedVehicleTypes : [],
    ridePriority: PRIORITY_WEIGHTS[input.ridePriority] ? input.ridePriority : DEFAULT_PRIORITY,
  };
}

function quoteForResult(result, requestedVehicleType) {
  return result.quotes?.find((quote) => finitePositive(quote.fare)) || {
    ...result,
    categoryId: requestedVehicleType,
    categoryName: requestedVehicleType,
    pickupEtaSeconds: result.etaMin == null ? null : result.etaMin * 60,
  };
}

function vehicleTypeFor(result, requestedVehicleType) {
  const quote = quoteForResult(result, requestedVehicleType);
  const categoryId = quote.categoryId == null ? "" : String(quote.categoryId).trim().toUpperCase();
  const categoryName = quote.categoryName == null ? "" : String(quote.categoryName).trim().toUpperCase();
  const canonicalByName = {
    BIKE: "BIKE",
    MOTO: "BIKE",
    RICKSHAW: "RICKSHAW",
    "ECONOMY CAR": "ECONOMY_CAR",
    MINI: "ECONOMY_CAR",
    "STANDARD CAR": "STANDARD_CAR",
    CAR: "STANDARD_CAR",
    "PREMIUM CAR": "PREMIUM_CAR",
  };
  // Normalized quote data may already carry a canonical category. Prefer it
  // when present; the vehicleType service still handles provider-specific IDs.
  if (result.provider?.name !== "indrive" && ["BIKE", "RICKSHAW", "ECONOMY_CAR", "STANDARD_CAR", "PREMIUM_CAR", "OTHER"].includes(categoryId)) return categoryId;
  if (result.provider?.name !== "indrive" && canonicalByName[categoryName]) return canonicalByName[categoryName];
  return normalizeVehicleType({
    provider: result.provider?.name,
    providerCategoryId: quote.categoryId,
    providerCategoryName: quote.categoryName,
    requestedVehicleType,
  });
}

function normalizeDimension(value, min, max, invert = false) {
  if (max === min) return 1;
  const normalized = (value - min) / (max - min);
  return Number((invert ? 1 - normalized : normalized).toFixed(6));
}

function stableIdentifier(result, requestedVehicleType) {
  const quote = quoteForResult(result, requestedVehicleType);
  return `${result.provider?.id ?? result.provider?.name ?? ""}/${quote.categoryId ?? quote.categoryName ?? requestedVehicleType ?? ""}`.toUpperCase();
}

function formatBudget(budget) {
  return Number.isInteger(budget) ? String(budget) : budget.toFixed(2);
}

function rankPersonalizedRides({ results = [], preferences = {}, requestedVehicleType } = {}) {
  const normalizedPreferences = normalizePreferences(preferences);
  const weights = PRIORITY_WEIGHTS[normalizedPreferences.ridePriority];
  const avoided = new Set(normalizedPreferences.avoidedVehicleTypes.map((value) => String(value).toUpperCase()));
  const working = results.map((result, index) => {
    const fare = result.fare;
    const vehicleType = vehicleTypeFor(result, requestedVehicleType);
    const quote = quoteForResult(result, requestedVehicleType);
    const etaMin = finitePositive(result.etaMin)
      ? result.etaMin
      : finitePositive(quote.pickupEtaSeconds) ? quote.pickupEtaSeconds / 60 : null;
    const validFare = finitePositive(fare);
    const withinBudget = normalizedPreferences.typicalBudget == null || (validFare && fare <= normalizedPreferences.typicalBudget);
    const budgetDifference = normalizedPreferences.typicalBudget == null || !validFare
      ? null
      : Number((normalizedPreferences.typicalBudget - fare).toFixed(2));
    const preferredVehicleMatch = Boolean(normalizedPreferences.preferredVehicleType && vehicleType === normalizedPreferences.preferredVehicleType);
    const excluded = avoided.has(vehicleType);
    return { result, index, fare, etaMin, vehicleType, validFare, withinBudget, budgetDifference, preferredVehicleMatch, excluded };
  });

  const eligible = working.filter((item) => item.validFare && !item.excluded);
  const fares = eligible.map((item) => item.fare);
  const fareMin = fares.length ? Math.min(...fares) : null;
  const fareMax = fares.length ? Math.max(...fares) : null;
  const etaEligible = eligible.filter((item) => item.etaMin != null);
  const etaValues = etaEligible.map((item) => item.etaMin);
  const etaMin = etaValues.length ? Math.min(...etaValues) : null;
  const etaMax = etaValues.length ? Math.max(...etaValues) : null;
  const etaAvailable = etaEligible.length > 0;

  const scored = working.map((item) => {
    const personalization = {
      eligible: item.validFare && !item.excluded,
      score: null,
      isTopRecommendation: false,
      withinBudget: item.withinBudget,
      budgetDifference: item.budgetDifference,
      preferredVehicleMatch: item.preferredVehicleMatch,
      reasons: [],
    };
    if (item.excluded) {
      personalization.eligible = false;
      personalization.exclusionReason = "Vehicle type is in your avoided preferences.";
    } else if (!item.validFare) {
      personalization.eligible = false;
      personalization.exclusionReason = "Current fare is unavailable or invalid.";
    }
    if (!personalization.eligible) return { ...item, personalization };

    const fareScore = normalizeDimension(item.fare, fareMin, fareMax, true);
    const etaScore = item.etaMin == null ? null : normalizeDimension(item.etaMin, etaMin, etaMax, true);
    // If ETA is absent for every eligible quote, or for this quote, its weight
    // is redistributed over the available dimensions; missing ETA is never 0.
    const activeWeights = etaScore == null || !etaAvailable
      ? { fare: weights.fare + weights.eta, eta: 0, preferred: weights.preferred, budget: weights.budget }
      : weights;
    const rawScore = fareScore * activeWeights.fare
      + (etaScore ?? 0) * activeWeights.eta
      + (item.preferredVehicleMatch ? 1 : 0) * activeWeights.preferred
      + (item.withinBudget ? 1 : 0) * activeWeights.budget;
    personalization.score = Number(rawScore.toFixed(6));
    if (item.preferredVehicleMatch) personalization.reasons.push("Matches your preferred vehicle type.");
    if (normalizedPreferences.typicalBudget != null && item.withinBudget) personalization.reasons.push(`Within your ${normalizedPreferences.currency || "PKR"} ${formatBudget(normalizedPreferences.typicalBudget)} typical budget.`);
    if (item.fare === fareMin) personalization.reasons.push("One of the lowest-fare eligible options.");
    if (etaAvailable && item.etaMin === etaMin) personalization.reasons.push("Has a faster pickup among eligible options.");
    return { ...item, personalization };
  });

  const top = scored.filter((item) => item.personalization.eligible).sort((a, b) => {
    return b.personalization.score - a.personalization.score
      || a.fare - b.fare
      || ((a.etaMin ?? Number.POSITIVE_INFINITY) - (b.etaMin ?? Number.POSITIVE_INFINITY))
      || stableIdentifier(a.result, requestedVehicleType).localeCompare(stableIdentifier(b.result, requestedVehicleType))
      || a.index - b.index;
  })[0];
  if (top) top.personalization.isTopRecommendation = true;

  return scored.map(({ result, personalization }) => ({ ...result, personalization }));
}

module.exports = { PRIORITY_WEIGHTS, DEFAULT_PREFERENCES, rankPersonalizedRides, normalizePreferences };
