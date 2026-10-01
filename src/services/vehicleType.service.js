const INDRIVE_CATEGORY_MAPPINGS = Object.freeze({
  "2": { name: "Moto", vehicleType: "BIKE" },
  "33": { name: "Mini", vehicleType: "ECONOMY_CAR" },
  "31": { name: "Rickshaw", vehicleType: "RICKSHAW" },
  "29": { name: "Ride AC", vehicleType: "STANDARD_CAR" },
  "11": { name: "Premium", vehicleType: "PREMIUM_CAR" },
});

const REQUEST_VEHICLE_TYPES = Object.freeze({
  bike: "BIKE",
  rickshaw: "RICKSHAW",
  mini: "ECONOMY_CAR",
  car: "STANDARD_CAR",
});

function normalizeVehicleType({ provider, providerCategoryId, providerCategoryName, requestedVehicleType }) {
  if (provider === "indrive" && providerCategoryId != null) {
    const known = INDRIVE_CATEGORY_MAPPINGS[String(providerCategoryId)];
    if (known) return known.vehicleType;
    // Simulated adapters use the request vehicle slug rather than an
    // inDrive order_type_id. Only that explicit adapter value is accepted.
    if (String(providerCategoryId).toLowerCase() === String(requestedVehicleType || "").toLowerCase()) {
      return REQUEST_VEHICLE_TYPES[String(requestedVehicleType).toLowerCase()] || "UNKNOWN";
    }
    return "UNKNOWN";
  }
  return REQUEST_VEHICLE_TYPES[String(requestedVehicleType || "").toLowerCase()] || "UNKNOWN";
}

function resolveProviderCategory({ provider, providerCategoryId, providerCategoryName, requestedVehicleType }) {
  if (provider === "indrive" && providerCategoryId != null) {
    const known = INDRIVE_CATEGORY_MAPPINGS[String(providerCategoryId)];
    if (known) return { id: String(providerCategoryId), name: known.name };
    if (String(providerCategoryId).toLowerCase() === String(requestedVehicleType || "").toLowerCase()) {
      return { id: String(providerCategoryId), name: providerCategoryName || requestedVehicleType || null };
    }
    return { id: String(providerCategoryId), name: null };
  }
  return {
    id: providerCategoryId == null ? (requestedVehicleType || null) : String(providerCategoryId),
    name: providerCategoryName || requestedVehicleType || null,
  };
}

module.exports = { INDRIVE_CATEGORY_MAPPINGS, normalizeVehicleType, resolveProviderCategory };
