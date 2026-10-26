const FARE_RIDE_WORDS = /\b(?:fare|fares|price|prices|cost|costs|cheap|cheaper|cheapest|expensive|mehnga|mehngi|kiraya|ride|rides|trip|travel|route|pickup|dropoff|destination|provider|yango|bykea|indrive|in\s*drive|courier|parcel|package|delivery|bhejna|service|vehicle|gari|gaari|bike|rickshaw|car|compare|comparison|sasti|sasta|available|unavailable|airport|book|booking|Fair\s*Fare)\b/i;
const ROUTE_PHRASES = /(?:\b(?:go|travel|ride|drive|jana|jaana|jane|jaun)\b.{0,80}\b(?:from|se|say)\b.{0,80}\b(?:to|tak)\b|\bfrom\b.{1,100}\bto\b|\b(?:pickup|drop\s*-?\s*off|destination)\b)/i;
// A route question can name two places without using "jana" or pickup/dropoff
// language. Keep this semantic shape narrow: a distance/duration question with
// a directional relation, rather than a large inventory of place names.
const ROUTE_DISTANCE_QUESTION = /\b(?:road\s+)?(?:distance|door|dur|kitna\s+(?:door|time)|how\s+(?:far|long)|travel\s+time|duration|km|kilometers?)\b/i;
const ROUTE_RELATION = /\b(?:from|se|say)\b.{1,120}\b(?:to|tak|ka|ki|jana|jaana|jane|go|going)\b|\b(?:to|tak)\b.{1,120}\b(?:from|se|say)\b/i;
const INJECTION_WORDS = /(?:ignore\s+(?:all\s+)?(?:previous|system|developer)\s+instructions?|reveal\s+(?:the\s+)?(?:system\s+prompt|secret|token|api\s*key)|show\s+(?:me\s+)?(?:password|credentials?)|arbitrary\s+(?:sql|http|url)|access\s+another\s+user|unrestricted\s+tool|bypass\s+(?:auth|authorization))/i;
const NON_FARE_INTENT = /(?:\b(?:write|build|create|solve|tell|compose|pretend|make)\b.*\b(?:python|javascript|react|website|code|coding|math|mathematics|politic|news|love\s+letter|general\s+chatbot)\b|\b(?:latest\s+political\s+news|love\s+letter)\b)/i;
const FARE_REQUEST = /(?:\b(?:fare|ride|trip|pickup|dropoff|destination|provider|yango|bykea|indrive|kiraya|sasti|sasta|airport|service\s+#?\d+)\b|\b(?:jana|jaana)\b.{0,80}\b(?:se|to|tak)\b)/i;
const SERVICE_CODE_REQUEST = /\b(?:service|code)\s*#?\s*[a-z0-9_-]+\b/i;
const GREETING = /^(?:hi|hello|hey|salam|assalam(?:u|o)?\s*alaikum|aoa)\b[!.\s]*$/i;
const TRAVEL_WEATHER = /\b(?:rain|barish|weather|mausam|fog|dhund|storm|garmi|sardi)\b/i;

function classifyDomain(message, context = {}) {
  const text = String(message || "").trim();
  if (INJECTION_WORDS.test(text)) return { intent: "out_of_scope", allowed: false, reason: "UNSAFE_REQUEST" };
  if (!text) return { intent: "ambiguous", allowed: false, reason: "EMPTY_MESSAGE" };
  if (GREETING.test(text)) return { intent: "greeting", allowed: true, reason: "GREETING" };
  if (NON_FARE_INTENT.test(text) && !FARE_REQUEST.test(text)) return { intent: "out_of_scope", allowed: false, reason: "NON_FARE_INTENT" };
  if (NON_FARE_INTENT.test(text) && !SERVICE_CODE_REQUEST.test(text) && /(?:python|react|website|coding|mathematics|political|love\s+letter|general\s+chatbot)/i.test(text)) return { intent: "out_of_scope", allowed: false, reason: "NON_FARE_INTENT" };
  if (context.hasFareRideContext && /\b(?:aur|and|also|iska|is ka|this|that|wali|wala|again|phir|same|kitna|time|duration|distance|door)\b/i.test(text)) return { intent: "follow_up", allowed: true, reason: "CONTEXTUAL_FOLLOW_UP" };
  if (!context.hasFareRideContext && /^(?:aur|also|and)\b/i.test(text)) return { intent: "out_of_scope", allowed: false, reason: "MISSING_FARE_RIDE_CONTEXT" };
  if (FARE_RIDE_WORDS.test(text) || ROUTE_PHRASES.test(text) || (ROUTE_DISTANCE_QUESTION.test(text) && ROUTE_RELATION.test(text))) return { intent: "fare_ride", allowed: true, reason: "DOMAIN_SIGNAL" };
  if (TRAVEL_WEATHER.test(text) && /\b(?:safe|ride|bike|travel|go|jana|jaana|thokar|airport|lahore|karachi|islamabad)\b/i.test(text)) return { intent: "travel_weather", allowed: true, reason: "TRAVEL_WEATHER" };
  // Let the native model resolve uncertain natural-language requests. Explicit
  // unrelated intents and unsafe requests were rejected above.
  return { intent: "ambiguous", allowed: true, reason: "AMBIGUOUS_ALLOW_MODEL" };
}

function outOfScopeReply(message) {
  return /\b(?:kya|kaise|kon|kaunsi|mujhe|batao|gari|sasti|kiraya)\b/i.test(String(message || ""))
    ? "Main FairFare trips, fares, providers aur app features mein madad kar sakta hoon. Aap apni ride ke baare mein kya maloom karna chahte hain?"
    : "I can help with FairFare trips, fares, providers and app features. What would you like to know about your ride?";
}

module.exports = { classifyDomain, outOfScopeReply, FARE_RIDE_WORDS, INJECTION_WORDS };
