const { IndriveError, CODES } = require("./indrive.errors");

function validLatitude(value) { return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= -90 && Number(value) <= 90; }
function validLongitude(value) { return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= -180 && Number(value) <= 180; }

function buildAutocompleteRequest(input, config) {
  const text = String(input?.text || "").trim();
  const cityId = Number(input?.cityId ?? input?.cid ?? config.cityId);
  const orderTypeId = Number(input?.orderTypeId ?? 2);
  const routePointType = String(input?.routePointType || config.autocompleteRoutePointType || "to").trim();
  if (!text || text.length > 120) throw new IndriveError(CODES.MALFORMED_REQUEST, "autocomplete text is invalid");
  if (!Number.isInteger(cityId) || cityId <= 0) throw new IndriveError(CODES.MALFORMED_REQUEST, "autocomplete city is invalid");
  if (!Number.isInteger(orderTypeId) || orderTypeId <= 0) throw new IndriveError(CODES.MALFORMED_REQUEST, "autocomplete order type is invalid");
  if (!validLatitude(input?.latitude) || !validLongitude(input?.longitude)) throw new IndriveError(CODES.MALFORMED_REQUEST, "autocomplete reference coordinates are invalid");
  if (routePointType !== "to") throw new IndriveError(CODES.MALFORMED_REQUEST, "autocomplete route point type is not documented");

  const url = new URL(config.autocompleteUrl);
  url.search = new URLSearchParams({ locale: "en_US", cid: String(cityId), requester: "mobile", route_point_type: routePointType }).toString();
  const body = new URLSearchParams({
    text,
    cid: String(cityId),
    order_type_id: String(orderTypeId),
    latitude: String(Number(input.latitude)),
    longitude: String(Number(input.longitude)),
    need_address_type: "true",
    with_raw: "true",
  });
  return { url: url.toString(), body: body.toString() };
}

function normalizeSuggestion(item) {
  const suggestId = item?.suggest_id ?? item?.suggestId ?? item?.id ?? null;
  const address = item?.address ?? item?.label ?? item?.title ?? null;
  const description = item?.description ?? item?.subtitle ?? null;
  if (suggestId === null || address === null || !validLatitude(item?.latitude) || !validLongitude(item?.longitude)) return null;
  return {
    suggestId: String(suggestId),
    placeId: item?.place_id ?? item?.placeId ?? null,
    address: String(address),
    description: description == null ? null : String(description),
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    locality: item?.locality ?? item?.city ?? null,
    postalCode: item?.postal_code ?? item?.postalCode ?? null,
    addressType: item?.address_type ?? item?.addressType ?? null,
    raw: item?.raw && typeof item.raw === "object" ? item.raw : undefined,
  };
}

function normalizeAutocompleteResponse(body) {
  const items = body?.response?.items;
  if (!Array.isArray(items)) return { valid: false, suggestions: [], invalidItemCount: 0, errorCode: "PROVIDER_RESPONSE_ITEMS_MISSING" };
  const suggestions = items.map(normalizeSuggestion).filter(Boolean);
  return { valid: true, suggestions, invalidItemCount: items.length - suggestions.length };
}

module.exports = { buildAutocompleteRequest, normalizeAutocompleteResponse, validLatitude, validLongitude };
