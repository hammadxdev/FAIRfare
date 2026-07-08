const EARTH_RADIUS_KM = 6371;
const ROAD_DISTANCE_FACTOR = 1.3;

const AVERAGE_SPEED_KMH = {
  bike: 24,
  rickshaw: 20,
  mini: 26,
  car: 28,
};

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

function estimateDistanceAndDuration({ pickup, dropoff, vehicleType }) {
  const straightLineKm = haversineDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  const roadDistanceKm = straightLineKm * ROAD_DISTANCE_FACTOR;

  const averageSpeedKmh = AVERAGE_SPEED_KMH[vehicleType];
  const durationMin = (roadDistanceKm / averageSpeedKmh) * 60;

  return {
    distanceKm: Math.round(roadDistanceKm * 10) / 10,
    durationMin: Math.round(durationMin),
  };
}

module.exports = { estimateDistanceAndDuration, haversineDistanceKm, AVERAGE_SPEED_KMH };
