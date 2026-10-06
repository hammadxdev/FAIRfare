/* Backend-only diagnostic. Never pass or print AI_API_KEY. */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dotenvPath = path.resolve(__dirname, "..", ".env");
require("dotenv").config({ path: dotenvPath, quiet: true });
const registry = require("../src/services/ai/modelRegistry");
const client = require("../src/services/ai/llmClient");
const INITIAL_MODEL = "inclusionai/ling-3.1-flash";

function environmentReport() {
  const key = process.env.AI_API_KEY;
  return { cwd: process.cwd(), dotenvPath, dotenvExists: fs.existsSync(dotenvPath), apiKeyConfigured: Boolean(key), apiKeyLength: key?.length || 0, expectedOpenRouterPrefix: key?.startsWith("sk-or-") || false, surroundingQuotes: Boolean(key && (/^[\"']|[\"']$/.test(key))), surroundingWhitespace: Boolean(key && key !== key.trim()) };
}

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = https.get({ hostname: parsed.hostname, port: parsed.port || 443, path: `${parsed.pathname}${parsed.search}`, headers: { Accept: "application/json" } }, (response) => {
      let data = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => { try { resolve({ status: response.statusCode, body: JSON.parse(data) }); } catch { reject(Object.assign(new Error("catalog response was not JSON"), { code: "LLM_MALFORMED_RESPONSE" })); } });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(Object.assign(new Error("catalog request timed out"), { code: "LLM_TIMEOUT" })); });
    request.on("error", (error) => reject(Object.assign(new Error("catalog request failed"), { code: error.code === "ETIMEDOUT" ? "LLM_TIMEOUT" : "LLM_NETWORK_ERROR" })));
  });
}

function publicClassification(error) { return ({ LLM_AUTH_ERROR: "AUTH_ERROR", LLM_MODEL_ERROR: "MODEL_NOT_FOUND", LLM_RATE_LIMIT: "RATE_LIMITED", LLM_TIMEOUT: "TIMEOUT", LLM_NETWORK_ERROR: "NETWORK_ERROR", LLM_MALFORMED_RESPONSE: "MALFORMED_RESPONSE", LLM_PROVIDER_ERROR: "PROVIDER_ERROR" })[error?.code] || "PROVIDER_ERROR"; }
function requestBody(model, fullSmoke = false) { const messages = [{ role: "user", content: "Reply with exactly OK." }]; if (fullSmoke) messages.unshift({ role: "system", content: "You are a test assistant." }); return JSON.stringify({ model, messages }); }

async function smoke(model, endpoint, apiKey, timeoutMs, fullSmoke = false) {
  const started = Date.now();
  try {
    const response = await client.postJson(endpoint, { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, requestBody(model, fullSmoke), timeoutMs);
    const content = response?.choices?.[0]?.message?.content; const hasContent = typeof content === "string" && Boolean(content.trim());
    return { model, httpStatus: 200, latencyMs: Date.now() - started, success: hasContent, providerReached: true, assistantContentPresent: hasContent, choicesPresent: Array.isArray(response?.choices), providerError: null, classification: hasContent ? "AVAILABLE" : "MALFORMED_RESPONSE" };
  } catch (error) {
    const providerReached = Number.isInteger(error.statusCode);
    return { model, httpStatus: providerReached ? error.statusCode : null, latencyMs: Date.now() - started, success: false, providerReached, assistantContentPresent: false, choicesPresent: false, providerError: error.safeReason || null, classification: publicClassification(error) };
  }
}

async function main() {
  const env = environmentReport(); const endpoint = process.env.AI_API_URL || "https://openrouter.ai/api/v1/chat/completions"; const catalogUrl = endpoint.replace(/\/chat\/completions(?:\?.*)?$/, "/models"); const timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000);
  const report = { environment: env, apiKeyConfigured: env.apiKeyConfigured, rotationAdvisory: String(process.env.AI_ROTATION_ADVISORY || "false").toLowerCase() === "true", rotationRequired: false, initialModel: null, catalog: null, models: [] };
  if (!env.apiKeyConfigured) { report.initialModel = { model: INITIAL_MODEL, httpStatus: null, providerReached: false, classification: "KEY_NOT_CONFIGURED", providerError: "AI_API_KEY is missing before any request", assistantContentPresent: false }; report.rotationRequired = report.rotationAdvisory; console.log(JSON.stringify(report, null, 2)); return; }
  report.initialModel = await smoke(INITIAL_MODEL, endpoint, process.env.AI_API_KEY, timeoutMs);
  if (report.initialModel.classification === "AUTH_ERROR" || !["AVAILABLE", "RATE_LIMITED"].includes(report.initialModel.classification)) { console.log(JSON.stringify(report, null, 2)); return; }
  try {
    const catalog = await getJson(catalogUrl, timeoutMs); const ids = new Set((catalog.body?.data || []).map((item) => item.id)); report.catalog = { httpStatus: catalog.status, exactMatches: registry.MODELS.filter((model) => ids.has(model.id)).map((model) => model.id) };
    for (const model of registry.MODELS) { if (model.id === INITIAL_MODEL) report.models.push(report.initialModel); else if (!ids.has(model.id)) report.models.push({ model: model.id, httpStatus: null, providerReached: true, classification: "MODEL_NOT_FOUND", providerError: "exact model ID was not present in provider catalog", assistantContentPresent: false, latencyMs: 0 }); else report.models.push(await smoke(model.id, endpoint, process.env.AI_API_KEY, timeoutMs, true)); }
  } catch (error) { report.catalog = { classification: publicClassification(error), providerError: error.safeReason || null }; }
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main().catch(() => { console.error("AI smoke diagnostic failed safely."); process.exitCode = 1; });
module.exports = { getJson, smoke, environmentReport, requestBody, INITIAL_MODEL };
