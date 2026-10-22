const { FAIRFARE_POLICY } = require("./fairFarePolicy");

const schema = Object.freeze({
  scope: ["in_scope", "out_of_scope", "unsafe", "ambiguous"],
  intents: ["route", "fare_comparison", "provider_availability", "vehicle_recommendation", "travel_timing", "app_help", "service_identity", "general_travel", "follow_up", "unknown"],
  languages: FAIRFARE_POLICY.languages,
});

function emptyUnderstanding() {
  return { scope: "ambiguous", intent: "unknown", pickup: null, destination: null, vehiclePreference: null, travelTime: null, timezone: "Asia/Karachi", corrections: [], rejectedLocations: [], missingInformation: [], replyLanguage: "english", confidence: 0 };
}

function structuredText(result) {
  const candidates = [result?.text, result?.content, result?.output_text, result?.message?.content];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      const text = candidate.map((item) => typeof item === "string" ? item : item?.text).filter(Boolean).join("\n");
      if (text.trim()) return text;
    }
  }
  return null;
}

function parseJson(text) {
  if (typeof text !== "string" || !text.trim()) return { value: null, issue: "EMPTY_MODEL_CONTENT" };
  const value = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return { value: JSON.parse(value), issue: null }; } catch {}
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return { value: JSON.parse(value.slice(start, end + 1)), issue: "JSON_WRAPPED_IN_TEXT" }; } catch { return { value: null, issue: "INVALID_JSON" }; }
  }
  return { value: null, issue: "INVALID_JSON" };
}
function location(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim()) return { query: value.trim().slice(0, 200) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const query = String(value.query || value.name || "").trim();
  return query ? { query: query.slice(0, 200), cityHint: value.cityHint ? String(value.cityHint).slice(0, 80) : null } : null;
}
function validate(raw) {
  const out = emptyUnderstanding();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...out, validationError: "INVALID_OBJECT", validationIssues: ["INVALID_OBJECT"] };
  const issues = [];
  if (!schema.scope.includes(raw.scope)) issues.push("scope");
  if (!schema.intents.includes(raw.intent)) issues.push("intent");
  if (raw.pickup != null && !location(raw.pickup)) issues.push("pickup");
  if (raw.destination != null && !location(raw.destination)) issues.push("destination");
  if (raw.replyLanguage != null && !schema.languages.includes(raw.replyLanguage)) issues.push("replyLanguage");
  out.scope = schema.scope.includes(raw.scope) ? raw.scope : "ambiguous";
  out.intent = schema.intents.includes(raw.intent) ? raw.intent : "unknown";
  out.pickup = location(raw.pickup); out.destination = location(raw.destination);
  out.vehiclePreference = raw.vehiclePreference == null ? null : String(raw.vehiclePreference).slice(0, 40);
  out.travelTime = raw.travelTime == null ? null : String(raw.travelTime).slice(0, 120);
  out.timezone = typeof raw.timezone === "string" && raw.timezone.length <= 80 ? raw.timezone : "Asia/Karachi";
  out.corrections = Array.isArray(raw.corrections) ? raw.corrections.filter((v) => typeof v === "string").slice(0, 5) : [];
  out.rejectedLocations = Array.isArray(raw.rejectedLocations) ? raw.rejectedLocations.map(location).filter(Boolean).slice(0, 5) : [];
  out.missingInformation = Array.isArray(raw.missingInformation) ? raw.missingInformation.filter((v) => typeof v === "string").slice(0, 6) : [];
  out.replyLanguage = schema.languages.includes(raw.replyLanguage) ? raw.replyLanguage : "english";
  out.confidence = Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0;
  if (out.pickup && out.destination) out.missingInformation = out.missingInformation.filter((v) => !/pickup|destination|drop.?off/i.test(v));
  if (issues.length) { out.validationError = "SCHEMA_VALIDATION_FAILED"; out.validationIssues = issues; }
  return out;
}

async function understand({ llmClient, message, context = {} } = {}) {
  if (!llmClient || typeof llmClient.completeDetailed !== "function") return { ok: false, error: "LLM_UNAVAILABLE", understanding: emptyUnderstanding() };
  const prompt = `Return one valid JSON object only, with no markdown, explanation, or reasoning. Use fields scope, intent, pickup, destination, vehiclePreference, travelTime, timezone, corrections, rejectedLocations, missingInformation, replyLanguage, confidence. Scope must be one of ${schema.scope.join(", ")}; intent one of ${schema.intents.join(", ")}; replyLanguage one of ${schema.languages.join(", ")}. pickup and destination are either null or {query,cityHint}; preserve current-message corrections over history. Never invent coordinates. Message: ${String(message || "").slice(0, 2000)}`;
  try {
    const result = await llmClient.completeDetailed({ message: prompt, context: { ...context, semanticUnderstanding: true }, toolDefinitions: [] });
    const content = structuredText(result);
    const parsed = parseJson(content);
    const understanding = validate(parsed.value);
    return { ok: understanding.validationError == null, understanding, diagnostics: { attempted: true, succeeded: understanding.validationError == null, parseIssue: parsed.issue, validationIssues: understanding.validationIssues || [], contentField: content === result?.text ? "text" : "alternate" }, modelId: result?.modelId || null, provider: result?.provider || null };
  } catch (error) { return { ok: false, error: error.code || "SEMANTIC_UNAVAILABLE", diagnostics: { attempted: true, succeeded: false, errorCategory: error.code || "SEMANTIC_UNAVAILABLE" }, understanding: emptyUnderstanding() }; }
}

module.exports = { schema, emptyUnderstanding, validateSemanticUnderstanding: validate, parseSemanticJson: parseJson, structuredSemanticText: structuredText, understand };
