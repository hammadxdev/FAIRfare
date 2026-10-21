const DEFAULT_ORDER_TYPE_IDS = Object.freeze([2, 33, 31, 29, 11]);

function numberInRange(value, min, max, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new TypeError(`${field} must be finite and in range`);
  return number;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${field} must be a positive finite number`);
  return number;
}

function coordinatePair(value, field) {
  return {
    lat: numberInRange(value?.latitude ?? value?.lat, -90, 90, `${field}.latitude`),
    lng: numberInRange(value?.longitude ?? value?.lng, -180, 180, `${field}.longitude`),
  };
}

// This is a pure mapping only. It does not select an endpoint or perform I/O.
// The field names mirror the sanitized pricing table in the local reference.
function mapIndrivePricingRequest({ pickup, destination, distanceMeters, durationSeconds, orderTypeIds = DEFAULT_ORDER_TYPE_IDS } = {}) {
  const origin = coordinatePair(pickup, "pickup");
  const target = coordinatePair(destination, "destination");
  const ids = [...orderTypeIds].map(Number);
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new TypeError("orderTypeIds must contain positive integers");
  return {
    order_type_ids: ids,
    route: [origin, target],
    geo: {
      distance_meters: positiveNumber(distanceMeters, "distanceMeters"),
      duration_seconds: positiveNumber(durationSeconds, "durationSeconds"),
      toll_cost: 0,
      points: [],
    },
  };
}

function money(value) {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeAmount(estimate, majorField, minorField, multiplier) {
  if (estimate?.[minorField] !== undefined) {
    const value = Number(estimate[minorField]) / Number(multiplier || 1);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return money(estimate?.[majorField]);
}

function expiryDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeIndriveEstimate(estimate, { currency, currencyMultiplier = 100, now = Date.now, expiresAt = null } = {}) {
  const resolvedCurrency = String(estimate?.currency || currency || "").trim().toUpperCase();
  const effectiveExpiry = estimate?.expiresAt || expiresAt;
  const expiry = expiryDate(effectiveExpiry);
  if (!resolvedCurrency || !Number.isFinite(Number(currencyMultiplier)) || Number(currencyMultiplier) <= 0 || Number.isNaN(expiry) || (expiry !== null && expiry <= now())) return null;
  const fare = normalizeAmount(estimate, "fare", "fareMinor", currencyMultiplier) ?? normalizeAmount(estimate, "amount", "amountMinor", currencyMultiplier);
  if (fare === null) return null;
  const fareMin = normalizeAmount(estimate, "fareMin", "fareMinMinor", currencyMultiplier);
  const fareMax = normalizeAmount(estimate, "fareMax", "fareMaxMinor", currencyMultiplier);
  const declaredType = String(estimate?.priceType || estimate?.fareType || "").toLowerCase();
  const suggested = estimate?.negotiable === true || estimate?.isNegotiable === true || ["suggested", "negotiable", "recommended"].includes(declaredType);
  return {
    categoryId: estimate?.categoryId || estimate?.rideType || null,
    categoryName: estimate?.categoryName || estimate?.vehicleCategory || null,
    vehicleCategory: estimate?.vehicleCategory || null,
    rideType: estimate?.rideType || estimate?.categoryId || null,
    fare,
    fareMin,
    fareMax,
    currency: resolvedCurrency,
    priceType: suggested ? "suggested" : ["fixed", "quote", "upfront"].includes(declaredType) ? "fixed" : "estimate",
    isNegotiable: suggested,
    quotedAt: estimate?.quotedAt || null,
    expiresAt: effectiveExpiry || null,
    isEstimate: estimate?.isEstimate !== false,
    source: "live",
  };
}

function normalizeIndrivePricingResponse(response, { currencyMultiplier = 100, now = Date.now } = {}) {
  const currency = String(response?.currency || "").trim().toUpperCase();
  const expiresAt = response?.expiresAt || null;
  const expiry = expiryDate(expiresAt);
  if (!currency || !Number.isFinite(Number(currencyMultiplier)) || Number(currencyMultiplier) <= 0 || Number.isNaN(expiry) || (expiry !== null && expiry <= now())) return { status: "unavailable", source: "none", estimates: [], errorCode: !currency ? "PROVIDER_CURRENCY_MISSING" : Number.isNaN(expiry) || Number(currencyMultiplier) <= 0 ? "PROVIDER_CONTRACT_INVALID" : "STALE_PROVIDER_RESPONSE" };
  const raw = Array.isArray(response?.estimates) ? response.estimates : [];
  const estimates = raw.map((estimate) => normalizeIndriveEstimate(estimate, { currency, currencyMultiplier, now, expiresAt })).filter(Boolean);
  if (!estimates.length) return { status: "provider_error", source: "none", estimates: [], errorCode: "PROVIDER_BAD_RESPONSE" };
  return { status: "available", source: "live", currency, estimates };
}

module.exports = { DEFAULT_ORDER_TYPE_IDS, mapIndrivePricingRequest, normalizeIndriveEstimate, normalizeIndrivePricingResponse };
