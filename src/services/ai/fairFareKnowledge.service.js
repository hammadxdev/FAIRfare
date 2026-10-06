const MAX_RESULTS = 3;
const MAX_FIELD_LENGTH = 600;

// The repository currently has no imported spreadsheet/FAQ source. Keep the
// retrieval boundary deterministic so a future sanitized export can be added
// without changing the ride-grounding contract.
function tokens(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])];
}

function retrieveFairFareKnowledge(message, entries = []) {
  const queryTokens = tokens(message);
  if (!queryTokens.length || !Array.isArray(entries)) return [];

  return entries
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const sensitiveField = Object.keys(entry).some((key) => /password|api.?key|access.?token|refresh.?token|phone|account.?id|credential/i.test(key));
      if (sensitiveField) return null;
      const searchable = [entry.topic, entry.question, entry.keywords].filter(Boolean).join(" ");
      const score = queryTokens.reduce((total, token) => total + (tokens(searchable).includes(token) ? 1 : 0), 0);
      if (!score || typeof entry.answer !== "string" || !entry.answer.trim()) return null;
      return {
        score,
        index,
        entry: {
          topic: String(entry.topic || "General").slice(0, 120),
          question: String(entry.question || "").slice(0, 240),
          answer: entry.answer.trim().slice(0, MAX_FIELD_LENGTH),
        },
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_RESULTS)
    .map(({ entry }) => entry);
}

module.exports = { retrieveFairFareKnowledge, MAX_RESULTS, MAX_FIELD_LENGTH };
