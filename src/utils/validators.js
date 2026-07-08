const VEHICLE_TYPES = ["bike", "rickshaw", "mini", "car"];

function isValidNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateLocation(location, label, errors) {
  if (location === undefined || location === null || typeof location !== "object") {
    errors.push(`${label} is required`);
    return;
  }

  if (!location.name || typeof location.name !== "string" || location.name.trim() === "") {
    errors.push(`${label}.name is required`);
  }

  if (location.lat === undefined || location.lat === null || location.lat === "") {
    errors.push(`${label}.lat is required`);
  } else if (!isValidNumber(location.lat)) {
    errors.push(`${label}.lat must be a valid number`);
  }

  if (location.lng === undefined || location.lng === null || location.lng === "") {
    errors.push(`${label}.lng is required`);
  } else if (!isValidNumber(location.lng)) {
    errors.push(`${label}.lng must be a valid number`);
  }
}

function validateCompareFareRequest(body) {
  const errors = [];
  const { pickup, dropoff, vehicleType, route } = body || {};

  validateLocation(pickup, "pickup", errors);
  validateLocation(dropoff, "dropoff", errors);

  if (!vehicleType) {
    errors.push("vehicleType is required");
  } else if (!VEHICLE_TYPES.includes(vehicleType)) {
    errors.push(`vehicleType must be one of: ${VEHICLE_TYPES.join(", ")}`);
  }

  if (route !== undefined && route !== null) {
    if (typeof route !== "object") {
      errors.push("route must be an object");
    } else {
      if (!isValidNumber(route.distanceKm) || route.distanceKm <= 0) {
        errors.push("route.distanceKm must be a positive number");
      }
      if (!isValidNumber(route.durationMin) || route.durationMin <= 0) {
        errors.push("route.durationMin must be a positive number");
      }
    }
  }

  return errors;
}

function isValidLat(lat) {
  return isValidNumber(lat) && lat >= -90 && lat <= 90;
}

function isValidLng(lng) {
  return isValidNumber(lng) && lng >= -180 && lng <= 180;
}

function validateAutocompleteQuery(query) {
  const errors = [];
  if (typeof query.input !== "string") {
    errors.push("input is required");
  }
  if (!query.sessionToken || typeof query.sessionToken !== "string") {
    errors.push("sessionToken is required");
  }
  return errors;
}

function validatePlaceDetailsQuery(query) {
  const errors = [];
  if (!query.placeId || typeof query.placeId !== "string") {
    errors.push("placeId is required");
  }
  if (!query.sessionToken || typeof query.sessionToken !== "string") {
    errors.push("sessionToken is required");
  }
  return errors;
}

function validateReverseGeocodeQuery(query) {
  const errors = [];
  const lat = Number(query.lat);
  const lng = Number(query.lng);

  if (query.lat === undefined || !isValidLat(lat)) {
    errors.push("lat must be a valid number between -90 and 90");
  }
  if (query.lng === undefined || !isValidLng(lng)) {
    errors.push("lng must be a valid number between -180 and 180");
  }

  return errors;
}

function validateRouteRequest(body) {
  const errors = [];
  const { origin, destination, vehicleType } = body || {};

  if (!origin || !isValidLat(origin.lat) || !isValidLng(origin.lng)) {
    errors.push("origin.lat/origin.lng must be valid coordinates");
  }
  if (!destination || !isValidLat(destination.lat) || !isValidLng(destination.lng)) {
    errors.push("destination.lat/destination.lng must be valid coordinates");
  }
  if (!vehicleType || !VEHICLE_TYPES.includes(vehicleType)) {
    errors.push(`vehicleType must be one of: ${VEHICLE_TYPES.join(", ")}`);
  }

  return errors;
}

module.exports = {
  validateCompareFareRequest,
  validateAutocompleteQuery,
  validatePlaceDetailsQuery,
  validateReverseGeocodeQuery,
  validateRouteRequest,
  isValidLat,
  isValidLng,
  VEHICLE_TYPES,
  isValidNumber,
};
