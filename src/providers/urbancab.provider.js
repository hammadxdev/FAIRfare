const { calculateFare } = require("./formula");

// Simulated pickup wait time (driver-to-rider ETA) per vehicle type.
const PICKUP_ETA_MIN = {
  bike: 3,
  rickshaw: 4,
  mini: 5,
  car: 6,
};

function getPickupEtaMin(vehicleType) {
  return PICKUP_ETA_MIN[vehicleType] ?? 4;
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
  name: "urbancab",
  mode: "simulated",
  getFareQuote,
  getPickupEtaMin,
};
