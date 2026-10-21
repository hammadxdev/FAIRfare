const repository = require("./knowledgeRepository.service");

const INJECTION_PATTERN = /(?:ignore\s+(?:all\s+)?(?:previous|system|developer)\s+instructions?|reveal\s+(?:the\s+)?(?:prompt|secret|token|api\s*key)|arbitrary\s+(?:sql|http|url)|show\s+(?:credentials?|passwords?))/i;
const TERM_ALIASES = new Map([
  ["gari", "vehicle car ride"],
  ["gaari", "vehicle car ride"],
  ["sawari", "vehicle ride"],
  ["kiraya", "fare price"],
  ["mehnga", "expensive price"],
  ["sasti", "cheap cheapest price"],
  ["kaise", "how app help"],
  ["konsi", "which service vehicle"],
  ["kaunsi", "which service vehicle"],
  ["provider kon", "provider service"],
]);

function normalizeQuery(message) {
  const text = String(message || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300);
  if (!text) return "";
  const aliases = [...TERM_ALIASES.entries()].filter(([term]) => new RegExp(`\\b${term}\\b`, "i").test(text)).map(([, replacement]) => replacement);
  return [text, ...aliases].join(" ").slice(0, 300);
}

function languageFor(message, requested) {
  if (["english", "roman_urdu", "mixed"].includes(requested)) return requested === "mixed" ? "roman_urdu" : requested;
  return /\b(?:mujhe|kya|kaise|kon|konsi|kaunsi|iska|is ka|sasti|sasta|gari|gaari|kiraya|batao|hai|mein|me)\b/i.test(String(message || "")) ? "roman_urdu" : "english";
}

async function retrieveKnowledge({ message, language = null, topic = null, limit = 5, repositoryOverride = repository } = {}) {
  const text = String(message || "").trim();
  if (!text || INJECTION_PATTERN.test(text)) return { status: "NO_RETRIEVAL", reason: INJECTION_PATTERN.test(text) ? "UNSAFE_QUERY" : "EMPTY_QUERY", evidence: [] };
  const rawResults = await repositoryOverride.searchVerifiedKnowledge({ query: normalizeQuery(text), language: languageFor(text, language), topic, limit });
  const results = Array.isArray(rawResults) ? rawResults : (Array.isArray(rawResults?.evidence) ? rawResults.evidence : []);
  return { status: results.length ? "FOUND" : "NOT_FOUND", queryLanguage: languageFor(text, language), evidence: results.slice(0, 5) };
}

function evidenceForPrompt(result, maxCharacters = 6000) {
  if (!result || !Array.isArray(result.evidence)) return [];
  let remaining = Math.max(0, maxCharacters);
  return result.evidence.map((item) => {
    if (remaining <= 0) return null;
    const body = String(item.body || "").slice(0, remaining);
    remaining -= body.length;
    return { body, source: item.source, chunkId: item.chunkId, documentId: item.documentId, score: item.score };
  }).filter(Boolean);
}

module.exports = { retrieveKnowledge, evidenceForPrompt, normalizeQuery, languageFor, INJECTION_PATTERN };
