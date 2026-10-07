const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseRetryAfterMs(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function headerValue(headers, name) {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? headers[key] : null;
}

function rateLimitMetadata(headers = {}) {
  return {
    retryAfterMs: parseRetryAfterMs(headerValue(headers, "retry-after")),
    resetRequests: headerValue(headers, "x-ratelimit-reset-requests"),
    resetTokens: headerValue(headers, "x-ratelimit-reset-tokens"),
    remainingRequests: headerValue(headers, "x-ratelimit-remaining-requests"),
    remainingTokens: headerValue(headers, "x-ratelimit-remaining-tokens"),
  };
}

function groqCandidate({ model, apiKey }) {
  return { provider: "groq", model, apiKey, endpoint: GROQ_ENDPOINT, groq: true };
}

function openRouterCandidate({ model, apiKey, endpoint }) {
  return { provider: "openrouter", model, apiKey, endpoint, groq: false };
}

function candidatesFor(settings, registry) {
  const candidates = [];
  if (settings.primaryProvider === "groq" && settings.groqApiKey) {
    candidates.push(groqCandidate({ model: settings.groqModel, apiKey: settings.groqApiKey }));
    if (settings.fallbackEnabled && settings.groqFallbackModel && settings.groqFallbackModel !== settings.groqModel) {
      candidates.push(groqCandidate({ model: settings.groqFallbackModel, apiKey: settings.groqApiKey }));
    }
  }
  if (settings.fallbackEnabled && settings.openRouterApiKey) {
    const configured = registry.resolveConfiguredModels(process.env);
    candidates.push(...configured.models.map((model) => openRouterCandidate({ model, apiKey: settings.openRouterApiKey, endpoint: settings.openRouterEndpoint })));
  }
  return candidates;
}

function requestBody(candidate, { systemInstructions, message, context, history }) {
  const body = {
    model: candidate.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemInstructions },
      { role: "system", content: `Fair Fare grounding (authoritative JSON; current data outranks old conversation):\n${JSON.stringify({ ...context, recentConversation: undefined })}` },
      ...history,
      { role: "user", content: message },
    ],
  };
  if (candidate.groq) {
    body.max_completion_tokens = positiveInt(process.env.GROQ_MAX_COMPLETION_TOKENS, 450);
    body.reasoning_effort = process.env.GROQ_REASONING_EFFORT || "low";
    body.reasoning_format = "hidden";
  } else {
    body.max_tokens = positiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 450);
  }
  return body;
}

module.exports = { GROQ_ENDPOINT, candidatesFor, groqCandidate, openRouterCandidate, requestBody, rateLimitMetadata, parseRetryAfterMs };
