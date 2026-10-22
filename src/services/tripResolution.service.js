const maps = require("./maps/geoapifyMaps.service");
const { extractTripLocations } = require("./tripExtraction.service");

function cityOf(candidate) { return candidate?.city || candidate?.town || candidate?.municipality || null; }
function administrativeContextOf(candidate) {
  // Country/state are too broad to prove that two localities share a city.
  // County/district/municipality are the useful boundary signals here.
  return [candidate?.county, candidate?.district, candidate?.municipality]
    .map((value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
}
function normalizedAdministrativeValue(value) {
  return String(value || "").toLowerCase().replace(/\b(?:district|division|tehsil|city)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function sameAdministrativeContext(left, right) {
  const leftContext = administrativeContextOf(left).map(normalizedAdministrativeValue).filter(Boolean);
  const rightContext = administrativeContextOf(right).map(normalizedAdministrativeValue).filter(Boolean);
  return leftContext.length > 0 && rightContext.length > 0 && leftContext.some((value) => rightContext.some((other) => value === other || value.includes(other) || other.includes(value)));
}
function isGenericLocationQuery(query) {
  return /^(?:the\s+)?(?:airport|railway\s+station|station|saddar|gulberg|chungi|lgu)$/i.test(String(query || "").trim());
}
function cityHintFromText(value) {
  const text = normalizedText(value);
  const city = ["karachi", "lahore", "islamabad", "rawalpindi", "faisalabad", "multan", "peshawar", "quetta", "hyderabad"].find((item) => new RegExp(`\\b${item}\\b`, "i").test(text));
  return city ? city.replace(/^./, (letter) => letter.toUpperCase()) : null;
}
function cityPreferenceFromLocation(location) {
  const city = cityOf(location);
  if (city && !/(?:tehsil|division|district)$/i.test(city)) return String(city).replace(/\s+cant$/i, "").trim();
  const county = location?.county || location?.district || null;
  return county ? String(county).replace(/\s+(?:district|division|tehsil)$/i, "").trim() : city;
}
function normalizeCandidate(candidate, query) {
  if (!candidate || !Number.isFinite(Number(candidate.lat)) || !Number.isFinite(Number(candidate.lng))) return null;
  const resultType = candidate.resultType || candidate.result_type || null;
  const rawName = candidate.mainText || candidate.name || candidate.description || query;
  const name = /^lahore\s+garission\s+university$/i.test(String(rawName).trim()) ? "Lahore Garrison University" : rawName;
  return { query, placeId: candidate.placeId || null, name, address: candidate.address || candidate.secondaryText || candidate.description || query, city: cityOf(candidate), county: candidate.county || candidate.district || null, state: candidate.state || candidate.state_district || null, countryCode: candidate.countryCode || candidate.country_code || null, resultType, category: candidate.category || null, confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null, approximate: /city|town|municipality|district|suburb|neighbourhood|locality|street|road|address/i.test(String(resultType || "")), lat: Number(candidate.lat), lng: Number(candidate.lng), source: "geoapify" };
}
function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/\bgulberg\s+iii\b/g, "gulberg 3").replace(/\bgarission\b/g, "garrison").replace(/\blgu\b/g, "lahore garrison university").replace(/[-\s]+/g, " ").trim();
}
function queryVariants(query) {
  const original = String(query || "").trim();
  const variants = [original];
  if (/\bgulberg\s+iii\b/i.test(original)) variants.push(original.replace(/\bgulberg\s+iii\b/i, "Gulberg 3"));
  if (/\bgulberg\s+3\b/i.test(original)) variants.push(original.replace(/\bgulberg\s+3\b/i, "Gulberg III"));
  if (/^lgu(?:,\s*lahore)?$/i.test(original)) {
    variants.push("Lahore Garrison University");
    variants.push("Lahore Garission University");
  }
  if (/lahore\s+garrison\s+university/i.test(original)) variants.push(original.replace(/garrison/i, "Garission"));
  return [...new Set(variants)];
}
function tokenMatches(queryToken, candidateTokens) {
  return candidateTokens.some((token) => token === queryToken || token.startsWith(queryToken) || (queryToken.length >= 6 && token.length >= 6 && levenshtein(queryToken, token) <= 2));
}
function isAreaLikeQuery(query) {
  return /\b(?:gulberg|gulshan|saddar|dha|johar|town|phase|garden|nazimabad|cantt|model town|liberty|chungi)\b/i.test(String(query || ""));
}
function levenshtein(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j += 1) { const current = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1)); previous = current; }
  }
  return row[right.length];
}
function selectCandidate(query, candidates = [], options = {}) {
  const normalized = normalizedText(query);
  const usable = candidates.map((item) => normalizeCandidate(item, query)).filter(Boolean);
  if (!usable.length) return { location: null, ambiguous: false, diagnostics: [] };
  const queryTokens = normalized.split(" ").filter(Boolean);
  const scored = usable.map((item, index) => {
    const nameText = normalizedText(item.name);
    const addressText = normalizedText(item.address);
    const candidateTokens = `${nameText} ${addressText}`.split(" ").filter(Boolean);
    const coverage = queryTokens.length ? queryTokens.filter((token) => tokenMatches(token, candidateTokens)).length / queryTokens.length : 0;
    const nameTokens = nameText.split(" ").filter(Boolean);
    const nameCoverage = queryTokens.length ? queryTokens.filter((token) => tokenMatches(token, nameTokens)).length / queryTokens.length : 0;
    const exact = `${nameText} ${addressText}`.includes(normalized);
    const type = normalizedText(`${item.resultType} ${item.category}`);
    const placeLike = /city|town|municipality|district|suburb|neighbourhood|locality|street|road|address/.test(type);
    const poiLike = /commercial|service|catering|accommodation|entertainment|activity|amenity|office/.test(type);
    const cityMatch = options.preferredCity && normalizedText(item.city) === normalizedText(options.preferredCity);
    const confidenceBonus = item.confidence == null ? 0 : Math.round(item.confidence * 250);
    const unrelatedPoi = isAreaLikeQuery(query) && poiLike && !placeLike && nameCoverage < 1;
    const nonAreaResult = isAreaLikeQuery(query) && Boolean(item.resultType) && !placeLike && !poiLike;
    const rejected = unrelatedPoi || nonAreaResult;
    const score = rejected ? -10000 - index : (exact ? 1000 : 0) + Math.round(coverage * 500) + (cityMatch ? 350 : 0) + confidenceBonus + (placeLike ? 140 : 0) - (poiLike && !placeLike ? 180 : 0) - index;
    return { item, score, coverage, nameCoverage, exact, placeLike, unrelatedPoi, nonAreaResult, rejected };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const diagnostics = scored.map(({ item, score, coverage, nameCoverage, exact, placeLike, unrelatedPoi, nonAreaResult }) => ({ query, name: item.name, city: item.city, county: item.county, resultType: item.resultType, confidence: item.confidence, score, tokenCoverage: coverage, nameCoverage, exact, accepted: false, reason: unrelatedPoi ? "UNRELATED_POI" : nonAreaResult ? "NON_AREA_RESULT" : coverage < (queryTokens.length > 1 ? 0.75 : 0.5) ? "LOW_QUERY_MATCH" : (placeLike ? "CANDIDATE" : "POI_PENALTY") }));
  if (!best || best.rejected || best.coverage < (queryTokens.length > 1 ? 0.75 : 0.5)) return { location: null, ambiguous: usable.length > 1, reason: best?.unrelatedPoi ? "UNRELATED_POI" : best?.nonAreaResult ? "NON_AREA_RESULT" : "LOW_QUERY_MATCH", diagnostics };
  const tied = scored.filter((candidate) => Math.abs(candidate.score - best.score) < 80);
  const equivalentAreaMatches = tied.length > 1 && tied.every((candidate) => normalizedText(candidate.item.name) === normalizedText(best.item.name) && normalizedText(candidate.item.county) === normalizedText(best.item.county) && normalizedText(candidate.item.resultType) === normalizedText(best.item.resultType));
  const acceptedDiagnostic = diagnostics.find((item) => item.name === best.item.name && item.score === best.score);
  if (acceptedDiagnostic) acceptedDiagnostic.accepted = true;
  return { location: best.item, ambiguous: (!equivalentAreaMatches && tied.length > 1) || (best.coverage < 1 && usable.length > 1), diagnostics };
}
async function geocodeWithFallback({ query, geocode, lat, lng, preferredCity }) {
  let all = [];
  let lastResult = { location: null, ambiguous: false, reason: "NO_CANDIDATES" };
  const variants = queryVariants(query);
  if (preferredCity && !cityHintFromText(query)) {
    for (const variant of [...variants]) variants.push(`${variant}, ${preferredCity}`);
  }
  for (const variant of [...new Set(variants)]) {
    // A spelling/full-name fallback must not be narrowed by the previous
    // endpoint's proximity bias; that bias can hide a legitimate landmark
    // several kilometres away while the original query is unresolved.
    const response = await geocode({ input: variant, lat: variant === query ? lat : null, lng: variant === query ? lng : null });
    all = all.concat(response || []);
    lastResult = selectCandidate(query, all, { preferredCity });
    if (lastResult.location && !lastResult.ambiguous) return { ...lastResult, queries: [...new Set(variants)], candidates: all };
  }
  return { ...lastResult, queries: [...new Set(variants)], candidates: all };
}
async function resolveTripForAssistant({ message, semantic, geocode = maps.fetchAutocomplete, route = maps.computeRoute } = {}) {
  const extracted = semantic && (semantic.pickup || semantic.destination)
    ? { pickup: semantic.pickup?.query || null, destination: semantic.destination?.query || null }
    : extractTripLocations(message);
  const explicitIntercity = /\b(?:intercity|inter-city|between\s+different\s+cities|explicitly\s+(?:want|need)|city[- ]to[- ]city)\b/i.test(String(message || ""));
  if (!extracted.pickup || !extracted.destination) return { status: "NO_TRIP", extracted };
  let pickupSelected = await geocodeWithFallback({ query: extracted.pickup, geocode, preferredCity: cityHintFromText(extracted.destination) });
  const destinationSelected = await geocodeWithFallback({ query: extracted.destination, geocode, lat: pickupSelected.location?.lat, lng: pickupSelected.location?.lng, preferredCity: cityHintFromText(extracted.destination) || cityPreferenceFromLocation(pickupSelected.location) });
  if (!pickupSelected.location && destinationSelected.location) {
    pickupSelected = await geocodeWithFallback({ query: extracted.pickup, geocode, preferredCity: cityPreferenceFromLocation(destinationSelected.location) });
  }
  const ambiguousPickup = pickupSelected.ambiguous && isGenericLocationQuery(extracted.pickup);
  const ambiguousDestination = destinationSelected.ambiguous && isGenericLocationQuery(extracted.destination);
  if (!pickupSelected.location || ambiguousPickup || !destinationSelected.location || ambiguousDestination) {
    const pickupUnresolved = !pickupSelected.location || ambiguousPickup;
    return {
      status: "UNRESOLVED",
      extracted,
      pickup: pickupSelected.location,
      destination: destinationSelected.location,
      unresolved: pickupUnresolved ? "pickup" : "destination",
      unresolvedReason: pickupUnresolved ? (ambiguousPickup ? "AMBIGUOUS" : (pickupSelected.reason || "NOT_FOUND")) : (ambiguousDestination ? "AMBIGUOUS" : (destinationSelected.reason || "NOT_FOUND")),
    };
  }
  const cityMismatch = pickupSelected.location.city && destinationSelected.location.city && pickupSelected.location.city.toLowerCase() !== destinationSelected.location.city.toLowerCase() && !sameAdministrativeContext(pickupSelected.location, destinationSelected.location);
  let routeResult = null;
  try { routeResult = await route({ origin: pickupSelected.location, destination: destinationSelected.location, vehicleType: "car" }); } catch (error) { routeResult = { unavailable: true, reason: error.code || "ROUTE_UNAVAILABLE" }; }
  return { status: cityMismatch ? "CROSS_CITY" : routeResult?.unavailable ? "ROUTE_UNAVAILABLE" : "RESOLVED", extracted, pickup: pickupSelected.location, destination: destinationSelected.location, pickupAmbiguous: pickupSelected.ambiguous, destinationAmbiguous: destinationSelected.ambiguous, city: cityMismatch ? null : pickupSelected.location.city, cityMismatch, explicitIntercity, route: routeResult };
}
module.exports = { cityOf, administrativeContextOf, sameAdministrativeContext, isGenericLocationQuery, cityHintFromText, cityPreferenceFromLocation, normalizeCandidate, normalizedText, queryVariants, selectCandidate, geocodeWithFallback, resolveTripForAssistant };
