const { validateToolArguments } = require("./toolSchemas");
const { getTool } = require("./toolRegistry");

const MAX_TOOL_CALLS = 3;
const MAX_LIVE_COMPARISONS = 1;
const DEFAULT_DEADLINE_MS = 30000;
const MAX_AGENT_ROUNDS = MAX_TOOL_CALLS + 1;

function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).sort().join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sanitize(value, depth = 0) { if (depth > 5) return null; if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1)); if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 2000) : value; return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, child]) => [key.slice(0, 100), sanitize(child, depth + 1)])); }
function remainingMs(ctx) { return Math.max(0, Number(ctx.deadlineAt || (Date.now() + DEFAULT_DEADLINE_MS)) - Date.now()); }
function timeoutError(code, message) { const error = new Error(message); error.code = code; return error; }
async function withTimeout(work, timeoutMs) { let timer; return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError("TOOL_TIMEOUT", "Tool execution timed out")), timeoutMs); })]).finally(() => clearTimeout(timer)); }
function expandLocationAlias(args) {
  if (!args || typeof args.query !== "string") return args;
  const normalized = args.query.trim().toLowerCase().replace(/[.\s]+/g, "");
  const city = String(args.cityHint || "").toLowerCase();
  if (normalized === "lgu" || normalized.startsWith("lgu")) {
    const suffix = args.query.trim().slice(3).trim();
    if (!city || city.includes("lahore") || /dha|phase/.test(suffix.toLowerCase())) return { ...args, query: `Lahore Garrison University${suffix ? ` ${suffix}` : ""}`, aliasExpandedFrom: "LGU" };
  }
  return args;
}
function dedupeCandidates(candidates) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : []).filter((item) => {
    const key = item?.placeId || `${item?.lat},${item?.lng},${item?.name}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function locationMatchesQuery(query, point) {
  const text = String(query || "").toLowerCase().replace(/\blgu\b/g, "lahore garrison university");
  const haystack = `${point?.name || ""} ${point?.address || ""} ${point?.city || ""}`.toLowerCase();
  if (/(lahore garrison university|\blgu\b)/.test(text)) return /lahore garrison university|garrison university/.test(haystack) && !/grammar school|lgs/.test(haystack);
  if (/punjab university|university of the punjab/.test(text)) {
    if (/engineering and technology|uet|kala shah kaku/.test(haystack)) return false;
    if (/new campus|quaid.?e.?azam campus/.test(text)) return /punjab university|university of the punjab|quaid.?e.?azam campus/.test(haystack);
    return /punjab university|university of the punjab/.test(haystack);
  }
  const tokens = text.split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !["university", "campus", "new", "the"].includes(token));
  return tokens.length === 0 || tokens.filter((token) => haystack.includes(token)).length >= Math.max(1, Math.ceil(tokens.length * 0.5));
}
function normalizeAgentToolCall(call, roundNumber, index) {
  const name = typeof call?.name === "string" ? call.name : typeof call?.function?.name === "string" ? call.function.name : typeof call?.functionCall?.name === "string" ? call.functionCall.name : "";
  const rawArguments = call?.arguments !== undefined ? call.arguments : call?.function?.arguments !== undefined ? call.function.arguments : call?.functionCall?.args;
  const id = call?.id === undefined || call?.id === null ? `gemini-r${roundNumber}-c${index + 1}` : call.id;
  let argumentsValue = rawArguments;
  let argumentError = null;
  if (typeof rawArguments === "string") { try { argumentsValue = JSON.parse(rawArguments); } catch { argumentError = "invalid_argument_json"; } }
  const normalized = { id, name, arguments: argumentsValue, thoughtSignature: call?.thoughtSignature || null };
  const missing = [];
  if (typeof normalized.id !== "string" || !normalized.id.trim()) missing.push("id");
  if (!normalized.name.trim()) missing.push("name");
  if (normalized.arguments === undefined || normalized.arguments === null) missing.push("arguments");
  if (argumentError) missing.push("argument_json");
  if (normalized.arguments !== null && (typeof normalized.arguments !== "object" || Array.isArray(normalized.arguments))) missing.push("argument_type");
  return { normalized, missing, argumentError, generatedId: call?.id === undefined || call?.id === null, rawShape: { keys: Object.keys(call || {}), idPresent: call?.id !== undefined && call?.id !== null, idType: typeof call?.id, argumentType: typeof rawArguments, argumentKeys: argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue) ? Object.keys(argumentsValue).slice(0, 20) : [] } };
}

function recordVerifiedLeg(state, { pickup, destination, route, city }) {
  const leg = { pickup, destination, route: { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, distanceKm: route.distanceMeters / 1000, durationMin: route.durationSeconds / 60, compareFaresEligible: route.compareFaresEligible !== false } };
  const legs = [...(state.resolvedTrip?.legs || []), leg];
  const totals = legs.reduce((sum, item) => ({ distanceMeters: sum.distanceMeters + item.route.distanceMeters, durationSeconds: sum.durationSeconds + item.route.durationSeconds }), { distanceMeters: 0, durationSeconds: 0 });
  state.resolvedTrip = { status: "RESOLVED", pickup: legs[0].pickup, destination: legs.at(-1).destination, stops: legs.flatMap((item, index) => index === 0 ? [item.pickup, item.destination] : [item.destination]), legs, city, route: { ...totals, distanceKm: totals.distanceMeters / 1000, durationMin: totals.durationSeconds / 60, compareFaresEligible: legs.every((item) => item.route.compareFaresEligible !== false) } };
}

async function executeToolCall(call, context = {}, state = {}) {
  const name = String(call?.name || "");
  const denied = (code) => ({ ok: false, name, executed: false, error: { code } });
  if (!context.userId) return denied("AUTHENTICATION_REQUIRED");
  if (context.allowedTools && !context.allowedTools.has(name)) return denied("TOOL_NOT_ALLOWED");
  state.calls = (state.calls || 0) + 1;
  if (state.calls > (context.nativeToolAgent ? 6 : MAX_TOOL_CALLS)) return denied("TOOL_CALL_LIMIT");
  if (name === "compare_live_fares") { state.liveComparisons = (state.liveComparisons || 0) + 1; if (state.liveComparisons > MAX_LIVE_COMPARISONS) return { ok: false, name, error: { code: "LIVE_COMPARISON_LIMIT" } }; }
  const tool = getTool(name);
  if (!tool || tool.disabled) return { ok: false, name, error: { code: tool?.disabled ? "TOOL_DISABLED" : "UNKNOWN_TOOL" } };
  let args;
  try { args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments; } catch { return { ok: false, name, error: { code: "INVALID_TOOL_ARGUMENTS" } }; }
  const validation = validateToolArguments(name, args);
  if (!validation.ok) return { ok: false, name, error: validation };
  if (context.nativeToolAgent) {
    const pointKey = (point) => `${point.lat},${point.lng}`;
    const trustedPoint = (point) => state.locations?.get(pointKey(point));
    if (["calculate_route", "compare_live_fares", "get_nearby_observation_context", "plan_lahore_transit"].includes(name)) {
      const pickup = trustedPoint(args.pickup || args.origin);
      const dropoff = (args.dropoff || args.destination) && trustedPoint(args.dropoff || args.destination);
      const originArg = args.pickup || args.origin;
      const destinationArg = args.dropoff || args.destination;
      if (!pickup || destinationArg && !dropoff) return { ...denied("LOCATION_NOT_VERIFIED"), routeDiagnostics: { originResolved: Boolean(pickup), destinationResolved: Boolean(dropoff), originHasCoordinates: Boolean(originArg?.lat != null && originArg?.lng != null), destinationHasCoordinates: Boolean(destinationArg?.lat != null && destinationArg?.lng != null), originHasPlaceId: Boolean(pickup?.placeId), destinationHasPlaceId: Boolean(dropoff?.placeId), originVerified: Boolean(pickup), destinationVerified: Boolean(dropoff), routeValidationFailureCategory: "location_not_verified" } };
      if (state.ambiguousLocations?.has(pointKey(originArg)) || destinationArg && state.ambiguousLocations?.has(pointKey(destinationArg))) return { ...denied("LOCATION_AMBIGUOUS"), routeDiagnostics: { originResolved: Boolean(pickup), destinationResolved: Boolean(dropoff), originHasCoordinates: Boolean(originArg), destinationHasCoordinates: Boolean(destinationArg), originHasPlaceId: Boolean(pickup?.placeId), destinationHasPlaceId: Boolean(dropoff?.placeId), originVerified: true, destinationVerified: Boolean(dropoff), routeValidationFailureCategory: "location_ambiguous" } };
      args = { ...args, ...(name === "plan_lahore_transit" ? { origin: { lat: pickup.lat, lng: pickup.lng, name: pickup.name, placeId: pickup.placeId } } : { pickup: { lat: pickup.lat, lng: pickup.lng, name: pickup.name, placeId: pickup.placeId } }) };
      if (dropoff) args[name === "plan_lahore_transit" ? "destination" : "dropoff"] = { lat: dropoff.lat, lng: dropoff.lng, name: dropoff.name, placeId: dropoff.placeId };
      if (name === "compare_live_fares") {
        if (context.liveComparisonEnabled !== true || String(process.env.FAIRFARE_AI_LIVE_COMPARISON_ENABLED).toLowerCase() !== "true") return denied("LIVE_COMPARISON_DISABLED");
        if (!context.requestRunId) return denied("IDEMPOTENCY_REQUIRED");
        // Model-supplied distances and durations are never trusted. The
        // existing fare service computes its bounded fallback route when no
        // verified road-route result is available.
        if (state.resolvedTrip && (pointKey(state.resolvedTrip.pickup) !== pointKey(pickup) || pointKey(state.resolvedTrip.destination) !== pointKey(dropoff))) return denied("VERIFIED_ROUTE_REQUIRED");
        if (state.resolvedTrip?.route?.compareFaresEligible === false) return denied("ROUTE_NOT_ELIGIBLE");
        if (!state.resolvedTrip) {
          // The model may go straight to the fare tool; verify the road route here so
          // fares and the reported distance/duration never rest on a straight-line guess.
          try {
            const routeTool = getTool("calculate_route");
            const routed = sanitize(await withTimeout(Promise.resolve().then(() => routeTool.execute({ pickup: args.pickup, dropoff: args.dropoff }, context)), Math.min(routeTool.timeoutMs, remainingMs(context))));
            if (routed?.status === "OK" && routed.route?.distanceMeters > 0 && routed.route?.durationSeconds > 0) recordVerifiedLeg(state, { pickup: args.pickup, destination: args.dropoff, route: routed.route, city: pickup.city });
          } catch { /* fall through: fare service uses its bounded fallback route */ }
        }
        args.route = state.resolvedTrip?.route || null;
      }
    }
  }
  if (["calculate_route", "compare_live_fares", "get_nearby_observation_context"].includes(name)) {
    if (context.requiresResolvedTrip === true && !context.resolvedTrip) return { ok: false, name, error: { code: "VERIFIED_TRIP_REQUIRED" } };
    if (context.resolvedTrip) {
      const pickup = context.resolvedTrip.pickup;
      const dropoff = context.resolvedTrip.destination;
      const samePoint = (provided, trusted) => Boolean(provided && trusted) && Math.abs(Number(provided.lat) - Number(trusted.lat)) <= 0.000001 && Math.abs(Number(provided.lng) - Number(trusted.lng)) <= 0.000001;
      if (!samePoint(args.pickup, pickup) || name !== "get_nearby_observation_context" && !samePoint(args.dropoff, dropoff)) return { ok: false, name, error: { code: "LOCATION_NOT_VERIFIED" } };
    }
  }
  args = name === "search_locations" ? expandLocationAlias(args) : args;
  const key = `${name}:${stable(args)}`;
  if (state.seen?.has(key)) return { ok: false, name, error: { code: "DUPLICATE_TOOL_CALL" } };
  state.seen ||= new Set(); state.seen.add(key);
  const configuredTimeout = name === "search_locations"
    ? Number(process.env.FAIRFARE_AI_SEARCH_LOCATIONS_TIMEOUT_MS || 30000)
    : Number(tool.timeoutMs);
  const deadline = Math.min(configuredTimeout, remainingMs(context));
  if (deadline <= 0) return { ok: false, name, error: { code: "REQUEST_DEADLINE_EXCEEDED" } };
  const serverContext = { ...context, resolvedTrip: state.resolvedTrip || context.resolvedTrip, explicitComparisonIntent: context.explicitComparisonIntent === true };
  if (name === "search_locations") {
    state.locationSearchCache ||= new Map();
    const cacheKey = stable({ query: args.query, cityHint: args.cityHint || null });
    if (state.locationSearchCache.has(cacheKey)) return { ...state.locationSearchCache.get(cacheKey), executionDiagnostics: { ...(state.locationSearchCache.get(cacheKey).executionDiagnostics || {}), cache: "hit" } };
  }
  const toolStartedAt = Date.now();
  try {
    const result = sanitize(await withTimeout(Promise.resolve().then(() => tool.execute(args, serverContext)), deadline));
    if (context.nativeToolAgent && name === "search_locations" && result?.status === "OK") {
      result.candidates = dedupeCandidates(result.candidates);
      state.locations ||= new Map();
      state.ambiguousLocations ||= new Set();
      const queryTokens = String(args.query || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
      const relevant = (result.candidates || []).filter((point) => locationMatchesQuery(args.query, point));
      const first = result.candidates?.[0];
      const firstIsVerifiedRelevant = Boolean(first?.resolutionType === "verified_named_landmark" && first.approximate === false && first.placeId && locationMatchesQuery(args.query, first));
      const verified = relevant.filter((point) => point.resolutionType === "verified_named_landmark" && point.approximate === false && point.placeId && Number.isFinite(point.lat) && Number.isFinite(point.lng));
      const selectedIndex = firstIsVerifiedRelevant ? 0 : (result.candidates || []).findIndex((point) => verified.includes(point));
      result.diagnostics = { ...(result.diagnostics || {}), selectedCandidateIndex: selectedIndex >= 0 ? selectedIndex : null, selectedCandidate: selectedIndex >= 0 ? { name: result.candidates[selectedIndex].name, placeId: result.candidates[selectedIndex].placeId, lat: result.candidates[selectedIndex].lat, lng: result.candidates[selectedIndex].lng, resolutionType: result.candidates[selectedIndex].resolutionType, approximate: result.candidates[selectedIndex].approximate } : null, candidateCount: (result.candidates || []).length, relevantCandidateCount: relevant.length, validCandidateCount: relevant.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)).length, ambiguous: verified.length > 1, hasVerifiedCandidate: verified.length > 0 };
      for (const point of relevant) {
        if (typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && typeof point.lng === "number" && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180)
          state.locations.set(`${point.lat},${point.lng}`, point);
      }
      if (result.diagnostics.ambiguous) for (const point of verified) state.ambiguousLocations.add(`${point.lat},${point.lng}`);
    }
    if (context.nativeToolAgent && name === "calculate_route" && result?.status === "OK") {
      const route = result.route;
      if (!(route?.distanceMeters > 0 && route?.durationSeconds > 0)) return { ...denied("INVALID_ROUTE_RESULT"), executed: true };
      recordVerifiedLeg(state, { pickup: args.pickup, destination: args.dropoff, route, city: state.locations.get(`${args.pickup.lat},${args.pickup.lng}`).city });
      result.sourceType = "verified_road_route";
      result.pickupEtaAvailable = false;
    }
    if (context.nativeToolAgent && name === "compare_live_fares" && result?.status === "OK" && state.resolvedTrip?.route) {
      const { distanceMeters, durationSeconds, distanceKm, durationMin } = state.resolvedTrip.route;
      result.route = { distanceMeters, durationSeconds, distanceKm, durationMin, sourceType: "verified_road_route" };
    }
    const completed = { ok: true, name, executed: true, result, executionDiagnostics: { queueWaitMs: 0, executionMs: Date.now() - toolStartedAt, elapsedMs: Date.now() - toolStartedAt, upstreamHttpDurationMs: result?.diagnostics?.upstreamHttpDurationMs ?? null, upstreamHttpStatus: result?.diagnostics?.upstreamHttpStatus ?? null, timeoutOwner: null, abortCategory: null, cache: result?.diagnostics?.cache || "miss", retryCount: result?.diagnostics?.retryCount ?? 0, timeoutCategory: null, resultBytes: Buffer.byteLength(JSON.stringify(result || {}), "utf8") } };
    if (name === "search_locations") state.locationSearchCache.set(stable({ query: args.query, cityHint: args.cityHint || null }), completed);
    return completed;
  }
  catch (error) { return { ok: false, name, executed: true, uncertain: name === "compare_live_fares" && error.code === "TOOL_TIMEOUT", error: { code: error.code || "TOOL_EXECUTION_FAILED", message: error.code === "TOOL_TIMEOUT" ? "Tool execution timed out; provider operation status may be uncertain." : "Tool execution failed" }, executionDiagnostics: { queueWaitMs: 0, executionMs: Date.now() - toolStartedAt, elapsedMs: Date.now() - toolStartedAt, upstreamHttpDurationMs: error.upstreamHttpDurationMs ?? null, upstreamHttpStatus: error.statusCode ?? null, timeoutOwner: error.code === "TOOL_TIMEOUT" ? "tool_executor" : null, abortCategory: error.code === "TOOL_TIMEOUT" ? "tool_deadline" : null, cache: null, retryCount: error.retryCount ?? 0, timeoutCategory: error.code === "TOOL_TIMEOUT" ? "tool_timeout" : "tool_error", resultBytes: 0 } }; }
}

async function executeToolCalls(calls, context = {}, state = null) { const executionState = state || { seen: new Set(), calls: 0, liveComparisons: 0 }; const batch = Array.isArray(calls) ? calls : []; const results = await Promise.all(batch.map((call) => executeToolCall(call, context, executionState))); return { results, state: executionState }; }

async function runBoundedToolAgent({ llmClient, message, context = {}, serverContext = {}, tools = [], maxRounds = MAX_AGENT_ROUNDS, providerOnly, toolChoice = "auto" } = {}) {
  if (!llmClient || typeof llmClient.completeDetailed !== "function") return { handled: false, reason: "TOOL_AGENT_UNAVAILABLE" };
  const startedAt = Date.now();
  const deadlineAt = serverContext.deadlineAt || startedAt + DEFAULT_DEADLINE_MS;
  const toolMessages = [{ role: "user", content: message }];
  const state = { seen: new Set(), calls: 0, liveComparisons: 0 };
  const results = [];
  const selected = [];
  const roundDiagnostics = [];
  const callIds = new Set();
  const executionContext = { ...serverContext, deadlineAt, allowedTools: new Set(tools.map((tool) => tool.name)) };
  const rounds = Math.max(1, Math.min(Number(maxRounds) || MAX_AGENT_ROUNDS, MAX_AGENT_ROUNDS));
  const failed = (errorCode, error = null) => ({ handled: true, status: "UNAVAILABLE", errorCode, toolResults: results, modelSelectedTools: selected, modelRequests: requests, toolRequestDiagnostics: { rounds: roundDiagnostics }, providerDiagnostics: error ? { httpStatus: error.statusCode || null, providerErrorCode: error.providerErrorCode || null, providerFailureCategory: error.providerFailureCategory || null, parserFailureCategory: error.parserFailureCategory || null, responseDiagnostics: error.responseDiagnostics || null, retryAfterMs: error.retryAfterMs ?? null, rateLimitKind: error.rateLimitKind || null, rateLimitMetadata: { resetRequests: error.resetRequests ?? null, resetTokens: error.resetTokens ?? null, remainingRequests: error.remainingRequests ?? null, remainingTokens: error.remainingTokens ?? null } } : null });
  let requests = 0;
  let finalizationPending = false;
  let lastResult = null;
  for (let round = 0; round < rounds + 1; round += 1) {
    if (deadlineAt <= Date.now()) return failed("REQUEST_DEADLINE_EXCEEDED");
    try {
      requests += 1;
      // The model chooses between a tool call, clarification, and a natural
      // answer on every round. Follow-up rounds remain bounded and use auto so
      // tool results can lead to another call or a grounded final response.
      const roundToolChoice = round === 0 ? toolChoice : "auto";
      const finalization = finalizationPending === true;
      lastResult = await withTimeout(llmClient.completeDetailed({ message: finalization ? `${message}\nReturn only the final answer using the verified tool results already provided. Do not call tools. If a tool failed or locations are ambiguous, explain that limitation specifically and do not invent route or fare data.` : message, context: { ...context, ...serverContext, finalization, toolResults: undefined }, toolDefinitions: finalization ? [] : tools, toolMessages: [...toolMessages], deadlineAt, providerOnly, toolChoice: "auto" }), deadlineAt - Date.now());
      if (lastResult?.toolRequestDiagnostics) roundDiagnostics.push({ round: round + 1, ...lastResult.toolRequestDiagnostics });
    } catch (error) { return failed(error.code === "TOOL_TIMEOUT" ? "REQUEST_DEADLINE_EXCEEDED" : error.code || "LLM_PROVIDER_ERROR", error); }
    if (providerOnly && lastResult?.provider !== providerOnly) return failed("LLM_PROVIDER_MISMATCH");
    if (!Array.isArray(lastResult?.toolCalls) || !lastResult.toolCalls.length) {
      if (typeof lastResult?.text !== "string" || !lastResult.text.trim()) return failed("LLM_MALFORMED_RESPONSE");
      const searchDiagnostics = results.filter((item) => item.name === "search_locations").map((item) => ({
        status: item.result?.status || item.error?.code || "UNKNOWN",
        candidateCount: Array.isArray(item.result?.candidates) ? item.result.candidates.length : 0,
        validCandidateCount: Array.isArray(item.result?.candidates) ? item.result.candidates.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)).length : 0,
        ambiguous: Array.isArray(item.result?.candidates) && item.result.candidates.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)).length > 1,
      }));
      return { handled: true, result: lastResult, toolResults: results, modelSelectedTools: selected, modelRequests: requests, toolRequestDiagnostics: { ...(lastResult.toolRequestDiagnostics || {}), rounds: roundDiagnostics, followUpToolChoice: requests > 1 ? "auto" : null, searchDiagnostics }, resolvedTrip: state.resolvedTrip || null };
    }
    const normalizedCalls = lastResult.toolCalls.map((call, index) => normalizeAgentToolCall(call, round + 1, index));
    let invalidCall = null;
    for (const item of normalizedCalls) {
      if (item.missing.length) { invalidCall = item; break; }
      if (callIds.has(item.normalized.id)) {
        if (item.normalized.id.startsWith("gemini-")) item.normalized.id = `gemini-r${round + 1}-c${normalizedCalls.indexOf(item) + 1}`;
        else { item.rejection = "duplicate_id"; invalidCall = item; break; }
      }
      callIds.add(item.normalized.id);
    }
    if (lastResult.toolCalls.length > 6 || invalidCall) {
      const category = invalidCall?.rejection || invalidCall?.argumentError || (invalidCall?.missing?.includes("id") ? "empty_id" : invalidCall?.missing?.includes("name") ? "invalid_name" : invalidCall?.missing?.includes("argument_type") ? "invalid_argument_type" : "unsupported_call_shape");
      console.warn("[AI] gemini_malformed_response", { requestId: serverContext.requestId || null, roundNumber: round + 1, parserFailureCategory: "invalid_agent_tool_call_shape", toolCallCount: lastResult.toolCalls.length, toolName: invalidCall?.normalized.name || null, idPresent: invalidCall?.rawShape.idPresent ?? null, idType: invalidCall?.rawShape.idType || null, argumentType: invalidCall?.rawShape.argumentType || null, argumentKeys: invalidCall?.rawShape.argumentKeys || [], missingRequiredFields: invalidCall?.missing || [], validatorRejectionReason: category || "tool_call_limit", remainingBudgetMs: remainingMs(executionContext) });
      return failed("LLM_MALFORMED_RESPONSE");
    }
    const calls = normalizedCalls.map(({ normalized }) => normalized);
    if (finalizationPending) {
      console.warn("[AI] model_round_limit", { requestId: serverContext.requestId || null, roundNumber: round + 1, lastModelSelectedTool: calls[0]?.name || null, lastToolExecuted: false, skipReason: "finalization_round_returned_tool_call", remainingBudgetMs: remainingMs(executionContext) });
      return failed("MODEL_ROUND_LIMIT");
    }
    selected.push(...calls.map((call) => call.name));
    // The last selection round may execute one authorized tool. It is followed
    // by exactly one bounded finalization request for the natural-language answer.
    const assistantCallMessage = { role: "assistant", tool_calls: calls.map((call) => ({ id: call.id, type: "function", thoughtSignature: call.thoughtSignature || null, function: { name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments || {}) } })) };
    toolMessages.push(assistantCallMessage);
    const batchResults = await Promise.all(calls.map((call) => executeToolCall(call, executionContext, state)));
    calls.forEach((call, index) => {
      const item = batchResults[index];
      results.push({ ...item, toolCallId: call.id });
      toolMessages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: JSON.stringify(item.ok ? item.result : { error: item.error, uncertain: item.uncertain === true }) });
    });
    if (round === rounds - 1) finalizationPending = true;
  }
  return failed(finalizationPending ? "MODEL_ROUND_LIMIT" : "TOOL_CALL_LIMIT");
}

module.exports = { executeToolCall, executeToolCalls, runBoundedToolAgent, sanitize, stable, MAX_TOOL_CALLS, MAX_LIVE_COMPARISONS, DEFAULT_DEADLINE_MS, MAX_AGENT_ROUNDS };
