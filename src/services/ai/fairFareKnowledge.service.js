const MAX_RESULTS = 3;
const MAX_FIELD_LENGTH = 600;
const { retrieveKnowledge, evidenceForPrompt } = require("./knowledgeRetrieval.service");

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

async function retrievePersistentFairFareKnowledge(message, options = {}) {
  const schemaVerified = String(process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED || "false").toLowerCase() === "true";
  const knowledgeEnabled = String(process.env.FAIRFARE_AI_KNOWLEDGE_ENABLED || "false").toLowerCase() === "true";
  if (!schemaVerified || !knowledgeEnabled) return [];
  try {
    const result = await retrieveKnowledge({ message, ...options });
    return evidenceForPrompt(result, 6000).slice(0, MAX_RESULTS);
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.warn("[AI] knowledge retrieval unavailable", { code: error.code || "KNOWLEDGE_RETRIEVAL_FAILED" });
    return [];
  }
}

module.exports = { retrieveFairFareKnowledge, retrievePersistentFairFareKnowledge, MAX_RESULTS, MAX_FIELD_LENGTH };
