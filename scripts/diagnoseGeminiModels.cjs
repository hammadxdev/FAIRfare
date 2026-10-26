/* Explicit deployment diagnostic. Never imported by startup. */
const https = require("https");
require("../src/config/env");

function getJson(url, apiKey) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "x-goog-api-key": apiKey, Accept: "application/json" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => { try { resolve({ status: response.statusCode, body: JSON.parse(body) }); } catch { reject(new Error("Google models API returned invalid JSON")); } });
    });
    request.on("error", reject);
    request.setTimeout(12000, () => { request.destroy(new Error("models.list timed out")); });
  });
}

const nativeToolCandidates = new Set(["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"]);
async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  const response = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", key);
  if (response.status < 200 || response.status >= 300) throw new Error(`models.list failed with HTTP ${response.status}`);
  const configured = new Set([process.env.GEMINI_MODEL, ...String(process.env.GEMINI_FALLBACK_MODELS || "").split(",")].filter(Boolean));
  const models = (response.body.models || []).filter((model) => nativeToolCandidates.has(model.baseModelId || String(model.name || "").replace(/^models\//, "")));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), source: "Google Gemini models.list", projectAccessibility: "verified_for_this_key", models: models.map((model) => ({ modelId: model.baseModelId || String(model.name || "").replace(/^models\//, ""), generateContent: Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"), nativeFunctionCalling: "unknown_until_generateContent_probe", freeTierEligibility: "unknown_models_list_does_not_prove_pricing", configured: configured.has(model.baseModelId || String(model.name || "").replace(/^models\//, "")), metadata: { inputTokenLimit: model.inputTokenLimit || null, outputTokenLimit: model.outputTokenLimit || null, thinking: model.thinking === true } })) }, null, 2));
}
main().catch((error) => { console.error(JSON.stringify({ error: String(error.message || error).slice(0, 240) })); process.exitCode = 1; });
