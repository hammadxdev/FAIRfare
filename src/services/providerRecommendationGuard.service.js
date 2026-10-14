const {
  canonicalProviderId,
  providerDisplayName,
  supportedProviderDisplayNames,
} = require("../providers/provider.registry");

const UNSUPPORTED = [
  ["Uber", /\buber\b/i], ["Careem", /\bcareem\b/i], ["Lyft", /\blyft\b/i],
  ["Ola", /\bola\b/i], ["Grab", /\bgrab\b/i], ["Rapido", /\brapido\b/i], ["Bolt", /\bbolt\b/i],
];
const RECOMMENDATION = /\b(?:recommend|use|take|choose|pick|book|best|cheapest|fastest|comfortable|budget|option|suggest|prefer|better|suitable)\b|\b(?:sasti|sasta|konsi|kaunsi|behtar|munasib|lena|lo|chahiye)\b/i;
const EXCLUSION = /\b(?:not\s+(?:compared|supported|available)|does\s+not\s+compare|doesn'?t\s+compare|unsupported|cannot\s+recommend|can'?t\s+recommend|no\s+(?:verified\s+)?comparison)\b/i;

function mentionsUnsupported(value) {
  return UNSUPPORTED.filter(([, re]) => re.test(String(value || ""))).map(([name]) => name);
}

function explicitUnsupportedQuestion(value) {
  const text = String(value || "");
  return mentionsUnsupported(text).length > 0 && /\?|\b(?:or|about|vs|versus|compare|does|can|what)\b/i.test(text);
}

function normalizeComparison(comparison) {
  if (!comparison || typeof comparison !== "object") return null;
  const rides = Array.isArray(comparison.rides)
    ? comparison.rides.map((ride) => ({
      ...ride,
      provider: providerDisplayName(ride?.providerId || ride?.providerName || ride?.provider) || ride?.provider,
      providerId: canonicalProviderId(ride?.providerId || ride?.providerName || ride?.provider) || ride?.providerId || null,
    })).filter((ride) => canonicalProviderId(ride.providerId || ride.provider))
    : [];
  const derivedFacts = comparison.derivedFacts ? { ...comparison.derivedFacts } : undefined;
  for (const key of ["cheapest", "fastest", "mostComfortable"]) {
    if (derivedFacts?.[key]) derivedFacts[key] = { ...derivedFacts[key], provider: providerDisplayName(derivedFacts[key].providerId || derivedFacts[key].providerName || derivedFacts[key].provider) || derivedFacts[key].provider };
  }
  return { ...comparison, rides, ...(derivedFacts ? { derivedFacts } : {}) };
}

function safeReply({ message, comparison, responseLanguage }) {
  const roman = responseLanguage === "roman_urdu";
  const names = supportedProviderDisplayNames().join(", ").replace(/, ([^,]+)$/, roman ? " aur $1" : " and $1");
  if (comparison?.rides?.length) {
    const providers = comparison.rides.map((ride) => ride.provider).filter(Boolean).filter((name, i, list) => list.indexOf(name) === i);
    if (providers.length) return roman
      ? `Fair Fare sirf ${providers.join(", ")} ko compare karta hai. Final fare aur availability provider app mein check karein.`
      : `Fair Fare only compares ${providers.join(", ")}. Check the provider app for the final fare and availability.`;
  }
  if (explicitUnsupportedQuestion(message)) return roman
    ? `Fair Fare Uber ya Careem ko compare ya recommend nahi karta. Supported options ${names} hain.`
    : `Fair Fare does not compare or recommend Uber or Careem. Supported options are ${names}.`;
  return roman
    ? `Fair Fare sirf ${names} ko compare karta hai. Is sawal ke liye verified provider comparison available nahi hai, is liye main unsupported service recommend nahi karunga.`
    : `Fair Fare compares only ${names}. A verified provider comparison is not available, so I will not recommend an unsupported service.`;
}

function enforce({ message, text, comparison, responseLanguage }) {
  const answer = String(text || "").replace(/\bQuickRide\b/gi, "Yango").replace(/\bUrban\s*Cab\b/gi, "Bykea");
  const mentions = mentionsUnsupported(answer);
  const generic = /\b(?:generic|any|other)\s+ride[- ]?hailing\s+(?:service|app|provider)\b/i.test(answer);
  const violation = mentions.length > 0
    ? RECOMMENDATION.test(answer) && !(explicitUnsupportedQuestion(message) && EXCLUSION.test(answer))
    : generic && RECOMMENDATION.test(answer);
  const normalized = normalizeComparison(comparison);
  return violation
    ? { text: safeReply({ message, comparison: normalized, responseLanguage }), comparison: normalized, violated: true, unsupportedProviders: mentions }
    : { text: answer, comparison: normalized, violated: false, unsupportedProviders: [] };
}

module.exports = { mentionsUnsupported, explicitUnsupportedQuestion, normalizeComparison, safeReply, enforce };
