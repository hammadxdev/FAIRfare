function coordinate(location, label) {
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    const error = new Error(`${label} coordinates are invalid`);
    error.code = "INVALID_COORDINATES";
    throw error;
  }
  return { latitude, longitude };
}

const DEFAULT_PASSENGER_TARIFF_REQUIREMENTS = Object.freeze([
  "econom",
  "business",
  "comfortplus",
  "moto",
].map((className) => Object.freeze({ class: className })));

function buildStateFields(pickup, destination, origin, destinationPoint) {
  const field = (type, location, point) => ({
    type,
    ...(typeof location?.name === "string" && location.name.trim() ? { title: location.name.trim() } : {}),
    entrance: "",
    position: [point.longitude, point.latitude],
  });
  return { fields: [field("a", pickup, origin), field("b", destination, destinationPoint)] };
}

function buildRouteStatsPayload({
  pickup,
  destination,
  zoneName,
  supportedZones = null,
  selectedClass,
  paymentType,
  id,
  currentLocation,
  preciseLocationAvailable,
  tariffRequirements = DEFAULT_PASSENGER_TARIFF_REQUIREMENTS,
  forceSoonOrder,
  skipEstimatedWaiting,
  sizeHint,
  multiclassOptions,
  useTollRoads,
  isLightweight,
  supportedVerticalTypes,
  supportedVerticals = ["taxi"],
  state,
  supported,
  summaryContext,
  supportedFeatures,
} = {}) {
  const origin = coordinate(pickup, "Pickup");
  const destinationPoint = coordinate(destination, "Destination");
  if (origin.latitude === destinationPoint.latitude && origin.longitude === destinationPoint.longitude) {
    const error = new Error("Pickup and destination must be different");
    error.code = "IDENTICAL_COORDINATES";
    throw error;
  }
  if (!String(zoneName || "").trim()) {
    const error = new Error("Yango service zone is required");
    error.code = "ZONE_REQUIRED";
    throw error;
  }
  if (Array.isArray(supportedZones) && supportedZones.length > 0 && !supportedZones.map((zone) => String(zone).toLowerCase()).includes(String(zoneName).trim().toLowerCase())) {
    const error = new Error("Yango service zone is not supported");
    error.code = "UNSUPPORTED_ZONE";
    throw error;
  }
  if (!String(selectedClass || "").trim()) {
    const error = new Error("Yango tariff class is required");
    error.code = "CLASS_REQUIRED";
    throw error;
  }

  // These fields are the reviewed RouteStats body fields. Capability and
  // session metadata are caller-supplied only; no captured mobile state is
  // generated or replayed here.
  const generatedState = state === undefined ? buildStateFields(pickup, destination, origin, destinationPoint) : state;
  if (state === undefined && Array.isArray(currentLocation) && currentLocation.length === 2) {
    generatedState.location = currentLocation;
    generatedState.precise_location_available = preciseLocationAvailable === true;
  }

  const payload = {
    zone_name: String(zoneName).trim(),
    selected_class: String(selectedClass).trim(),
    route: [[origin.longitude, origin.latitude], [destinationPoint.longitude, destinationPoint.latitude]],
    tariff_requirements: tariffRequirements,
    payment: { type: String(paymentType || "cash").trim() },
    supported_verticals: supportedVerticals,
    state: generatedState,
  };
  if (forceSoonOrder !== undefined) payload.force_soon_order = Boolean(forceSoonOrder);
  if (skipEstimatedWaiting !== undefined) payload.skip_estimated_waiting = Boolean(skipEstimatedWaiting);
  if (sizeHint !== undefined) payload.size_hint = sizeHint;
  if (multiclassOptions !== undefined) payload.multiclass_options = multiclassOptions;
  if (useTollRoads !== undefined) payload.use_toll_roads = Boolean(useTollRoads);
  if (isLightweight !== undefined) payload.is_lightweight = Boolean(isLightweight);
  if (supportedVerticalTypes !== undefined) payload.supported_vertical_types = supportedVerticalTypes;
  if (supported !== undefined) payload.supported = supported;
  if (summaryContext !== undefined) payload.summary_context = summaryContext;
  if (supportedFeatures !== undefined) payload.supported_features = supportedFeatures;
  if (id !== undefined && id !== null && String(id).trim()) payload.id = String(id).trim();
  return payload;
}

module.exports = { buildRouteStatsPayload };
