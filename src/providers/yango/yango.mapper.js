function finitePositive(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function numericPrice(value) {
  if (typeof value === "number") return finitePositive(value);
  if (value && typeof value === "object") return numericPrice(value.amount ?? value.value ?? value.price);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || /\$SIGN\$|\$CURRENCY\$/i.test(text)) return null;
  return finitePositive(text.replace(/,/g, ""));
}

function currencyCode(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function parseDocumentedPrice(value, currency) {
  if (typeof value === "number") return finitePositive(value);
  if (value && typeof value === "object") {
    return parseDocumentedPrice(value.amount ?? value.value ?? value.price, currency);
  }
  if (typeof value !== "string" || currency !== "PKR") return null;
  const text = value.trim().replace(/[\u00a0\u202f]/g, " ");
  if (!text || !/^\s*(?:from\s+)?(?:\$SIGN\$\s*)?(?:Rs\.?\s*|PKR\s*)?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:\$CURRENCY\$)?$/i.test(text)) return null;
  const matches = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g);
  if (!matches || matches.length !== 1) return null;
  return finitePositive(matches[0].replace(/,/g, ""));
}

function parseExactFinalPrice(value) {
  const number = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim().replace(/,/g, "") : value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function firstStartingPrice(level, currency) {
  const details = Array.isArray(level?.details_tariff) ? level.details_tariff : [];
  const priceDetail = details.find((item) => item?.type === "price");
  return parseDocumentedPrice(priceDetail?.value, currency);
}

function priceQualifier(value, explicit) {
  if (explicit != null) return String(explicit);
  if (typeof value === "string" && /^\s*from\b/i.test(value)) return "from";
  return null;
}

function isDeliveryServiceLevel(level) {
  const category = String(level?.class ?? "").toLowerCase();
  return Boolean(level?.delivery_extra) || /courier|cargo|delivery|express|ndd_|sdd_|virtual_orders/.test(category);
}

function firstArray(response) {
  const candidates = [
    response?.tariffs,
    response?.data?.tariffs,
    response?.classes,
    response?.data?.classes,
    response?.options,
    response?.data?.options,
  ];
  return candidates.find(Array.isArray) || [];
}

function documentedServiceLevels(response) {
  if (Array.isArray(response?.service_levels)) return response.service_levels;
  if (Array.isArray(response?.data?.service_levels)) return response.data.service_levels;
  return null;
}

function documentedCurrency(response) {
  const code = currencyCode(response?.currency_rules?.code ?? response?.data?.currency_rules?.code);
  return code === "PKR" ? code : null;
}

function explicitUnavailable(level) {
  return level?.available === false || level?.is_available === false || level?.supported === false || level?.unavailable === true || String(level?.availability ?? "").toLowerCase() === "unavailable";
}

function vehicleExamples(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((car) => typeof car === "string" ? car : car?.name ?? car?.model)
    .filter((car) => typeof car === "string" && car.trim())
    .map((car) => car.trim());
}

function normalizeServiceLevel(level, currency, routeMetadata = {}) {
  const categoryId = level?.class == null || String(level.class).trim() === "" ? null : String(level.class);
  const hidden = level?.is_hidden === true;
  const unavailableCode = typeof level?.tariff_unavailable?.code === "string" && level.tariff_unavailable.code.trim()
    ? level.tariff_unavailable.code.trim()
    : null;
  const unavailable = explicitUnavailable(level) || Boolean(unavailableCode);
  const rawPrice = level?.price;
  const displayPrice = parseDocumentedPrice(rawPrice, currency);
  const exactPrice = parseExactFinalPrice(level?.prices?.raw?.final_price);
  const maxPrice = parseExactFinalPrice(level?.max_price_as_decimal);
  const contradictoryFinalPrice = exactPrice !== null && maxPrice !== null && exactPrice !== maxPrice;
  const exactFare = contradictoryFinalPrice ? null : exactPrice ?? maxPrice;
  const startingFare = firstStartingPrice(level, currency);
  const surgeMultiplier = finitePositive(level?.paid_options?.value);
  const description = level?.description_parts?.value ?? level?.description;
  const exactUnavailableReason = !exactFare
    ? { code: "EXACT_ROUTE_FARE_UNAVAILABLE", message: "Yango did not return a verified route-specific final fare." }
    : null;
  const conflictReason = contradictoryFinalPrice
    ? { code: "CONTRADICTORY_FINAL_PRICE", message: "Yango returned conflicting final-price fields." }
    : null;
  const availabilityReason = unavailableCode
    ? { code: unavailableCode, message: level.tariff_unavailable.message || null }
    : conflictReason || exactUnavailableReason;
  const categoryType = isDeliveryServiceLevel(level) ? "delivery" : "passenger";
  const hasExactQuote = exactFare !== null;
  const normalized = {
    categoryId,
    categoryName: level?.name == null ? null : String(level.name),
    // `fare` remains the public comparison amount, but now means the exact
    // provider-returned route quote rather than the card's display/from price.
    fare: hidden || unavailable || !hasExactQuote ? null : exactFare,
    exactFare,
    providerFinalFare: exactFare,
    displayFare: displayPrice,
    startingFare,
    currency,
    fareType: hasExactQuote ? "FIXED_ROUTE_QUOTE" : "STARTING_PRICE_ONLY",
    quoteSemantics: hasExactQuote ? "provider_exact_route_quote" : "provider_starting_price_only",
    priceQualifier: priceQualifier(description ?? rawPrice, level?.price_qualifier),
    priceText: typeof rawPrice === "string" ? rawPrice : null,
    vehicleExamples: vehicleExamples(level?.cars),
    surgeMultiplier,
    surgeAlertProperties: level?.paid_options?.alert_properties && typeof level.paid_options.alert_properties === "object"
      ? { ...level.paid_options.alert_properties }
      : null,
    pickupEtaSeconds: Number.isFinite(Number(level?.estimated_waiting?.seconds)) && Number(level.estimated_waiting.seconds) >= 0
      ? Number(level.estimated_waiting.seconds)
      : null,
    routeDistance: routeMetadata.distance ?? null,
    tripDuration: routeMetadata.time ?? null,
    categoryType,
    availability: unavailable ? "unavailable" : hasExactQuote ? "unverified_bookability" : "unavailable",
    availabilityReason,
    isAvailable: Boolean(categoryId) && !hidden && !unavailable && hasExactQuote && Boolean(currency),
    hidden,
  };
  return normalized;
}

function normalizeTariff(tariff) {
  const id = tariff?.id ?? tariff?.tariff_id ?? tariff?.class_id ?? tariff?.class;
  const name = tariff?.name ?? tariff?.title ?? tariff?.class_name ?? tariff?.display_name ?? id;
  const priceObject = tariff?.price && typeof tariff.price === "object" ? tariff.price : null;
  const price = numericPrice(tariff?.price ?? tariff?.amount ?? tariff?.total_price ?? tariff?.value);
  const currency = String(tariff?.currency ?? tariff?.currency_code ?? priceObject?.currency ?? "").trim().toUpperCase() || null;
  const hidden = tariff?.hidden === true || tariff?.is_hidden === true || tariff?.available === false || tariff?.supported === false;
  const qualifier = tariff?.price_qualifier ?? tariff?.qualifier ?? priceObject?.qualifier ?? (tariff?.from === true ? "from" : null);
  return {
    categoryId: id == null ? null : String(id),
    categoryName: name == null ? null : String(name),
    fare: hidden ? null : price,
    currency,
    priceQualifier: qualifier == null ? null : String(qualifier),
    priceText: typeof tariff?.price === "string" ? tariff.price : null,
    isAvailable: !hidden && price !== null && Boolean(currency),
    hidden,
  };
}

function normalizeRouteStatsResponse(response) {
  const serviceLevels = documentedServiceLevels(response);
  if (serviceLevels) {
    const currency = documentedCurrency(response);
    const routeMetadata = { distance: response?.distance ?? null, time: response?.time ?? null };
    const normalized = serviceLevels.map((level) => normalizeServiceLevel(level, currency, routeMetadata));
    const deliveryEstimates = normalized.filter((item) => item.categoryType === "delivery" && !item.hidden);
    const estimates = normalized.filter((item) => item.categoryType === "passenger" && !item.hidden);
    const availableEstimates = estimates.filter((item) => item.isAvailable);
    if (!availableEstimates.length) {
      return {
        status: "provider_error",
        source: "none",
        currency,
        estimates: [],
        deliveryEstimates,
        passengerEstimates: estimates,
        routeMetadata,
        error: { code: "PROVIDER_NO_VALID_TARIFFS", message: "Yango returned no valid live tariffs." },
      };
    }
    return { status: "available", source: "live", currency, estimates, passengerEstimates: estimates, deliveryEstimates, routeMetadata };
  }
  const estimates = firstArray(response).map(normalizeTariff);
  const available = estimates.filter((item) => item.isAvailable);
  if (!available.length) {
    return {
      status: "provider_error",
      source: "none",
      currency: null,
      estimates,
      error: { code: "PROVIDER_NO_VALID_TARIFFS", message: "Yango returned no valid live tariffs." },
    };
  }
  return { status: "available", source: "live", currency: available[0].currency, estimates: available };
}

module.exports = { numericPrice, normalizeTariff, normalizeRouteStatsResponse };
