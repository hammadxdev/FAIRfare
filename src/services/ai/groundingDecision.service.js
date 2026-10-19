const DECISIONS = Object.freeze({
  MATCHED_COMPARISON: "MATCHED_COMPARISON",
  ROUTE_CHANGED: "ROUTE_CHANGED",
  LOCATION_UNRESOLVED: "LOCATION_UNRESOLVED",
  NEW_COMPARISON_READY: "NEW_COMPARISON_READY",
  FARES_UNAVAILABLE: "FARES_UNAVAILABLE",
});

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function locationOf(value) {
  if (!value) return null;
  const lat = numeric(value.lat ?? value.latitude);
  const lng = numeric(value.lng ?? value.longitude);
  return {
    placeId: value.placeId || value.id || null,
    lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    lng: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null,
  };
}

function sameCoordinate(left, right) {
  return left !== null && right !== null && Math.abs(left - right) <= 1e-6;
}

function sameLocation(left, right) {
  const a = locationOf(left);
  const b = locationOf(right);
  if (!a || !b) return false;
  if (a.placeId && b.placeId) return String(a.placeId) === String(b.placeId);
  return sameCoordinate(a.lat, b.lat) && sameCoordinate(a.lng, b.lng);
}

function routeMatchesComparison(trip, comparison) {
  if (!trip || !comparison) return false;
  return sameLocation(trip.pickup, comparison.pickup) &&
    sameLocation(trip.destination, comparison.dropoff || comparison.destination);
}

function comparisonIsFresh(comparison) {
  if (!comparison) return false;
  if (comparison.enrichmentStatus && comparison.enrichmentStatus !== "current") return false;
  if (comparison.expiresAt && Date.parse(comparison.expiresAt) <= Date.now()) return false;
  return true;
}

function comparisonIdOf(comparison) {
  return comparison?.comparisonId || comparison?.id || null;
}

function hasRouteIntent(trip) {
  return Boolean(trip?.extracted?.pickup || trip?.extracted?.destination || trip?.pickup || trip?.destination || trip?.source === "current_message");
}

function decideGrounding({ trip, comparison } = {}) {
  if (trip?.status === "UNRESOLVED" || trip?.status === "NO_TRIP" && hasRouteIntent(trip)) {
    return { decision: DECISIONS.LOCATION_UNRESOLVED, comparisonId: null };
  }
  if (trip?.status === "ROUTE_UNAVAILABLE" || trip?.status === "CROSS_CITY") {
    return { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null };
  }
  if (comparison && routeMatchesComparison(trip, comparison)) {
    return comparisonIsFresh(comparison)
      ? { decision: DECISIONS.MATCHED_COMPARISON, comparisonId: comparisonIdOf(comparison) }
      : { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null };
  }
  if (comparison && comparisonIsFresh(comparison) && !hasRouteIntent(trip)) {
    return { decision: DECISIONS.MATCHED_COMPARISON, comparisonId: comparisonIdOf(comparison) };
  }
  if (comparison && !comparisonIsFresh(comparison) && !hasRouteIntent(trip)) return { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null };
  if (hasRouteIntent(trip)) return { decision: DECISIONS.ROUTE_CHANGED, comparisonId: null };
  return { decision: DECISIONS.FARES_UNAVAILABLE, comparisonId: null };
}

module.exports = { DECISIONS, decideGrounding, routeMatchesComparison, sameLocation, comparisonIsFresh };
