// Shared pure fare formula used by all simulated provider adapters.
// A real provider adapter would replace calculateFare's body with an API call
// but keep the same return shape so fare.service.js needs no changes.
function calculateFare({ baseFare, perKmRate, perMinRate, minimumFare, surgeMultiplier, distanceKm, durationMin }) {
  const distanceFare = distanceKm * perKmRate;
  const timeFare = durationMin * perMinRate;
  const rawFare = (baseFare + distanceFare + timeFare) * surgeMultiplier;
  const finalFare = Math.max(rawFare, minimumFare);

  return {
    finalFare: Math.round(finalFare),
    breakdown: {
      baseFare: Math.round(baseFare),
      distanceFare: Math.round(distanceFare),
      timeFare: Math.round(timeFare),
      surgeMultiplier,
      minimumFare: Math.round(minimumFare),
      finalFare: Math.round(finalFare),
    },
  };
}

module.exports = { calculateFare };
