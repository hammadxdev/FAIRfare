/* Same-process backend-client diagnostic. Never print AI_API_KEY or Authorization. */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const client = require("../src/services/ai/llmClient");

async function main() {
  const settings = client.config();
  const summary = client.safeConfigSummary(settings);
  const started = Date.now();
  let result;
  if (!settings.apiKey) result = { httpStatus: null, providerReached: false, classification: "KEY_NOT_CONFIGURED", providerError: "AI_API_KEY is missing before request" };
  else {
    try {
      const response = await client.postJson(settings.endpoint, { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` }, JSON.stringify({ model: settings.model, messages: [{ role: "user", content: "Reply with exactly OK." }] }), settings.timeoutMs);
      const content = response?.choices?.[0]?.message?.content;
      result = { httpStatus: 200, providerReached: true, classification: typeof content === "string" && content.trim() ? "AVAILABLE" : "MALFORMED_RESPONSE", assistantContentPresent: typeof content === "string" && Boolean(content.trim()) };
    } catch (error) {
      result = { httpStatus: Number.isInteger(error.statusCode) ? error.statusCode : null, providerReached: Number.isInteger(error.statusCode), classification: error.code || "LLM_PROVIDER_ERROR", providerError: error.safeReason || null };
    }
  }
  console.log(JSON.stringify({ summary, result: { ...result, latencyMs: Date.now() - started } }, null, 2));
}

if (require.main === module) main().catch(() => { console.error("AI client diagnostic failed safely."); process.exitCode = 1; });
