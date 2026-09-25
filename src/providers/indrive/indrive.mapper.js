const { ORDER_TYPE_CATEGORIES } = require("./indrive.constants");

function mapCategory(orderTypeId) {
  const id = orderTypeId === undefined || orderTypeId === null ? null : String(orderTypeId);
  const known = id && ORDER_TYPE_CATEGORIES[id];
  return { categoryId: id, categoryName: known?.name || null, normalizedCategory: known?.normalizedCategory || "UNKNOWN" };
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function mapPricingResponse(raw, route) {
  if (Array.isArray(raw) && raw.length === 0) return [];
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.quotes) ? raw.quotes
      : Array.isArray(raw?.prices) ? raw.prices
        : Array.isArray(raw?.data) ? raw.data
          : [raw?.data || raw];
  return items.filter((item) => item && typeof item === "object").map((item) => {
    const category = mapCategory(firstValue(item, ["order_type_id", "orderTypeId", "type_id"]));
    const fare = firstValue(item, ["fare", "price", "recommended_price", "amount"]);
    const fareMin = firstValue(item, ["fare_min", "min_fare", "price_min"]);
    const fareMax = firstValue(item, ["fare_max", "max_fare", "price_max"]);
    const numeric = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      providerId: "indrive", providerName: "inDrive", ...category,
      fare: numeric(fare), fareMin: numeric(fareMin), fareMax: numeric(fareMax),
      currency: typeof item.currency === "string" ? item.currency : null,
      fareType: "RECOMMENDED",
      pickupEtaSeconds: numeric(firstValue(item, ["pickup_eta_seconds", "eta_seconds"])),
      tripDurationSeconds: numeric(firstValue(item, ["trip_duration_seconds", "duration_seconds"])),
      distanceMeters: numeric(firstValue(item, ["distance_meters"])) ?? route.distanceMeters ?? null,
      isAvailable: fare !== null,
      deepLink: null,
      metadata: { raw: item },
    };
  });
}

module.exports = { mapPricingResponse, mapCategory };
