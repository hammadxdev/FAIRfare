// Single editable policy for FairFare AI behavior. Keep facts and safety rules
// here so prompts, validators, and deterministic fallbacks cannot drift apart.
const FAIRFARE_POLICY = Object.freeze({
  domain: "Pakistan travel, rides, fares, routes, providers, and FairFare help",
  providers: Object.freeze(["indrive", "yango", "bykea"]),
  languages: Object.freeze(["english", "urdu", "roman_urdu"]),
  neverInvent: Object.freeze(["fares", "coordinates", "distance", "duration", "availability", "driver_count", "eta"]),
  liveFareSources: Object.freeze(["REAL", "live", "provider_live"]),
  routeSource: "geoapify",
  bookingMutationsAllowed: false,
  maxClarifications: 1,
});

module.exports = { FAIRFARE_POLICY };
