const { validateToolArguments } = require("./toolSchemas");
const { getTool } = require("./toolRegistry");

const MAX_TOOL_CALLS = 3;
const MAX_LIVE_COMPARISONS = 1;
const DEFAULT_DEADLINE_MS = 12000;

function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).sort().join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sanitize(value, depth = 0) { if (depth > 5) return null; if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1)); if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 2000) : value; return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, child]) => [key.slice(0, 100), sanitize(child, depth + 1)])); }
function remainingMs(ctx) { return Math.max(0, Number(ctx.deadlineAt || (Date.now() + DEFAULT_DEADLINE_MS)) - Date.now()); }
function timeoutError(code, message) { const error = new Error(message); error.code = code; return error; }
async function withTimeout(work, timeoutMs) { let timer; return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError("TOOL_TIMEOUT", "Tool execution timed out")), timeoutMs); })]).finally(() => clearTimeout(timer)); }

async function executeToolCall(call, context = {}, state = {}) {
  const name = String(call?.name || "");
  const tool = getTool(name);
  if (!tool || tool.disabled) return { ok: false, name, error: { code: tool?.disabled ? "TOOL_DISABLED" : "UNKNOWN_TOOL" } };
  let args;
  try { args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments; } catch { return { ok: false, name, error: { code: "INVALID_TOOL_ARGUMENTS" } }; }
  const validation = validateToolArguments(name, args);
  if (!validation.ok) return { ok: false, name, error: validation };
  const key = `${name}:${stable(args)}`;
  if (state.seen?.has(key)) return { ok: false, name, error: { code: "DUPLICATE_TOOL_CALL" } };
  state.seen ||= new Set(); state.seen.add(key);
  state.calls = (state.calls || 0) + 1;
  if (state.calls > MAX_TOOL_CALLS) return { ok: false, name, error: { code: "TOOL_CALL_LIMIT" } };
  if (name === "compare_live_fares") { state.liveComparisons = (state.liveComparisons || 0) + 1; if (state.liveComparisons > MAX_LIVE_COMPARISONS) return { ok: false, name, error: { code: "LIVE_COMPARISON_LIMIT" } }; }
  const deadline = Math.min(tool.timeoutMs, remainingMs(context));
  if (deadline <= 0) return { ok: false, name, error: { code: "REQUEST_DEADLINE_EXCEEDED" } };
  const serverContext = { ...context, explicitComparisonIntent: context.explicitComparisonIntent === true };
  try { return { ok: true, name, result: sanitize(await withTimeout(Promise.resolve(tool.execute(args, serverContext)), deadline)) }; }
  catch (error) { return { ok: false, name, uncertain: name === "compare_live_fares" && error.code === "TOOL_TIMEOUT", error: { code: error.code || "TOOL_EXECUTION_FAILED", message: error.code === "TOOL_TIMEOUT" ? "Tool execution timed out; provider operation status may be uncertain." : "Tool execution failed" } }; }
}

async function executeToolCalls(calls, context = {}) { const state = { seen: new Set(), calls: 0, liveComparisons: 0 }; const results = []; for (const call of Array.isArray(calls) ? calls : []) { results.push(await executeToolCall(call, context, state)); if (remainingMs(context) <= 0) break; } return { results, state }; }

async function runBoundedToolAgent({ llmClient, message, context = {}, serverContext = {}, tools = [], maxRounds = MAX_TOOL_CALLS } = {}) {
  if (!llmClient || typeof llmClient.completeDetailed !== "function" || !tools.length) return { handled: false, reason: "TOOL_AGENT_UNAVAILABLE" };
  const startedAt = Date.now();
  const deadlineAt = serverContext.deadlineAt || startedAt + DEFAULT_DEADLINE_MS;
  const toolMessages = [{ role: "user", content: message }];
  const state = { seen: new Set(), calls: 0, liveComparisons: 0 };
  let lastResult = null;
  for (let round = 0; round < Math.min(maxRounds, MAX_TOOL_CALLS); round += 1) {
    if (deadlineAt <= Date.now()) return { handled: true, status: "UNAVAILABLE", errorCode: "REQUEST_DEADLINE_EXCEEDED" };
    lastResult = await llmClient.completeDetailed({ message, context: { ...context, toolResults: undefined }, toolDefinitions: tools, toolMessages });
    if (!Array.isArray(lastResult.toolCalls) || !lastResult.toolCalls.length) return round === 0 ? { handled: false, result: lastResult } : { handled: true, result: lastResult, toolResults: context.toolResults || [] };
    const assistantCallMessage = { role: "assistant", tool_calls: lastResult.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments || {}) } })) };
    toolMessages.push(assistantCallMessage);
    const execution = await executeToolCalls(lastResult.toolCalls, { ...serverContext, deadlineAt, userId: serverContext.userId });
    execution.results.forEach((item, index) => toolMessages.push({ role: "tool", tool_call_id: lastResult.toolCalls[index]?.id || item.name, content: JSON.stringify(item.ok ? item.result : { error: item.error, uncertain: item.uncertain === true }) }));
    context.toolResults = execution.results;
    state.calls += execution.state.calls;
    state.liveComparisons += execution.state.liveComparisons;
    if (state.calls >= MAX_TOOL_CALLS || state.liveComparisons >= MAX_LIVE_COMPARISONS && round + 1 >= maxRounds) break;
  }
  return { handled: true, status: "UNAVAILABLE", errorCode: "TOOL_CALL_LIMIT", toolResults: context.toolResults || [] };
}

module.exports = { executeToolCall, executeToolCalls, runBoundedToolAgent, sanitize, stable, MAX_TOOL_CALLS, MAX_LIVE_COMPARISONS, DEFAULT_DEADLINE_MS };
