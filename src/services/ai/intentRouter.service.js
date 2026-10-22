function has(text, pattern) { return pattern.test(String(text || "")); }

function routeIntent(message, context = {}) {
  const text = String(message || "").trim();
  if (has(text, /(?:service|code|ride\s*type|order\s*type)\s*#?\s*[a-z0-9_-]+|(?:which|what)\s+(?:service|ride\s*type)|(?:iska|is ka|this|that)\s+(?:fare|price|provider|gari|gaari|vehicle)\b/i)) return { intent: "service_identity", confidence: "high", explicitComparisonIntent: false };
  if (context.hasFareRideContext && ((has(text, /\b(?:aur|and|also|again|phir|same)\b/i) && has(text, /\b(?:\d{1,2}(?::\d{2})?|time|fare|price|kiraya)\b/i)) || has(text, /\b(?:bike|car|rickshaw)\s+(?:par|mein|me)\b/i))) return { intent: "future_fare_follow_up", confidence: "high", explicitComparisonIntent: false };
  if (has(text, /\b(?:kal|tomorrow|aaj|today|friday|monday|tuesday|wednesday|thursday|saturday|sunday|subah|morning|shaam|evening|raat|night|later|baad)\b/i) && has(text, /\b(?:fare|price|cost|kiraya|ride|jana|jaana|leave|nikal)\b/i)) return { intent: "future_fare_plan", confidence: "high", explicitComparisonIntent: false };
  if (has(text, /\b(?:current|latest|recent|pichli|last|my)\b.*\b(?:comparison|fares?|prices?|quotes?)\b|\b(?:comparison|fares?|prices?)\b.*\b(?:show|explain|latest|recent|pichli)\b/i) && context.hasComparison) return { intent: "latest_comparison", confidence: "high", explicitComparisonIntent: false };
  if (has(text, /(?:\b(?:status|available|unavailable|down|working)\b.*\b(?:provider|yango|bykea|indrive|in\s*drive)\b|\b(?:provider|yango|bykea|indrive|in\s*drive)\b.*\b(?:status|available|unavailable|down|working)\b)/i)) return { intent: "provider_status", confidence: "high", explicitComparisonIntent: false };
  const comparison = has(text, /\b(?:compare|comparison|cheapest|cheaper|sasti|sasta|sab\s+se\s+sasti|fastest|best\s+option|which\s+ride|kaunsi\s+ride)\b/i);
  if (comparison && has(text, /\b(?:ride|fares?|prices?|provider|bike|car|rickshaw|vehicle|yango|bykea|indrive|in\s*drive|option)\b/i)) return { intent: has(text, /\b(?:cheapest|cheaper|sasti|sasta|sab\s+se\s+sasti)\b/i) ? "cheapest_ride" : "compare_fares", confidence: "high", explicitComparisonIntent: true };
  if (has(text, /\b(?:cheapest|cheaper|sasti|sasta|sab\s+se\s+sasti)\b/i) && has(text, /\b(?:time|waqt|kab|hour)\b/i)) return { intent: "future_fare_plan", confidence: "high", explicitComparisonIntent: false };
  if (has(text, /\b(?:distance|duration|how long|kitna\s+(?:time|door)|route|raasta|rasta)\b/i)) return { intent: "route_information", confidence: "high", explicitComparisonIntent: false };
  if (has(text, /\b(?:where|location|find|search|select|kahan|jagah|location)\b/i) && !has(text, /\b(?:fare|price|ride)\b/i)) return { intent: "location_lookup", confidence: "medium", explicitComparisonIntent: false };
  if (has(text, /\b(?:help|problem|issue|error|login|account|app|screen|kaise\s+use|how\s+do\s+i)\b/i) && !has(text, /\b(?:fare|ride|route|provider)\b/i)) return { intent: "app_help", confidence: "medium", explicitComparisonIntent: false };
  if (context.hasFareRideContext && has(text, /\b(?:aur|and|also|iska|is ka|this|that|wali|wala|same|phir)\b/i)) return { intent: "follow_up", confidence: "medium", explicitComparisonIntent: false };
  if (has(text, /\b(?:from|to|se|jana|jaana|go|airport|dha|pickup|dropoff|destination)\b/i)) return { intent: "current_trip", confidence: "medium", explicitComparisonIntent: false };
  return { intent: "ambiguous", confidence: "low", explicitComparisonIntent: false };
}

function buildServerIntent(message, context = {}) {
  const result = routeIntent(message, context);
  if (context.semanticUnderstanding?.intent && context.semanticUnderstanding.intent !== "unknown") {
    const mapped = { route: "current_trip", fare_comparison: "compare_fares", provider_availability: "provider_status", vehicle_recommendation: "follow_up", travel_timing: "follow_up", app_help: "app_help", service_identity: "service_identity", general_travel: "follow_up", follow_up: "follow_up" }[context.semanticUnderstanding.intent];
    if (mapped) return { ...result, intent: mapped, confidence: context.semanticUnderstanding.confidence >= 0.65 ? "high" : "medium", explicitComparisonIntent: mapped === "compare_fares" && Boolean(context.userExplicitlyRequestedComparison) };
  }
  return { ...result, explicitComparisonIntent: result.explicitComparisonIntent === true && Boolean(context.userExplicitlyRequestedComparison) };
}

module.exports = { routeIntent, buildServerIntent };
