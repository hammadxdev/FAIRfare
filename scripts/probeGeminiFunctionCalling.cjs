/* Explicit manual diagnostic. Never imported by startup or automated tests. */
const https = require("https");
require("../src/config/env");
const { requestBody, geminiCandidate } = require("../src/services/ai/providerAdapters");

const ALL_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const syntheticTool = { name: "synthetic_lookup", description: "Returns a harmless synthetic value for compatibility testing.", schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } };

function postJson(url, apiKey, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const started = Date.now();
    const request = https.request({ hostname: parsed.hostname, path: `${parsed.pathname}${parsed.search}`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "x-goog-api-key": apiKey } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* sanitized error below */ } resolve({ status: response.statusCode, elapsedMs: Date.now() - started, body: json }); });
    });
    request.setTimeout(12000, () => request.destroy(new Error("probe_timeout")));
    request.on("error", (error) => reject(Object.assign(error, { elapsedMs: Date.now() - started })));
    request.write(body); request.end();
  });
}

function errorCategory(response) {
  const status = response?.body?.error?.status || response?.body?.error?.code;
  const message = String(response?.body?.error?.message || "").toLowerCase();
  if (status === "RESOURCE_EXHAUSTED" || response?.status === 429 || /quota|rate.?limit|exhausted/.test(message)) return "quota_rejected";
  if (response?.status >= 400) return `http_${response.status}`;
  return response ? "invalid_probe_response" : "transport_error";
}

function parts(response) { return Array.isArray(response?.body?.candidates?.[0]?.content?.parts) ? response.body.candidates[0].content.parts : []; }
function safeError(response) { return response?.body?.error ? { status: response.body.error.status || null, code: response.body.error.code || null, message: String(response.body.error.message || "").slice(0, 180) } : null; }

async function probeModel(model, apiKey) {
  const candidate = geminiCandidate({ model, apiKey });
  const firstBody = requestBody(candidate, { systemInstructions: "Compatibility probe. Use the declared synthetic function when appropriate.", message: "Call synthetic_lookup with label probe.", context: { compatibilityProbe: true }, history: [], toolDefinitions: [syntheticTool], toolMessages: [{ role: "user", content: "Call synthetic_lookup with label probe." }], maxOutputTokens: 128, toolChoice: "auto" });
  const first = await postJson(candidate.endpoint, apiKey, JSON.stringify(firstBody));
  const firstParts = parts(first);
  const callPart = firstParts.find((part) => part.functionCall);
  const firstArgs = callPart?.functionCall?.args;
  const firstValid = Boolean(callPart?.functionCall?.name === syntheticTool.name && firstArgs && typeof firstArgs === "object" && !Array.isArray(firstArgs) && typeof firstArgs.label === "string");
  if (first.status === 429 || first.status >= 400 || !firstValid) return { model, firstRound: { status: first.status || null, elapsedMs: first.elapsedMs || null, functionCall: Boolean(callPart), validArguments: firstValid, errorCategory: errorCategory(first), error: safeError(first) }, secondRound: { status: "not_run" }, nativeFunctionCallingCompatible: false, compatibilityStatus: "not_verified", quotaRejected: errorCategory(first) === "quota_rejected", freeTierEligibility: "not_assessed" };

  const id = "probe-call-1";
  const secondBody = requestBody(candidate, { systemInstructions: "Compatibility probe. Return a short confirmation after the synthetic function result.", message: "Call synthetic_lookup with label probe.", context: { compatibilityProbe: true }, history: [], toolDefinitions: [syntheticTool], toolMessages: [{ role: "user", content: "Call synthetic_lookup with label probe." }, { role: "assistant", tool_calls: [{ id, type: "function", thoughtSignature: callPart.thoughtSignature || null, function: { name: callPart.functionCall.name, arguments: JSON.stringify(firstArgs) } }] }, { role: "tool", tool_call_id: id, name: callPart.functionCall.name, content: JSON.stringify({ status: "OK", label: "synthetic" }) }], maxOutputTokens: 128, toolChoice: "auto" });
  const second = await postJson(candidate.endpoint, apiKey, JSON.stringify(secondBody));
  const secondParts = parts(second);
  const secondValid = secondParts.some((part) => typeof part.text === "string" && part.text.trim()) || secondParts.some((part) => part.functionCall);
  return { model, firstRound: { status: first.status, elapsedMs: first.elapsedMs, functionCall: true, validArguments: true, thoughtSignaturePresent: Boolean(callPart.thoughtSignature), errorCategory: null }, secondRound: { status: second.status || null, elapsedMs: second.elapsedMs || null, usableContinuation: secondValid, functionCall: secondParts.some((part) => part.functionCall), text: secondParts.some((part) => typeof part.text === "string" && part.text.trim()), errorCategory: secondValid ? null : errorCategory(second), error: safeError(second) }, nativeFunctionCallingCompatible: second.status >= 200 && second.status < 300 && secondValid, compatibilityStatus: second.status >= 200 && second.status < 300 && secondValid ? "verified_two_round_synthetic_transcript" : "not_verified", quotaRejected: errorCategory(second) === "quota_rejected", freeTierEligibility: "not_assessed" };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const requested = process.argv.slice(2).find((arg) => arg.startsWith("--model="));
  const models = requested ? [requested.slice("--model=".length)] : ALL_MODELS;
  for (const model of models) {
    if (!ALL_MODELS.includes(model)) { console.log(JSON.stringify({ model, compatibilityStatus: "not_verified", errorCategory: "model_not_in_probe_allowlist" })); continue; }
    try { console.log(JSON.stringify(await probeModel(model, apiKey))); } catch (error) { console.log(JSON.stringify({ model, compatibilityStatus: "not_verified", errorCategory: error.message === "probe_timeout" ? "timeout" : "transport_error", elapsedMs: error.elapsedMs || null })); }
  }
}
main().catch((error) => { console.error(JSON.stringify({ error: String(error.message || error).slice(0, 180) })); process.exitCode = 1; });
