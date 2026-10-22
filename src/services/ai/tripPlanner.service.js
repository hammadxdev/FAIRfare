const DEFAULT_TIMEZONE = "Asia/Karachi";

function parseTime(text) {
  const match = String(text || "").match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] || 0); const meridiem = String(match[3] || "").toLowerCase();
  if (minute > 59 || hour > 23 || (meridiem && hour > 12)) return null;
  if (meridiem === "pm" && hour < 12) hour += 12; if (meridiem === "am" && hour === 12) hour = 0;
  return { hour, minute, text: match[0].trim() };
}
function resolveDepartureAt(text, requestTimestamp = new Date(), timezone = DEFAULT_TIMEZONE) {
  const time = parseTime(text); if (!time) return { value: null, timezone, reason: "MISSING_TIME" };
  const base = new Date(requestTimestamp); if (Number.isNaN(base.getTime())) return { value: null, timezone, reason: "INVALID_REQUEST_TIMESTAMP" };
  const lower = String(text).toLowerCase(); const dayOffset = /\b(?:tomorrow|kal)\b/.test(lower) ? 1 : 0;
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset, time.hour, time.minute));
  return { value: date.toISOString(), timezone, approximateTimezone: true };
}
function extractPlanningFields(message, { requestTimestamp = new Date(), timezone = DEFAULT_TIMEZONE, context = {} } = {}) {
  const text = String(message || "").trim();
  const route = text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:[?.!,]|$)/i) || text.match(/(.+)\s+se\s+(.+?)\s+jana(?:\s+hai)?/i) || text.match(/\bto\s+(.+?)\s+from\s+(.+?)(?:[?.!,]|$)/i);
  const reversed = Boolean(route && /^to\b/i.test(route[0]));
  const pickupRaw = route ? (reversed ? route[2] : route[1]) : context.pickup || null;
  const stripTemporal = (value) => String(value || "").replace(/\s+(?:at|on)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?\b.*$/i, "").replace(/\s+(?:kal|tomorrow|aaj|today|subah|morning|shaam|evening|raat|night)\b.*$/i, "").trim();
  const destination = route ? stripTemporal(reversed ? route[1] : route[2]) : context.destination || null;
  const pickup = pickupRaw ? String(pickupRaw).replace(/\b(?:kal|tomorrow|aaj|today|subah|morning|shaam|evening|raat|night)\b/ig, "").replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/ig, "").trim() : null;
  const vehicleType = /\b(?:bike|motorbike|car|rickshaw|gaari|gari)\b/i.exec(text)?.[0]?.toLowerCase() || context.vehicleType || null;
  const departure = resolveDepartureAt(text, requestTimestamp, timezone);
  if (!departure.value && route && /\b\d{1,2}\s+baje\b/i.test(text)) {
    const impliedMeridiem = /\b(?:shaam|evening|raat|night)\b/i.test(text) ? "pm" : "am";
    const implied = resolveDepartureAt(text.replace(/\bbaje\b/ig, impliedMeridiem), requestTimestamp, timezone);
    if (implied.value) departure.value = implied.value;
  }
  const hasFutureCue = /\b(?:kal|tomorrow|aaj|today|subah|morning|shaam|evening|raat|night|later|baad)\b/i.test(text);
  const missingFields = []; if (!pickup) missingFields.push("pickup"); if (!destination) missingFields.push("destination"); if (!departure.value && (hasFutureCue || /\b(?:fare|price|kiraya)\b/i.test(text))) missingFields.push("departureTime");
  return { pickup, destination, city: /\b(lahore|karachi|islamabad|rawalpindi|multan|peshawar|quetta|faisalabad)\b/i.exec(text)?.[1] || context.city || null, timezone, departureAt: departure.value, vehicleType, budget: null, oneWay: true, missingFields, status: missingFields.length ? "NEEDS_CLARIFICATION" : "READY", source: "parsed_text" };
}
function planTrip(options = {}) { return extractPlanningFields(options.message, options); }
module.exports = { DEFAULT_TIMEZONE, parseTime, resolveDepartureAt, extractPlanningFields, planTrip };
