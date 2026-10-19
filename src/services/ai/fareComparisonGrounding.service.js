const { canonicalProviderId, providerDisplayName } = require("../../providers/provider.registry");

const PASSENGER_EXCLUSIONS = /courier|cargo|delivery|express|intercity|ndd_|sdd_|virtual/i;
const BIKE = /bike|moto|motorcycle|scoot|2[- ]?wheel/i;
const RICKSHAW = /rickshaw|tuktuk|tuk[- ]?tuk/i;
const SAFE_PROVIDER_IDS = new Set(["indrive", "quickride", "urbancab"]);

function positiveNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function providerInfo(result) {
  const provider = result?.provider && typeof result.provider === "object" ? result.provider : {};
  const candidates = [provider.code, provider.providerCode, provider.name, provider.displayName, result?.providerCode, result?.providerId, result?.providerName, result?.provider];
  let id = null;
  for (const candidate of candidates) {
    const value = canonicalProviderId(candidate);
    if (value) { id = value; break; }
  }
  const rawName = provider.displayName || provider.name || result?.providerName || result?.provider || id;
  const normalizedName = providerDisplayName(id) || (/^yango$/i.test(String(rawName)) ? "Yango" : /^quickride$/i.test(String(rawName)) ? "Yango" : /^urbancab$/i.test(String(rawName)) ? "Bykea" : /^indrive$/i.test(String(rawName)) ? "inDrive" : String(rawName || "Provider"));
  if (!id && /^yango$/i.test(normalizedName)) id = "quickride";
  if (!id && /^bykea$/i.test(normalizedName)) id = "urbancab";
  if (!id && /^indrive$/i.test(normalizedName)) id = "indrive";
  return { id, name: normalizedName };
}

function isPassenger(quote) {
  const value = [quote?.categoryType, quote?.categoryName, quote?.normalizedCategory, quote?.vehicleType].filter(Boolean).join(" ");
  return !PASSENGER_EXCLUSIONS.test(value);
}

function isStale(quote, now) {
  if (quote?.expiresAt) {
    const expiry = Date.parse(quote.expiresAt);
    if (Number.isFinite(expiry) && expiry <= now) return true;
  }
  const quotedAt = quote?.quotedAt ? Date.parse(quote.quotedAt) : NaN;
  const ttl = positiveNumber(quote?.metadata?.providerTtlSeconds ?? quote?.freshnessTtlSeconds);
  return Number.isFinite(quotedAt) && ttl !== null && quotedAt + ttl * 1000 <= now;
}

function optionFromQuote(quote, provider, result, now) {
  if (!quote || typeof quote !== "object" || !isPassenger(quote)) return null;
  const uncategorized = !quote.categoryId && !quote.categoryName;
  const legacyProviderSnapshot = uncategorized && !quote.source && !quote.dataSource && !result?.source && !result?.dataSource && !result?.metadata?.dataSource;
  const exactFare = positiveNumber(quote.exactFare ?? quote.providerFinalFare);
  const fare = positiveNumber(quote.fare ?? result?.fare);
  const displayFare = positiveNumber(quote.displayFare);
  const startingFare = positiveNumber(quote.startingFare);
  const dataSource = String(quote.dataSource || quote.metadata?.dataSource || result?.dataSource || result?.metadata?.dataSource || "UNKNOWN").toUpperCase();
  const source = String(quote.source || quote.metadata?.source || result?.source || "").toLowerCase();
  const liveData = (source === "live" || dataSource === "REAL") && dataSource !== "SIMULATED";
  const suggested = provider.id === "indrive" || String(quote.priceType || quote.fareType || "").toLowerCase() === "suggested" || quote.isNegotiable === true;
  const verifiedExact = !suggested && exactFare !== null && liveData;
  // Legacy snapshots predate per-quote provenance and contain one provider-level
  // fare. Keep it displayable for old history, but never let it rank as a
  // vehicle/category quote (see comparable()). Current quotes still require
  // explicit provenance before they can ground a fare.
  const comparisonFare = legacyProviderSnapshot
    ? fare
    : verifiedExact ? exactFare : suggested && fare !== null && liveData ? fare : null;
  const unavailable = quote.isAvailable === false || quote.availability === "unavailable" || Boolean(quote.availabilityReason?.code) && quote.isAvailable === false;
  const stale = isStale(quote, now);
  const available = !unavailable && !stale && comparisonFare !== null;
  // Older comparison snapshots may contain one provider-level fare without a
  // category. Preserve it as an explicitly uncategorized total for display,
  // but never let it win a vehicle-specific ranking.
  return {
    providerId: provider.id,
    provider: provider.name,
    categoryId: quote.categoryId == null ? null : String(quote.categoryId),
    categoryName: String(quote.categoryName || quote.normalizedCategory || quote.vehicleType || (uncategorized ? "Provider total" : "Vehicle")),
    fare: comparisonFare,
    exactFare: verifiedExact ? exactFare : null,
    displayFare,
    startingFare,
    currency: String(quote.currency || result?.currency || "PKR").toUpperCase(),
    priceType: suggested ? "suggested" : verifiedExact ? "exact" : "unavailable",
    isNegotiable: suggested,
    source: source || (dataSource === "REAL" ? "live" : "unknown"),
    dataSource,
    availability: available ? "available" : "unavailable",
    availabilityReason: quote.availabilityReason?.code || (stale ? "QUOTE_STALE" : unavailable ? "PROVIDER_UNAVAILABLE" : "EXACT_FARE_UNAVAILABLE"),
    isCheapest: quote.isCheapest === true,
    isFastest: quote.isFastest === true,
    quoteSemantics: quote.quoteSemantics || null,
    stale,
    prediction: result?.prediction ? { status: result.prediction.status || null, predictedFare: positiveNumber(result.prediction.predictedFare), dataSource: result.prediction.dataSource || null } : null,
    bookWait: result?.recommendation ? { status: result.recommendation.status || null, currentFare: positiveNumber(result.recommendation.currentFare), expectedFare: positiveNumber(result.recommendation.expectedFare), reason: result.recommendation.reason || null, modelDataSource: result.recommendation.modelDataSource || null } : null,
    personalization: result?.personalization ? { eligible: result.personalization.eligible, isTopRecommendation: result.personalization.isTopRecommendation, withinBudget: result.personalization.withinBudget, preferredVehicleMatch: result.personalization.preferredVehicleMatch, reasons: Array.isArray(result.personalization.reasons) ? result.personalization.reasons.slice(0, 4) : [], exclusionReason: result.personalization.exclusionReason || null } : null,
  };
}

function buildGroundedComparison(comparison, { now = Date.now() } = {}) {
  if (!comparison || typeof comparison !== "object") return null;
  const results = Array.isArray(comparison.results) ? comparison.results : [];
  const byProvider = new Map();
  for (const result of results) {
    const provider = providerInfo(result);
    if (!SAFE_PROVIDER_IDS.has(provider.id)) continue;
    const quotes = Array.isArray(result.quotes) && result.quotes.length ? result.quotes : [result];
    const options = quotes.map((quote) => optionFromQuote(quote, provider, result, now)).filter(Boolean);
    const existing = byProvider.get(provider.id) || { providerId: provider.id, provider: provider.name, options: [] };
    existing.options.push(...options);
    byProvider.set(provider.id, existing);
  }
  for (const [id, name] of [["indrive", "inDrive"], ["quickride", "Yango"], ["urbancab", "Bykea"]]) {
    if (!byProvider.has(id)) byProvider.set(id, { providerId: id, provider: name, options: [] });
  }
  const providers = [...byProvider.values()].map((item) => ({ ...item, options: item.options.filter((option, index, list) => list.findIndex((other) => other.categoryId === option.categoryId) === index) }));
  const allOptions = providers.flatMap((provider) => provider.options);
  const route = {
    pickup: comparison.pickup?.name || comparison.pickup?.label || null,
    destination: comparison.dropoff?.name || comparison.dropoff?.label || null,
    distanceKm: positiveNumber(comparison.distanceKm ?? (comparison.route?.distanceMeters == null ? null : comparison.route.distanceMeters / 1000)),
    durationMin: positiveNumber(comparison.durationMin ?? (comparison.route?.durationSeconds == null ? null : comparison.route.durationSeconds / 60)),
  };
  return { comparisonId: comparison.comparisonId || null, freshness: comparison.comparisonId ? "current_enriched_comparison" : "history_snapshot", route, providers, options: allOptions };
}

function requestedVehicle(message) {
  const text = String(message || "").toLowerCase();
  if (BIKE.test(text)) return "bike";
  if (RICKSHAW.test(text)) return "rickshaw";
  if (/car|econom|sedan|comfort/.test(text)) return "car";
  return null;
}

function comparable(option, vehicle) {
  if (!vehicle) return true;
  if (!option.categoryId && option.categoryName === "Provider total") return false;
  const label = `${option.categoryName} ${option.categoryId}`;
  if (vehicle === "bike") return BIKE.test(label);
  if (vehicle === "rickshaw") return RICKSHAW.test(label);
  return !BIKE.test(label) && !RICKSHAW.test(label);
}

function deriveFacts(grounded, message) {
  const vehicle = requestedVehicle(message);
  const candidates = grounded?.options?.filter((option) => option.availability === "available" && comparable(option, vehicle)) || [];
  const cheapest = candidates.slice().sort((a, b) => a.fare - b.fare || a.provider.localeCompare(b.provider) || String(a.categoryId).localeCompare(String(b.categoryId)))[0] || null;
  return { requestedVehicle: vehicle, cheapest: cheapest ? { provider: cheapest.provider, providerId: cheapest.providerId, category: cheapest.categoryName, fare: cheapest.fare, currency: cheapest.currency, priceType: cheapest.priceType, isNegotiable: cheapest.isNegotiable } : null, exactFareCount: grounded?.options?.filter((option) => option.exactFare !== null && option.availability === "available").length || 0, availableCount: candidates.length };
}

function deterministicSummary(grounded, message, language = "english") {
  if (!grounded) return language === "roman_urdu" ? "Is waqt verified fare comparison available nahi hai." : "A verified fare comparison is not available right now.";
  const route = grounded.route;
  const routeText = route.pickup && route.destination ? `${route.pickup} se ${route.destination}` : "your selected route";
  const lines = [];
  if (language === "roman_urdu") lines.push(`${routeText} ke liye${route.distanceKm ? ` ${route.distanceKm} km` : ""}${route.durationMin ? ` aur taqriban ${Math.round(route.durationMin)} min` : ""}:`);
  else lines.push(`For ${routeText}${route.distanceKm ? ` (${route.distanceKm} km` : ""}${route.durationMin ? `${route.distanceKm ? ", " : " ("}${Math.round(route.durationMin)} min` : ""}${route.distanceKm || route.durationMin ? ")" : ""}:`);
  for (const provider of grounded.providers) {
    const available = provider.options.filter((option) => option.availability === "available");
    if (!available.length) { lines.push(`${provider.provider}: unavailable or no verified fare.`); continue; }
    const details = available.map((option) => `${option.categoryName} ${option.currency} ${option.fare}${option.isNegotiable ? " (suggested/negotiable)" : " (exact)"}`).join(", ");
    const unavailableCount = provider.options.length - available.length;
    lines.push(`${provider.provider}: ${details}${unavailableCount ? `; ${unavailableCount} category unavailable or without a verified fare` : ""}.`);
  }
  const cheapest = deriveFacts(grounded, message).cheapest;
  if (cheapest) lines.push(language === "roman_urdu" ? `Sabse sasta comparable option ${cheapest.provider} ka ${cheapest.category} hai: ${cheapest.currency} ${cheapest.fare}${cheapest.isNegotiable ? " suggested fare hai, guaranteed nahi" : " exact provider quote hai"}. Booking se pehle provider app mein confirm karein.` : `Cheapest comparable option: ${cheapest.provider} ${cheapest.category} at ${cheapest.currency} ${cheapest.fare}${cheapest.isNegotiable ? " (suggested/negotiable, not guaranteed)" : " (verified exact provider quote)"}. Confirm the current fare in the provider app before booking.`);
  return lines.join("\n");
}

function validateReplyAgainstGrounding(reply, grounded) {
  if (!grounded || !reply) return true;
  const allowed = new Set(grounded.options.flatMap((option) => [option.fare, option.exactFare, option.displayFare, option.startingFare]).filter((value) => positiveNumber(value) !== null).map((value) => String(value)));
  const currencyAmounts = [...String(reply).matchAll(/(?:PKR|Rs\.?|₨)\s*([\d,]+(?:\.\d+)?)/gi)].map((match) => match[1].replace(/,/g, ""));
  return currencyAmounts.every((amount) => allowed.has(amount));
}

module.exports = { buildGroundedComparison, deriveFacts, deterministicSummary, requestedVehicle, validateReplyAgainstGrounding };
