const history = require("../history.service");
const { canonicalProviderId, providerDisplayName } = require("../../providers/provider.registry");

let historyReader = history;

function normalizeCode(value) {
  if (value === undefined || value === null) return null;
  const code = String(value).trim();
  return code ? code.toLowerCase() : null;
}

function providerKey(value) {
  return canonicalProviderId(value) || (value == null ? null : String(value).trim().toLowerCase() || null);
}

function freshnessOf(quote, comparison) {
  if (comparison?.enrichmentStatus === "stale") return "historical";
  if (quote?.quoteFreshness === "fresh") return "fresh";
  if (quote?.quoteFreshness === "historical") return "historical";
  return "unknown";
}

function publicMatch(comparison, quote) {
  const id = providerKey(quote.providerId || quote.provider);
  const category = quote.verifiedVehicleCategory || null;
  const genericName = /^service\s+[a-z0-9_-]+$/i.test(String(quote.providerServiceName || ""));
  const verified = Boolean(category || quote.serviceCategoryProvenance || (quote.providerServiceName && !genericName));
  return {
    status: verified ? "FOUND" : "UNKNOWN_SERVICE",
    comparisonId: comparison.comparisonId || comparison.id,
    serviceCode: quote.serviceCode || null,
    provider: { id, displayName: quote.providerDisplayName || providerDisplayName(id) || quote.provider || null },
    service: {
      code: quote.serviceCode,
      name: quote.providerServiceName || null,
      originalLabel: quote.providerServiceLabel || null,
      vehicleCategory: category,
      categoryStatus: category ? "verified" : "unknown",
      categoryConfidence: quote.serviceCategoryConfidence || null,
      categoryProvenance: quote.serviceCategoryProvenance || null,
      serviceTier: quote.serviceTier || null,
      features: Array.isArray(quote.serviceMetadata?.features) ? quote.serviceMetadata.features.slice(0, 20) : [],
    },
    fare: {
      value: quote.fare ?? null,
      min: quote.fareMin ?? null,
      max: quote.fareMax ?? null,
      currency: quote.currency || null,
      availability: quote.availability || "unknown",
    },
    evidence: {
      sourceType: quote.sourceType || "historical",
      freshness: freshnessOf(quote, comparison),
      verified,
      observedAt: quote.observedAt || quote.quoteCreatedAt || comparison.searchedAt || null,
      validUntil: quote.validUntil || null,
    },
  };
}

async function readComparisons({ userId, comparisonId }) {
  if (comparisonId) {
    const comparison = await historyReader.getHistoryById(comparisonId, userId);
    return comparison ? [comparison] : [];
  }
  return historyReader.getHistory({ userId, limit: 20, offset: 0 });
}

async function lookupProviderService({ userId, comparisonId = null, provider = null, serviceCode = null } = {}) {
  if (!userId) return { status: "COMPARISON_NOT_FOUND" };
  const requestedCode = normalizeCode(serviceCode);
  const requestedProvider = providerKey(provider);
  const comparisons = await readComparisons({ userId, comparisonId });
  if (!comparisons.length) return { status: comparisonId ? "COMPARISON_NOT_FOUND" : "UNKNOWN_SERVICE" };

  const matches = [];
  for (const comparison of comparisons) {
    for (const quote of comparison.quotes || []) {
      const quoteCode = normalizeCode(quote.serviceCode);
      const quoteProvider = providerKey(quote.providerId || quote.provider);
      if ((requestedCode ? quoteCode === requestedCode : Boolean(quoteCode)) && (!requestedProvider || quoteProvider === requestedProvider)) matches.push({ comparison, quote });
    }
    if (matches.length && comparisonId) break;
  }

  if (!matches.length) return { status: "UNKNOWN_SERVICE", comparisonId: comparisonId || comparisons[0]?.comparisonId || comparisons[0]?.id || null, serviceCode: serviceCode == null ? null : String(serviceCode) };
  const providers = [...new Set(matches.map(({ quote }) => providerKey(quote.providerId || quote.provider)))];
  const serviceKeys = [...new Set(matches.map(({ quote }) => `${providerKey(quote.providerId || quote.provider)}:${normalizeCode(quote.serviceCode)}`))];
  if (!requestedCode && serviceKeys.length > 1) return { status: "AMBIGUOUS_SERVICE", matches: matches.slice(0, 10).map(({ comparison, quote }) => ({ comparisonId: comparison.comparisonId || comparison.id, serviceCode: quote.serviceCode, provider: quote.providerDisplayName || quote.provider || null })) };
  if (!requestedProvider && providers.length > 1) {
    return {
      status: "AMBIGUOUS_PROVIDER",
      serviceCode: String(serviceCode),
      matches: matches.map(({ comparison, quote }) => ({
        comparisonId: comparison.comparisonId || comparison.id,
        provider: { id: providerKey(quote.providerId || quote.provider), displayName: quote.providerDisplayName || providerDisplayName(quote.providerId || quote.provider) || quote.provider || null },
        freshness: freshnessOf(quote, comparison),
      })),
    };
  }
  return publicMatch(matches[0].comparison, matches[0].quote);
}

function parseServiceQuestion(message, recentMessages = []) {
  const text = String(message || "").trim();
  const explicit = text.match(/(?:service|code|ride\s*type|order\s*type)\s*#?\s*([a-z0-9_-]+)/i);
  const recent = [...recentMessages].reverse().map((item) => String(item.content || "").match(/(?:service|code|ride\s*type|order\s*type)\s*#?\s*([a-z0-9_-]+)/i)).find(Boolean);
  const followUp = /\b(?:iska|is|this|that|ye|yeh|service)\b.*\b(?:fare|price|provider|gari|gaari|vehicle|unavailable|available|kya|kon|which|what|why)\b/i.test(text) || (recent && /\b(?:fare|price|provider|gari|gaari|vehicle|unavailable|available)\b/i.test(text));
  if (!explicit && !followUp) return null;
  return { serviceCode: explicit?.[1] || recent?.[1] || null, isFollowUp: !explicit };
}

function setHistoryReaderForTests(reader) { historyReader = reader || history; }

module.exports = { lookupProviderService, parseServiceQuestion, normalizeCode, providerKey, setHistoryReaderForTests };
