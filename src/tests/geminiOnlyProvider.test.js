const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../services/ai/llmClient");
const { schemas } = require("../services/ai/toolSchemas");
const { toGeminiSchema, requestBody } = require("../services/ai/providerAdapters");

const saved = { ...process.env };

function configure() {
  Object.assign(process.env, {
    AI_ASSISTANT_ENABLED: "true",
    AI_PRIMARY_PROVIDER: "gemini",
    GEMINI_API_KEY: "gemini-test",
    GEMINI_MODEL: "gemini-3.6-flash",
    AI_MODEL_FALLBACK_ENABLED: "false",
    AI_MODEL_FALLBACKS: "",
    GROQ_API_KEY: "groq-must-not-be-called",
    GROQ_MODEL: "openai/gpt-oss-120b",
  });
  llm.resetModelHealthForTests();
}

test.beforeEach(configure);
test.afterEach(() => {
  llm.setPostJsonForTests(null);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test("Gemini is the only active provider and receives native function declarations", async () => {
  let call;
  llm.setPostJsonForTests(async (url, headers, raw) => {
    call = { url, headers, body: JSON.parse(raw) };
    return { candidates: [{ content: { parts: [{ functionCall: { name: "search_locations", args: { query: "Alpha" } } }] } }] };
  });
  const result = await llm.completeDetailed({ message: "Find Alpha", context: { nativeToolAgent: true }, toolDefinitions: [{ name: "search_locations", schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } }] });
  assert.equal(result.provider, "gemini");
  assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  assert.equal(call.headers["x-goog-api-key"], "gemini-test");
  assert.equal(call.body.tools[0].functionDeclarations[0].name, "search_locations");
});

test("Gemini simple text response uses the adapter without tools", async () => {
  let call;
  llm.setPostJsonForTests(async (url, headers, raw) => {
    call = { url, headers, body: JSON.parse(raw) };
    return { candidates: [{ content: { parts: [{ text: "Hi from Gemini." }] } }] };
  });
  const result = await llm.completeDetailed({ message: "hi", context: {}, toolDefinitions: [] });
  assert.equal(result.text, "Hi from Gemini.");
  assert.equal(call.body.tools, undefined);
});

test("Gemini transcript contains the user message exactly once and uses systemInstruction", () => {
  const body = requestBody({ gemini: true, model: "gemini-3.6-flash" }, {
    systemInstructions: "SYSTEM_ONLY", message: "hi", context: {}, history: [],
    toolDefinitions: [], toolMessages: [{ role: "user", content: "hi" }],
  });
  const texts = body.contents.flatMap((content) => content.parts || []).filter((part) => typeof part.text === "string").map((part) => part.text);
  assert.equal(texts.filter((text) => text === "hi").length, 1);
  assert.equal(body.systemInstruction.parts[0].text, "SYSTEM_ONLY");
  assert.equal(body.toolConfig, undefined);
  assert.equal(body.contents.some((content) => content.parts?.some((part) => part.text === "SYSTEM_ONLY")), false);
});

test("Gemini parallel function responses are paired by declared name and preserve signatures", () => {
  const body = requestBody({ gemini: true, model: "gemini-3.6-flash" }, {
    systemInstructions: "system", message: "route", context: {}, history: [], toolDefinitions: [{ name: "search_locations", schema: { type: "object", properties: {}, additionalProperties: false } }],
    toolMessages: [
      { role: "user", content: "route" },
      { role: "assistant", tool_calls: [
        { id: "gemini-1", thoughtSignature: "sig-1", function: { name: "search_locations", arguments: '{"query":"A"}' } },
        { id: "gemini-2", function: { name: "search_locations", arguments: '{"query":"B"}' } },
      ] },
      { role: "tool", tool_call_id: "gemini-1", name: "search_locations", content: '{"status":"OK","candidates":[]}' },
      { role: "tool", tool_call_id: "gemini-2", name: "search_locations", content: '{"status":"OK","candidates":[]}' },
    ],
  });
  const model = body.contents.find((content) => content.role === "model");
  const response = body.contents.find((content) => content.parts?.some((part) => part.functionResponse));
  assert.deepEqual(model.parts.map((part) => part.functionCall.name), ["search_locations", "search_locations"]);
  assert.equal(model.parts[0].thoughtSignature, "sig-1");
  assert.deepEqual(response.parts.map((part) => part.functionResponse.name), ["search_locations", "search_locations"]);
  assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: "AUTO" } });
});

test("Gemini malformed function response mapping fails closed", () => {
  assert.throws(() => requestBody({ gemini: true, model: "gemini-3.6-flash" }, {
    systemInstructions: "system", message: "route", context: {}, history: [], toolDefinitions: [],
    toolMessages: [{ role: "tool", tool_call_id: "gemini-1", content: "{}" }],
  }), /requires the declared function name/);
});

test("Gemini provider timeout exposes sanitized timeout ownership diagnostics", async () => {
  llm.setPostJsonForTests(async () => {
    const error = new Error("LLM request timed out");
    error.code = "LLM_TIMEOUT";
    error.timeoutOwner = "provider_request_timeout";
    error.providerTimeoutConfiguredMs = 1234;
    throw error;
  });
  await assert.rejects(
    () => llm.completeDetailed({ message: "hi", context: {}, toolDefinitions: [] }),
    (error) => {
      assert.equal(error.code, "LLM_TIMEOUT");
      assert.equal(error.aiTimingDiagnostics.timeoutOwner, "provider_request_timeout");
      assert.equal(error.aiTimingDiagnostics.providerTimeoutConfiguredMs, 1234);
      assert.equal(error.aiTimingDiagnostics.providerHttpStatus, null);
      return true;
    },
  );
});

test("Gemini sequential route round preserves function responses and fails closed", async () => {
  const calls = [];
  llm.setPostJsonForTests(async (_url, _headers, raw) => {
    const body = JSON.parse(raw); calls.push(body);
    if (calls.length === 1) return { candidates: [{ content: { parts: [{ functionCall: { name: "calculate_route", args: { pickup: { lat: 31.5, lng: 74.3 }, destination: { lat: 31.51, lng: 74.31 } } } }] } }] };
    return { candidates: [{ content: { parts: [{ text: "Verified route complete." }] } }] };
  });
  const first = await llm.completeDetailed({ message: "Route Alpha to Beta", context: { nativeToolAgent: true }, toolDefinitions: [{ name: "calculate_route", schema: { type: "object", properties: {}, additionalProperties: false } }] });
  assert.equal(first.toolCalls[0].name, "calculate_route");
  const second = await llm.completeDetailed({ message: "Route Alpha to Beta", context: { nativeToolAgent: true }, toolMessages: [{ role: "assistant", tool_calls: [{ id: first.toolCalls[0].id, type: "function", function: { name: "calculate_route", arguments: JSON.stringify(first.toolCalls[0].arguments) } }] }, { role: "tool", tool_call_id: first.toolCalls[0].id, name: "calculate_route", content: JSON.stringify({ verified: true, distanceMeters: 1000, durationSeconds: 300 }) }], toolDefinitions: [{ name: "calculate_route", schema: { type: "object", properties: {}, additionalProperties: false } }] });
  assert.equal(second.provider, "gemini");
  assert.equal(second.text, "Verified route complete.");
  assert.equal(calls[1].contents.some((item) => item.parts?.some((part) => part.functionResponse)), true);
});

test("Gemini converts every registered schema to native Schema without OpenAI wrappers", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    const converted = toGeminiSchema(schema, `tool ${name}.parameters`);
    assert.equal(converted.type, "OBJECT", name);
    assert.equal(converted.additionalProperties, undefined, name);
    assert.doesNotMatch(JSON.stringify(converted), /minLength|maxLength|minimum|maximum/);
  }
  const body = requestBody({ gemini: true, model: "gemini-test" }, {
    systemInstructions: "system", message: "hello", context: {}, history: [],
    toolDefinitions: Object.entries(schemas).map(([name, schema]) => ({ name, schema })),
  });
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].functionDeclarations.length, Object.keys(schemas).length);
  assert.equal(body.tools[0].functionDeclarations[0].type, undefined);
  assert.equal(body.tools[0].functionDeclarations[0].function, undefined);
  const search = body.tools[0].functionDeclarations.find((tool) => tool.name === "search_locations");
  assert.equal(search.parameters.properties.cityHint.type, "STRING");
  assert.equal(search.parameters.properties.cityHint.nullable, true);
  assert.deepEqual(search.parameters.required, ["query"]);
});

test("Gemini conversion fails closed for an unrepresentable schema", () => {
  assert.throws(() => toGeminiSchema({ type: ["string", "number"] }, "tool bad.parameters"), /must contain one non-null type/);
});
