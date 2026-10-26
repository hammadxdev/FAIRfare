const test = require("node:test");
const assert = require("node:assert/strict");
const { runBoundedToolAgent } = require("../services/ai/toolExecutor.service");

const tools = [
  { name: "search_locations", schema: { type: "object" } },
  { name: "calculate_route", schema: { type: "object" } },
  { name: "forecast_fare", schema: { type: "object" } },
];

const scenarios = [
  ["english advice", "Is a bike practical in heavy rain?", "text"],
  ["roman urdu advice", "barish mein bike theek rahegi?", "text"],
  ["mixed language", "Mujhe airport se downtown jana hai, fare ka idea?", "search"],
  ["single destination", "Take me to the central station", "search"],
  ["multi stop", "Office se market phir ghar jana hai", "search"],
  ["ambiguous", "Bahria jana hai", "text"],
  ["missing origin", "How much to the museum?", "text"],
  ["fare comparison", "Compare current fares from the airport to the mall", "search"],
  ["historical estimate", "What was the usual fare last week?", "forecast"],
  ["follow-up", "What about a rickshaw?", "text"],
  ["normal chat", "What does Fair Fare do?", "text"],
  ["clarification follow-up", "The second location, not the first one", "text"],
];

test("native tool agent generalization matrix keeps semantic choice with the model", async () => {
  for (const [label, message, expected] of scenarios) {
    const calls = [];
    const result = await runBoundedToolAgent({
      message,
      tools,
      providerOnly: "groq",
      serverContext: { userId: "evaluation-user", nativeToolAgent: true },
      llmClient: {
        completeDetailed: async (args) => {
          calls.push(args);
          if (expected === "text") return { provider: "groq", text: `Clarify or answer: ${message}` };
          const name = expected === "forecast" ? "forecast_fare" : "search_locations";
          if (calls.length === 1) return { provider: "groq", toolCalls: [{ id: `${label}-1`, name, arguments: "{}" }] };
          return { provider: "groq", text: "Grounded answer after tool result." };
        },
      },
    });
    assert.equal(result.handled, true, label);
    assert.equal(calls[0].toolChoice, "auto", label);
    assert.equal(calls[0].message, message, label);
    if (expected === "text") assert.match(result.result?.text || "", /Clarify or answer/);
    else assert.equal(result.toolResults?.[0]?.name, expected === "forecast" ? "forecast_fare" : "search_locations", label);
  }
});

test("native agent preserves tool results across bounded rounds", async () => {
  const messages = [];
  let round = 0;
  const result = await runBoundedToolAgent({
    message: "find a route and then estimate the fare",
    tools,
    providerOnly: "groq",
    serverContext: { userId: "evaluation-user", nativeToolAgent: true },
    llmClient: { completeDetailed: async (args) => {
      messages.push(args.toolMessages);
      round += 1;
      if (round === 1) return { provider: "groq", toolCalls: [{ id: "search-1", name: "search_locations", arguments: JSON.stringify({ query: "central station" }) }] };
      return { provider: "groq", text: "I need the exact pickup before calculating a verified fare." };
    } },
  });
  assert.equal(result.result.text.includes("exact pickup"), true);
  assert.equal(messages[1].some((item) => item.role === "tool" && item.tool_call_id === "search-1"), true);
});

