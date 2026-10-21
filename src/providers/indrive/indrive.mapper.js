const { ORDER_TYPE_CATEGORIES } = require("./indrive.constants");

const SENSITIVE_KEY = /(authorization|oauth|access[_-]?token|refresh[_-]?token|secret|password|cookie|session|credential|fingerprint|device|phone|account|profile|advertising|android|gsf|signature)/i;

function mapCategory(orderTypeId) {
  const id = orderTypeId === undefined || orderTypeId === null ? null : String(orderTypeId);
  const known = id && ORDER_TYPE_CATEGORIES[id];
  const normalizedCategory = known?.normalizedCategory || "UNKNOWN";
  return {
    categoryId: id,
    categoryName: known?.name || null,
    providerServiceName: known?.name || null,
    normalizedCategory,
    serviceTier: known?.serviceTier || "unknown",
    features: Array.isArray(known?.features) ? [...known.features] : [],
    vehicleCategory: normalizedCategory === "BIKE"
      ? "bike"
      : normalizedCategory === "RICKSHAW"
        ? "rickshaw"
        : normalizedCategory.endsWith("_CAR")
          ? "car"
          : "unknown",
  };
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function finiteNumber(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function normalizeMoney(value, multiplier) {
  const number = finiteNumber(value);
  return number !== null && Number.isFinite(multiplier) && multiplier > 0 ? number / multiplier : null;
}

function sanitizeMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, child]) => [key, sanitizeMetadata(child)]));
}

function responseItems(raw) {
  if (Array.isArray(raw)) return raw.map((item) => ({ item, envelope: raw }));
  if (Array.isArray(raw?.calculations)) return raw.calculations.map((item) => ({ item, envelope: raw }));
  if (Array.isArray(raw?.quotes)) return raw.quotes.map((item) => ({ item, envelope: raw }));
  if (Array.isArray(raw?.prices)) return raw.prices.map((item) => ({ item, envelope: raw }));
  if (Array.isArray(raw?.data)) return raw.data.map((item) => ({ item, envelope: raw }));
  return [{ item: raw?.data || raw, envelope: raw }];
}

function mapPricingResponse(raw, route = {}) {
  if (Array.isArray(raw) && raw.length === 0) return [];
  return responseItems(raw).filter(({ item }) => item && typeof item === "object").map(({ item, envelope }) => {
    const category = mapCategory(firstValue(item, ["order_type_id", "orderTypeId", "type_id"]));
    const currency = typeof envelope?.currency === "object" ? envelope.currency : (item.currency || item.autofill_price?.currency);
    const multiplier = finiteNumber(currency?.multiplier);
    const code = typeof currency === "string" ? currency : currency?.code || null;
    const singleShape = item.autofill_price && typeof item.autofill_price === "object";
    const recommendedRaw = singleShape ? item.autofill_price.value : firstValue(item, ["autofill_price", "recommended_price"]);
    const priceRaw = singleShape ? item.price?.value : item.price;
    const minRaw = singleShape ? item.price_min?.value : item.price_min;
    const maxRaw = singleShape ? item.price_max?.value : item.price_max;
    const isRush = singleShape ? item.rush_hour?.is_rush : item.is_rush;
    const fare = normalizeMoney(recommendedRaw, multiplier);
    const priceSourceField = singleShape ? "autofill_price.value" : item.autofill_price !== undefined ? "autofill_price" : "recommended_price";
    const priceClassification = fare === null ? "unavailable" : "suggested";
    const priceDiagnostics = {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      upstreamPriceField: priceSourceField,
      originalNumericAmount: finiteNumber(recommendedRaw),
      normalizedNumericAmount: fare,
      currency: code,
      priceClassification,
      source: "real",
      freshnessTtlSeconds: finiteNumber(envelope?.ttl ?? item.ttl ?? 300),
    };
    return {
      providerId: "indrive", providerName: "inDrive", ...category,
      fare, fareRecommended: fare,
      fareMin: normalizeMoney(minRaw, multiplier), fareMax: normalizeMoney(maxRaw, multiplier),
      exactFare: null, priceType: "suggested", isNegotiable: fare !== null,
      currency: code, fareType: "RECOMMENDED", pickupEtaSeconds: null,
      tripDurationSeconds: finiteNumber(route.durationSeconds), distanceMeters: finiteNumber(route.distanceMeters),
      isAvailable: fare !== null, deepLink: null,
      metadata: {
        providerTtlSeconds: finiteNumber(envelope?.ttl ?? item.ttl ?? 300),
        isRush: typeof isRush === "boolean" ? isRush : null,
        price: normalizeMoney(priceRaw, multiplier), priceMin: normalizeMoney(minRaw, multiplier), priceMax: normalizeMoney(maxRaw, multiplier),
        priceSteps: item.price_steps && typeof item.price_steps === "object" ? sanitizeMetadata(item.price_steps) : null,
        priceDiagnostics,
        raw: sanitizeMetadata(item),
      },
    };
  });
}

module.exports = { mapPricingResponse, mapCategory, normalizeMoney };
