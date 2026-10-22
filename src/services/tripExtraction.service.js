function cleanLocation(value) {
  return String(value || "")
    .replace(/^[\s,.:;-]+|[\s,.:;!?-]+$/g, "")
    .replace(/^(?:mujhe|main|mein|yaar)\s+/i, "")
    .replace(/^(?:bike|rickshaw|car|gaari)\s+(?:pe|par)\s+/i, "")
    .replace(/^(?:(?:hi|hello|hey)\s+)?(?:i\s+)?(?:ia|just|want|wanna)\s+(?:go\s+)?/i, "")
    .replace(/^(?:tomorrow|today|kal|aaj)(?:\s+(?:morning|evening|raat|night|subah|shaam))?\s+/i, "")
    .replace(/\s+(?:via|by|on)\s+(?:a\s+)?(?:bike|car|rickshaw|gaari|sedan)\b.*$/i, "")
    .replace(/\s+(?:tomorrow|today|kal|aaj)\b.*$/i, "")
    .replace(/\s+(?:via|by|on)\s+(?:a\s+)?(?:bike|car|rickshaw|gaari|sedan)\b.*$/i, "")
    .replace(/\s+(?:tomorrow|today|kal|aaj)\b.*$/i, "")
    .replace(/\s+(?:and|then)\s+(?:tell|show|explain|let me know)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTripLocations(message) {
  const text = String(message || "").trim();
  const patterns = [
    // A negated place is not a replacement destination. Keep it as a
    // correction signal so conversation context cannot re-introduce it.
    { pattern: /^\s*(?:no|nah|not|nahi)\s+(?:the\s+)?(.+?)[,;:]\s*(?:actually\s+)?from\s+(.+?)[?.!,]?$/i, pickup: 2, destination: null, rejected: 1, name: "reject_destination_change_pickup" },
    { pattern: /^\s*(?:no|nah|actually)\s*[,:-]?\s*from\s+(.+?)[?.!,]?$/i, pickup: 1, destination: null, name: "change_pickup" },
    { pattern: /^\s*(?:no|nah|actually|just|only)\s*[,:-]?\s*(?:(?:just|only)\s+)?(?:the\s+)?(.+?)[?.!,]?$/i, pickup: null, destination: 1, name: "change_destination" },
    { pattern: /\b(?:change|switch|update)\s+(?:the\s+)?destination\s+(?:to|as)\s+(.+?)(?:[?.!,]|$)/i, pickup: null, destination: 1, name: "change_destination" },
    { pattern: /\b(?:change|switch|update)\s+(?:the\s+)?pickup\s+(?:to|as)\s+(.+?)(?:[?.!,]|$)/i, pickup: 1, destination: null, name: "change_pickup" },
    { pattern: /^\s*(?:destination|drop(?:-?off)?)\s+(.+?)\s+(?:kar\s+do|change\s+it|set\s+it)\s*[?.!,]?$/i, pickup: null, destination: 1, name: "change_destination" },
    { pattern: /^\s*pickup\s+(.+?)\s+(?:kar\s+do|change\s+it|set\s+it)\s*[?.!,]?$/i, pickup: 1, destination: null, name: "change_pickup" },
    { pattern: /\bfrom\s+(.+?)\s+to\s+(.+?)(?:[?.!,]|$)/i, pickup: 1, destination: 2, name: "from_to" },
    { pattern: /\bto\s+(?:go\s+to\s+)?(.+?)\s+from\s+(.+?)(?:[?.!,]|$)/i, pickup: 2, destination: 1, name: "to_from" },
    { pattern: /^\s*(.+?)\s+from\s+(.+?)(?:[?.!,]|$)/i, pickup: 2, destination: 1, name: "destination_from_pickup" },
    { pattern: /\bpickup\s*(?:is|:)\s*(.+?)\s+(?:and|&)\s*(?:drop(?:-?off)?|destination)\s*(?:is|:)\s*(.+?)(?:[?.!,]|$)/i, pickup: 1, destination: 2, name: "labeled" },
    { pattern: /\b(.+?)\s+se\s+(.+?)\s+(?:jana|jaana|jāna|go|going|travel)\b/i, pickup: 1, destination: 2, name: "roman_urdu" },
    { pattern: /^(?!.*\b(?:what|is|should|if|how|can|could|would|why|barish|rain|safe|book|fare)\b)(.+?)\s+to\s+(.+?)(?:[?.!,]|$)/i, pickup: 1, destination: 2, name: "short_from_to" },
  ];
  for (const candidate of patterns) {
    const match = text.match(candidate.pattern);
    if (!match) continue;
    const pickup = candidate.pickup == null ? null : cleanLocation(match[candidate.pickup]);
    const destination = candidate.destination == null ? null : cleanLocation(match[candidate.destination]);
    const rejected = candidate.rejected == null ? null : cleanLocation(match[candidate.rejected]);
    if ((pickup && destination && pickup.toLowerCase() !== destination.toLowerCase()) || ((candidate.name === "change_destination" || candidate.name === "change_pickup" || candidate.name === "reject_destination_change_pickup") && (pickup || destination))) {
      return { pickup, destination, pattern: candidate.name, ...(rejected ? { rejected } : {}) };
    }
  }
  return { pickup: null, destination: null, pattern: null };
}

module.exports = { cleanLocation, extractTripLocations };
