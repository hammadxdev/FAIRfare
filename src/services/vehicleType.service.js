const INDRIVE_CATEGORY_MAPPINGS = Object.freeze({
  "2": { name: "Moto", vehicleType: "BIKE" },
  "33": { name: "Mini", vehicleType: "ECONOMY_CAR" },
  "31": { name: "Rickshaw", vehicleType: "RICKSHAW" },
  "29": { name: "Ride AC", vehicleType: "STANDARD_CAR" },
  "11": { name: "Premium", vehicleType: "PREMIUM_CAR" },
});

// Yango and Bykea report their own service ids; map them the same way as inDrive's
// categories (Mini/economy, Ride AC/standard, Premium) so a "car" request no longer
// stores their bike, rickshaw and premium services as STANDARD_CAR.
const YANGO_CATEGORY_MAPPINGS = Object.freeze({
  moto: "BIKE",
  tuktuk: "RICKSHAW",
  econom: "ECONOMY_CAR",
  business: "STANDARD_CAR",
  comfort: "PREMIUM_CAR",
  comfortplus: "PREMIUM_CAR",
});

const BYKEA_SERVICE_MAPPINGS = Object.freeze({
  "23": "BIKE",
  "70": "RICKSHAW",
  "44": "STANDARD_CAR",
  "45": "ECONOMY_CAR",
  "48": "PREMIUM_CAR",
});

const PROVIDER_CATEGORY_MAPPINGS = Object.freeze({
  yango: YANGO_CATEGORY_MAPPINGS,
  quickride: YANGO_CATEGORY_MAPPINGS,
  bykea: BYKEA_SERVICE_MAPPINGS,
  urbancab: BYKEA_SERVICE_MAPPINGS,
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
  const providerMapping = PROVIDER_CATEGORY_MAPPINGS[String(provider || "").toLowerCase()];
  if (providerMapping && providerCategoryId != null) {
    const known = providerMapping[String(providerCategoryId).toLowerCase()];
    if (known) return known;
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

module.exports = { INDRIVE_CATEGORY_MAPPINGS, YANGO_CATEGORY_MAPPINGS, BYKEA_SERVICE_MAPPINGS, normalizeVehicleType, resolveProviderCategory };
