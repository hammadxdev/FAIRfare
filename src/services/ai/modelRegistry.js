const MODELS = Object.freeze([
  { id: "inclusionai/ling-3.1-flash", label: "Ling 3.1 Flash", enabled: true, note: "Current OpenRouter catalog entry; zero-priced catalog model." },
  { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning", enabled: true, note: "Current OpenRouter free catalog entry." },
  { id: "apodex/apodex-1.1-mini:free", label: "Apodex 1.1 Mini", enabled: true, note: "Current OpenRouter free catalog text-output model." },
  { id: "dots-studio/dots-3-note-preview:free", label: "Dots3 Note Preview", enabled: true, note: "Current OpenRouter free catalog text-output model." },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super", enabled: true, note: "Current OpenRouter free catalog text-output model." },
  { id: "thinkingmachines/inkling:free", label: "Inkling", enabled: true, note: "Current OpenRouter free catalog text-output model." },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra", enabled: true, note: "Current OpenRouter free catalog text-output model." },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B IT", enabled: true, note: "Current OpenRouter free catalog entry." },
]);

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

function getModel(id) { return BY_ID.get(String(id || "")) || null; }
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

module.exports = { MODELS, getModel, isAllowlisted, configuredModel, parseFallbacks, resolveConfiguredModels, validateConfiguredModels };
