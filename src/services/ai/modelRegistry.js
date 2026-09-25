const MODELS = Object.freeze([
  { id: "inclusionai/ling-3.0-flash-fin:free", label: "Ling 3.0 Flash Fin", enabled: true, note: "Candidate free OpenRouter model; exact provider availability is verified by the diagnostic." },
  { id: "poolside/laguna-s-2.1:free", label: "Laguna S 2.1", enabled: true, note: "Candidate free OpenRouter model; exact provider availability is verified by the diagnostic." },
  { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning", enabled: true, note: "Candidate free OpenRouter model; exact provider availability is verified by the diagnostic." },
  { id: "stealth/space-bunny-alpha", label: "Space Bunny Alpha", enabled: true, note: "Exact slug verified against the public OpenRouter catalog; privacy review remains required before private context." },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B IT", enabled: true, note: "Candidate free OpenRouter model; exact provider availability is verified by the diagnostic." },
]);

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

function getModel(id) { return BY_ID.get(String(id || "")) || null; }
function isAllowlisted(id) { return Boolean(getModel(id)?.enabled); }
function configuredModel(env = process.env) { return String(env.AI_MODEL || "inclusionai/ling-3.0-flash-fin:free").trim(); }
function parseFallbacks(env = process.env) {
  if (String(env.AI_MODEL_FALLBACK_ENABLED || "false").toLowerCase() !== "true") return [];
  return [...new Set(String(env.AI_MODEL_FALLBACKS || "").split(",").map((id) => id.trim()).filter(Boolean))];
}
function validateConfiguredModels(env = process.env) {
  const ids = [configuredModel(env), ...parseFallbacks(env)];
  const invalid = ids.filter((id) => !isAllowlisted(id));
  if (invalid.length) { const error = new Error(`AI model is not allowlisted: ${invalid.join(", ")}`); error.code = "LLM_MODEL_ERROR"; throw error; }
  return ids;
}

module.exports = { MODELS, getModel, isAllowlisted, configuredModel, parseFallbacks, validateConfiguredModels };
