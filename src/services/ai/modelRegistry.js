const MODELS = Object.freeze([
  { id: "grok-4.7", label: "Grok 4.7", enabled: true, note: "xAI model with documented function calling." },
  { id: "grok-4.3", label: "Grok 4.3", enabled: true, note: "xAI model with documented function calling." },
].map((model) => Object.freeze({ ...model, supportsTools: model.supportsTools === true })));

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

function getModel(id) { return BY_ID.get(String(id || "")) || null; }
function supportsTools(id) { return getModel(id)?.supportsTools === true; }
function isAllowlisted(id) { return Boolean(getModel(id)?.enabled); }
function configuredModel(env = process.env) { return String(env.AI_MODEL || "inclusionai/ling-3.1-flash").trim(); }
function parseFallbacks(env = process.env) {
  if (String(env.AI_MODEL_FALLBACK_ENABLED || "false").toLowerCase() !== "true") return [];
  return [...new Set(String(env.AI_MODEL_FALLBACKS || "").split(",").map((id) => id.trim()).filter(Boolean))];
}
function resolveConfiguredModels(env = process.env) {
  const requested = [configuredModel(env), ...parseFallbacks(env)];
  const invalid = [...new Set(requested.filter((id) => !isAllowlisted(id)))];
  return { models: [...new Set(requested.filter(isAllowlisted))], invalid };
}
function validateConfiguredModels(env = process.env) {
  const ids = [configuredModel(env), ...parseFallbacks(env)];
  const invalid = ids.filter((id) => !isAllowlisted(id));
  if (invalid.length) { const error = new Error(`AI model is not allowlisted: ${invalid.join(", ")}`); error.code = "LLM_MODEL_ERROR"; throw error; }
  return ids;
}

module.exports = { MODELS, getModel, supportsTools, isAllowlisted, configuredModel, parseFallbacks, resolveConfiguredModels, validateConfiguredModels };
