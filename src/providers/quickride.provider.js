const { calculateFare } = require("./formula");

// Simulated pickup wait time (driver-to-rider ETA) per vehicle type.
const PICKUP_ETA_MIN = {
  bike: 6,
  rickshaw: 7,
  mini: 8,
  car: 9,
};

function getPickupEtaMin(vehicleType) {
  return PICKUP_ETA_MIN[vehicleType] ?? 7;
}

function getFareQuote({ rate, distanceKm, durationMin }) {
  return calculateFare({
    baseFare: rate.base_fare,
    perKmRate: rate.per_km_rate,
    perMinRate: rate.per_min_rate,
    minimumFare: rate.minimum_fare,
    surgeMultiplier: rate.surge_multiplier,
    distanceKm,
    durationMin,
  });
}

module.exports = {
  name: "quickride",
  mode: "simulated",
  getFareQuote,
  getPickupEtaMin,
};
