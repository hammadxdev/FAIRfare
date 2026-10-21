function numericFareFromMstr(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*Est:\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s+PKR\s*$/i);
  if (!match) return null;
  const fare = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(fare) && fare > 0 ? fare : null;
}

function successfulServiceEntry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (item.success !== undefined && ![true, "true", 1, "1"].includes(item.success)) return false;
  if (item.status !== undefined && !["success", "successful", "available", "ok", "true", "1"].includes(String(item.status).trim().toLowerCase())) return false;
  if (item.error || item.error_code) return false;
  return true;
}

function normalizeBykeaServiceEntry(item) {
  if (!successfulServiceEntry(item)) return null;
  const fare = numericFareFromMstr(item.mstr);
  if (fare === null || item.service_code === undefined || item.service_code === null) return null;
  const serviceCode = String(item.service_code).trim();
  const currencyCode = typeof item.currency_code === "string" ? item.currency_code.trim().toUpperCase() : "";
  if (!serviceCode || !/^[A-Z]{3}$/.test(currencyCode)) return null;
  return {
    categoryId: serviceCode,
    categoryName: null,
    providerServiceName: `Service ${serviceCode}`,
    providerServiceLabel: `Service ${serviceCode}`,
    vehicleCategory: "unknown",
    serviceTier: "unknown",
    features: [],
    rideType: serviceCode,
    fare,
    currency: currencyCode,
    service_code: item.service_code,
    currency_code: item.currency_code,
    displayFare: item.mstr,
    priceText: item.mstr,
    priceType: "estimate",
    isEstimate: true,
    isAvailable: true,
  };
}

function applicationErrorDetails(response) {
  const message = typeof response?.message === "string"
    ? response.message
    : typeof response?.error === "string"
      ? response.error
      : typeof response?.error?.message === "string" ? response.error.message : "";
  return {
    code: "PROVIDER_API_REJECTED",
    category: "API_REJECTED",
    upstreamCode: response?.code === undefined ? null : String(response.code),
    errorPresent: response?.error !== undefined && response?.error !== null,
    messagePresent: Boolean(message),
    messageLength: message.length,
    rawMessageIncluded: false,
  };
}

function isApplicationRejection(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const code = Number(response.code);
  return response.success === false
    || String(response.success).trim().toLowerCase() === "false"
    || (response.code !== undefined && Number.isFinite(code) && (code < 200 || code >= 300));
}

function summarizeBykeaResponse(response) {
  const isObject = response !== null && typeof response === "object" && !Array.isArray(response);
  const data = isObject && Array.isArray(response.data) ? response.data : null;
  const entries = data || [];
  return {
    stage: !isObject ? "unexpected_json_type" : !Array.isArray(response.data) ? "missing_data_array" : entries.length === 0 ? "empty_data_array" : "data_array_inspected",
    topLevelKeys: isObject ? Object.keys(response).sort() : [],
    success: isObject && ["boolean", "string", "number"].includes(typeof response.success) ? response.success : null,
    code: isObject && ["number", "string"].includes(typeof response.code) ? response.code : null,
    dataIsArray: Array.isArray(data),
    dataEntryCount: data ? data.length : 0,
    entriesWithServiceCode: entries.filter((item) => item && typeof item === "object" && item.service_code !== undefined && item.service_code !== null).length,
    entriesWithMstr: entries.filter((item) => item && typeof item === "object" && typeof item.mstr === "string").length,
    validEstimateEntries: entries.map(normalizeBykeaServiceEntry).filter(Boolean).length,
    applicationError: isApplicationRejection(response) ? applicationErrorDetails(response) : null,
  };
}

function normalizeBykeaFareResponse(response) {
  if (isApplicationRejection(response)) {
    const details = applicationErrorDetails(response);
    return { status: "provider_error", source: "none", currency: null, estimates: [], error: { code: details.code, message: "Bykea API rejected the fare request.", diagnostics: details } };
  }
  const data = Array.isArray(response?.data) ? response.data : [];
  const estimates = data.map(normalizeBykeaServiceEntry).filter(Boolean);
  if (!estimates.length) {
    return {
      status: "provider_error",
      source: "none",
      currency: null,
      estimates: [],
      error: { code: "PROVIDER_BAD_RESPONSE", message: "Bykea returned no valid fare estimates." },
    };
  }
  return { status: "available", source: "live", currency: estimates[0].currency, estimates };
}

module.exports = {
  numericFareFromMstr,
  normalizeBykeaFareResponse,
  normalizeBykeaServiceEntry,
  summarizeBykeaResponse,
};
