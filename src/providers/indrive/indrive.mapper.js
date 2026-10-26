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

function amountValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return finiteNumber(value.value);
  return finiteNumber(value);
}

function timestampMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value) < 1e12 ? value * 1000 : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function mapPricingResponse(raw, route = {}, options = {}) {
  if (Array.isArray(raw) && raw.length === 0) return [];
  const backendProcessedAtMs = Number.isFinite(options.processedAtMs) ? options.processedAtMs : Date.now();
  return responseItems(raw).filter(({ item }) => item && typeof item === "object").map(({ item, envelope }) => {
    const category = mapCategory(firstValue(item, ["order_type_id", "orderTypeId", "type_id"]));
    const currency = typeof envelope?.currency === "object" ? envelope.currency : (item.currency || item.price?.currency || item.autofill_price?.currency);
    const multiplier = finiteNumber(currency?.multiplier);
    const code = typeof currency === "string" ? currency : currency?.code || null;
    const priceRaw = amountValue(item.price);
    const autofillPriceRaw = amountValue(item.autofill_price);
    const minRaw = amountValue(item.price_min);
    const maxRaw = amountValue(item.price_max);
    const isRush = item.rush_hour?.is_rush ?? item.is_rush;
    // For the captured calculations response, `price` is the suggested fare.
    // The public provider contract has not been independently verified, so do
    // not substitute autofill_price or range/step values when price is absent.
    const fare = normalizeMoney(priceRaw, multiplier);
    const priceSourceField = item.price && typeof item.price === "object" ? "price.value" : "price";
    const ttlSeconds = finiteNumber(envelope?.ttl ?? item.ttl);
    const ttlIsValid = ttlSeconds !== null && ttlSeconds >= 0;
    const providerCreatedAtRaw = envelope?.created_at ?? item.created_at ?? null;
    const providerCreatedAtMs = timestampMillis(providerCreatedAtRaw);
    const providerExpiresAtMs = providerCreatedAtMs !== null && ttlIsValid ? providerCreatedAtMs + ttlSeconds * 1000 : null;
    const providerFreshness = providerExpiresAtMs === null ? "unknown" : backendProcessedAtMs >= providerExpiresAtMs ? "expired" : "current";
    const providerCreatedAt = providerCreatedAtMs === null ? null : new Date(providerCreatedAtMs).toISOString();
    const providerExpiresAt = providerExpiresAtMs === null ? null : new Date(providerExpiresAtMs).toISOString();
    const backendProcessedAt = new Date(backendProcessedAtMs).toISOString();
    const priceClassification = fare === null ? "unavailable" : "suggested";
    const priceDiagnostics = {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      upstreamPriceField: priceSourceField,
      originalNumericAmount: priceRaw,
      normalizedNumericAmount: fare,
      autofillPriceRaw,
      autofillPriceNormalized: normalizeMoney(autofillPriceRaw, multiplier),
      fallbackUsed: false,
      currency: code,
      priceClassification,
      source: "real",
      freshnessTtlSeconds: ttlIsValid ? ttlSeconds : null,
      providerFreshness,
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
        providerTtlSeconds: ttlIsValid ? ttlSeconds : null,
        providerCreatedAtRaw: providerCreatedAtRaw === null ? null : sanitizeMetadata(providerCreatedAtRaw),
        providerCreatedAt,
        providerExpiresAt,
        providerFreshness,
        backendProcessedAt,
        isRush: typeof isRush === "boolean" ? isRush : null,
        priceRaw,
        price: normalizeMoney(priceRaw, multiplier),
        autofillPriceRaw,
        autofillPrice: normalizeMoney(autofillPriceRaw, multiplier),
        priceMin: normalizeMoney(minRaw, multiplier), priceMax: normalizeMoney(maxRaw, multiplier),
        priceSteps: item.price_steps && typeof item.price_steps === "object" ? sanitizeMetadata(item.price_steps) : null,
        priceDiagnostics,
        raw: sanitizeMetadata(item),
      },
    };
  });
}

module.exports = { mapPricingResponse, mapCategory, normalizeMoney };
