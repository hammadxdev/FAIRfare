// Decodes a Google encoded polyline string into React Native Maps'
// `{ latitude, longitude }[]` coordinate shape.
// Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function decodePolyline(encoded) {
  if (!encoded) return [];

  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return coordinates;
}

function haversineMeters(a, b) {
  if (![a?.latitude, a?.longitude, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.latitude);
  const dLng = radians(b.lng - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validateRouteCoordinates(points, origin, destination, distanceMeters, durationSeconds) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return { valid: false, reason: "invalid-distance" };
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { valid: false, reason: "invalid-duration" };
  if (!Array.isArray(points) || points.length < 2) return { valid: false, reason: "empty-or-too-few-points" };
  if (!points.every((point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180)) {
    return { valid: false, reason: "invalid-coordinate" };
  }
  const startSnapMeters = haversineMeters(points[0], origin);
  const endSnapMeters = haversineMeters(points[points.length - 1], destination);
  if (startSnapMeters === null || endSnapMeters === null) return { valid: false, reason: "invalid-endpoint" };
  const endpointDistance = haversineMeters({ latitude: origin.lat, longitude: origin.lng }, destination);
  const toleranceMeters = Math.min(5000, Math.max(2000, endpointDistance * 0.25));
  const valid = startSnapMeters <= toleranceMeters && endSnapMeters <= toleranceMeters;
  return {
    valid,
    reason: valid ? null : "endpoint-snap-too-far",
    startSnapMeters,
    endSnapMeters,
    toleranceMeters,
  };
}

module.exports = { decodePolyline, validateRouteCoordinates };
