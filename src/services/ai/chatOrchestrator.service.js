const llmClient = require("./llmClient");
const conversations = require("./conversation.service");
const comparisons = require("../currentComparison.service");
const memory = require("./conversationMemory.service");
const { listTools, publicComparison } = require("./toolRegistry");
const { runBoundedToolAgent } = require("./toolExecutor.service");
const { routeEvidenceFromRun, matchRouteEvidence } = require("./routeEvidence.service");
const { classifyDomain, outOfScopeReply, FARE_RIDE_WORDS } = require("./domainPolicy.service");

const enabled = (name) => String(process.env[name] || "false").toLowerCase() === "true";
const TOOL_DESCRIPTIONS = {
  search_locations: "For every named stop in a route request, call this before routing (pickup, destination, and each intermediate stop). Search the user's exact place wording, including Roman Urdu spellings. If a stop has multiple plausible candidates, do not choose coordinates: ask the user to clarify.",
  calculate_route: "Calculate one verified road leg between two coordinates returned by search_locations in this request. Representative points returned by search_locations may be used for broad areas only when the result is relevant and credible; the response must be labeled approximate, never exact pickup. For a multi-stop request, calculate each consecutive leg in order (A→B, then B→C). Never invent coordinates, distance, duration, fare, or live driver availability; these are road estimates, not driver pickup times.",
  compare_live_fares: "Request current provider quotes only when the user asks for a fare comparison and both pickup and destination have been verified by search_locations. Set explicitComparisonIntent only for such a request. A client message id is required for idempotent comparison; if the backend rejects this call, explain that the user should retry with a client message id.",
  get_latest_comparison: "Read an authorized stored comparison. Stored quotes are observations, not newly fetched live prices.",
  get_provider_status: "Read integration configuration and operational status. This does not verify drivers or ride availability.",
  get_nearby_observation_context: "Read aggregate historical nearby observations for a searched location. Never interpret this as live driver availability or pickup ETA.",
  forecast_fare: "Read a historical estimate for the verified route; never a live quote or guaranteed future fare.",
};

function responseLanguage(message) {
  return /\b(mujhe|mein|barish|sasti|sasta|jana|jaana|konsa|kaunsi|agar|hai|ho|luggage zyada|se|karun)\b/i.test(message) ? "roman_urdu" : "english";
}

function hasUngroundedNumericRouteClaim(text) {
  const value = String(text || "");
  return /\b(?:distance|route|travel|drive|duration|time|km|kilometers?|meters?|minutes?)\b/i.test(value)
    && /\b\d+(?:\.\d+)?\s*(?:km|kilometers?|meters?|minutes?|mins?|hours?)\b/i.test(value);
}

function unavailableFareReply(message, agent = {}) {
  const romanUrdu = responseLanguage(message) === "roman_urdu";
  const results = Array.isArray(agent.toolResults) ? agent.toolResults : [];
  const comparison = results.find((item) => item?.name === "compare_live_fares");
  const code = comparison?.result?.status === "LIVE_COMPARISON_DISABLED"
    ? "LIVE_COMPARISON_DISABLED"
    : comparison?.error?.code || agent.errorCode || results.find((item) => item?.error?.code)?.error?.code || "UNAVAILABLE";
  if (code === "LIVE_COMPARISON_DISABLED") return romanUrdu
    ? "Live fare comparison abhi disabled hai. FAIRFARE_AI_LIVE_COMPARISON_ENABLED=true karne ke liye approval aur provider configuration darkar hai."
    : "Live fare comparison is currently disabled. Approval and provider configuration are required to enable FAIRFARE_AI_LIVE_COMPARISON_ENABLED=true.";
  if (!comparison && ["LLM_TIMEOUT", "LLM_TOTAL_TIMEOUT", "LLM_PROVIDER_ERROR", "LLM_MODEL_ERROR"].includes(code)) return romanUrdu
    ? "AI abhi response generate nahi kar saka. Thori dair baad dobara try karein."
    : "The AI service could not generate a response right now. Please try again shortly.";
  if (["TOOL_TIMEOUT", "LLM_TIMEOUT", "REQUEST_DEADLINE_EXCEEDED", "PROVIDER_TIMEOUT"].includes(code)) return romanUrdu
    ? "Abhi updated live fares retrieve nahi ho rahe. Thori dair baad dobara try karein."
    : "Updated live fares could not be retrieved right now. Please try again shortly.";
  if (["LOCATION_LOOKUP_FAILED", "LOCATION_NOT_VERIFIED", "LOCATION_AMBIGUOUS", "INVALID_LOCATION_ARGUMENTS"].includes(code)) return romanUrdu
    ? "Pickup ya destination ko reliably verify nahi kar saka. Dono locations dobara bhej dein."
    : "I could not reliably verify the pickup or destination. Please send both locations again.";
  return romanUrdu
    ? "Abhi is route ke updated live fares available nahi hain. Main koi fare invent nahi karunga; thori dair baad dobara try karein."
    : "Updated live fares are not available for this route right now. I will not invent a fare; please try again shortly.";
}

async function answer(args, dependencies = {}) {
  const client = dependencies.llmClient || llmClient;
  const recentMessages = dependencies.recentMessages || conversations.recentMessages;
  const recentCompletedRequestRuns = dependencies.recentCompletedRequestRuns || conversations.recentCompletedRequestRuns;
  const getComparison = dependencies.getComparison || comparisons.getPersistedComparisonForUser;
  const language = responseLanguage(args.message);
  const context = {
    nativeToolAgent: true,
    responseLanguage: language,
    semanticUnderstandingDiagnostics: { attempted: false, succeeded: false },
    toolCallingMode: "model_selected",
    comparisonUsed: false, comparisonFreshness: null, predictionAvailable: false,
    preferencesUsed: false, historyUsed: false, historyAvailable: false,
    routeRequest: null,
  };
  const unavailable = (errorCode, agent = {}) => ({
    reply: language === "roman_urdu" ? "AI assistant abhi available nahi hai. Thori dair baad dobara koshish karein." : "The AI assistant is unavailable right now. Please try again shortly.",
    modelId: null, provider: null, fallbackUsed: false, available: false,
    status: "UNAVAILABLE", errorCode, comparisonId: null,
    toolExecution: { results: agent.toolResults || [] },
    context: { ...context, responseSource: "safe_fallback", modelSelectedTools: agent.modelSelectedTools || [], modelRequests: agent.modelRequests || 0 },
  });
  if (!args.userId) return unavailable("AUTHENTICATION_REQUIRED");
  if (!enabled("AI_ASSISTANT_ENABLED")) return unavailable("AI_DISABLED");
  // AI requests have their own bounded budget; this does not alter other API
  // endpoint timeouts. Keep the hard cap aligned with the deployed AI budget.
  const deadlineAt = Date.now() + Math.min(135000, Math.max(1000, Number(process.env.AI_TOTAL_REQUEST_TIMEOUT_MS) || 135000));
  // Ownership checks remain in the repositories. Do not swallow authorization or
  // persistence errors and proceed with a different user's/missing context.
  const recent = args.conversationId ? await recentMessages(args.userId, args.conversationId) : [];
  const history = recent.slice(-12).map((item) => ({ role: item.role === "ASSISTANT" ? "ASSISTANT" : "USER", content: String(item.content || "").slice(0, 2000) }));
  if (history.at(-1)?.role === "USER" && history.at(-1).content === args.message) history.pop();
  context.historyUsed = context.historyAvailable = history.length > 0;
  const hasFareRideContext = history.some((item) => FARE_RIDE_WORDS.test(item.content));
  const domainDecision = classifyDomain(args.message, { hasFareRideContext });
  context.domainDecision = domainDecision.reason;
  if (!domainDecision.allowed) {
    return { reply: outOfScopeReply(args.message), modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", comparisonId: null, toolExecution: { results: [] }, context: { ...context, responseSource: "domain_policy", modelSelectedTools: [], modelRequests: 0, numericRouteClaimsGrounded: false } };
  }
  let reusableRoute = null;
  if (args.conversationId && typeof recentCompletedRequestRuns === "function") {
    const runs = await recentCompletedRequestRuns(args.userId, args.conversationId);
    for (const run of runs) {
      const evidence = routeEvidenceFromRun(run);
      if (evidence && matchRouteEvidence(args.message, evidence)) { reusableRoute = evidence; break; }
    }
  }
  context.routeEvidenceSource = reusableRoute ? "reused_verified_route" : "no_verified_route";
  context.routeEvidenceFreshness = reusableRoute?.freshness || null;
  context.routeEvidenceMatched = Boolean(reusableRoute);
  context.routeToolExecuted = false;
  context.numericRouteClaimsGrounded = Boolean(reusableRoute);
  if (reusableRoute) {
    const km = (reusableRoute.route.distanceMeters / 1000).toFixed(1);
    const minutes = Math.round(reusableRoute.route.durationSeconds / 60);
    const reply = language === "roman_urdu"
      ? `Pehle verify kiye gaye route ke mutabiq distance taqreeban ${km} km hai aur driving-route duration taqreeban ${minutes} minutes hai. Is request ke liye reliable historical fare evidence available nahi hai, isliye main fare invent nahi karunga.`
      : `Using the previously verified route, the distance is approximately ${km} km and the driving-route duration is approximately ${minutes} minutes. Reliable historical fare evidence is not available for this request, so I will not invent a fare.`;
    return { reply, modelId: null, provider: null, fallbackUsed: false, available: true, status: "AVAILABLE", comparisonId: null, toolExecution: { results: [] }, context: { ...context, responseSource: "reused_verified_route", trip: { status: "RESOLVED", pickup: reusableRoute.pickup, destination: reusableRoute.destination, route: reusableRoute.route }, modelSelectedTools: [], modelRequests: 0 } };
  }
  let comparisonId = args.comparisonId || null;
  if (!comparisonId && args.conversationId && enabled("FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED") && enabled("FAIRFARE_AI_MEMORY_ENABLED")) {
    const stored = await memory.getMemory({ userId: args.userId, conversationId: args.conversationId });
    comparisonId = await memory.resolveComparisonReference({ userId: args.userId, explicitComparisonId: null, memory: stored });
  }
  const comparison = comparisonId ? publicComparison(await getComparison(comparisonId, args.userId)) : null;
  context.comparisonUsed = Boolean(comparison);
  context.comparisonFreshness = comparison ? "stored_observation" : null;
  const toolsEnabled = enabled("FAIRFARE_AI_TOOL_AGENT_ENABLED") && enabled("FAIRFARE_AI_MODEL_TOOLS_ENABLED");
  const liveEnabled = enabled("FAIRFARE_AI_LIVE_COMPARISON_ENABLED");
  // Native Gemini function calling intentionally has a two-tool surface. Keep
  // the complete registry available to the other AI flows and services.
  const nativeToolNames = new Set(["search_locations", "compare_live_fares"]);
  const tools = toolsEnabled ? listTools().filter((tool) => nativeToolNames.has(tool.name)).map((tool) => ({
    name: tool.name,
    schema: tool.schema,
    description: TOOL_DESCRIPTIONS[tool.name] || tool.name.replaceAll("_", " "),
  })) : [];
  const routeToolAuthorized = tools.some((tool) => tool.name === "search_locations");
  // The model selects tools; flags and authorization only constrain exposure.
  const toolChoice = "auto";
  context.toolChoiceMode = toolChoice;
  context.toolExposure = { count: tools.length, names: tools.map((tool) => tool.name), routeAuthorized: routeToolAuthorized };
  const agent = await runBoundedToolAgent({
    llmClient: client, message: args.message,
    context: { ...context, recentConversation: history, storedComparison: comparison, liveComparisonEnabled: liveEnabled },
    tools,
    toolChoice,
    serverContext: {
      nativeToolAgent: true, userId: args.userId, conversationId: args.conversationId, requestId: args.requestId || null,
      comparisonId, requestRunId: args.requestRunId, deadlineAt,
      liveComparisonEnabled: liveEnabled,
      // This is permission to request a comparison, not a server-selected tool.
      // The native call must separately express intent and pass all route gates.
      explicitComparisonIntent: liveEnabled && Boolean(args.requestRunId),
    },
  });
  if (!agent.result?.text) {
    const reply = unavailableFareReply(args.message, agent);
    return {
      reply, modelId: agent.result?.modelId || null, provider: agent.result?.provider || null,
      fallbackUsed: true, available: true, status: "AVAILABLE", comparisonId: null,
      toolExecution: { results: agent.toolResults || [] },
      context: { ...context, responseSource: "safe_fallback", modelSelectedTools: agent.modelSelectedTools || [], modelRequests: agent.modelRequests || 0, fallbackReason: agent.errorCode || "LLM_PROVIDER_ERROR" },
    };
  }
  const routeToolSucceeded = agent.toolResults.some((item) => item.name === "calculate_route" && item.ok === true && item.result?.status === "OK" && item.result?.sourceType === "verified_road_route");
  const directNumericClaim = !routeToolSucceeded && hasUngroundedNumericRouteClaim(agent.result.text);
  let reply = directNumericClaim
    ? (language === "roman_urdu" ? "Main is waqt route ko verify nahi kar saka, isliye distance ya travel time ko confirmed nahi bata sakta. Thori dair baad dobara try karein." : "I could not verify this route in the current request, so I cannot present a distance or travel time as confirmed. Please try again shortly.")
    : agent.result.text;
  const currentQuotes = agent.toolResults.some((item) => item.ok && item.name === "compare_live_fares" && item.result?.status === "OK");
  if (!comparison && !currentQuotes && /\b(?:book now|book it|go ahead and book|abhi book kar)\b/i.test(reply)) {
    reply = language === "roman_urdu"
      ? "Booking ka mashwara dene ke liye pickup, destination aur current ride options chahiye. Aapka route kya hai?"
      : "I need your pickup, destination, and current ride options before advising whether to book. What is your route?";
  }
  return {
    reply, modelId: agent.result.modelId, provider: agent.result.provider,
    fallbackUsed: Boolean(agent.result.fallbackUsed), available: true, status: "AVAILABLE",
    comparisonId: agent.toolResults.find((item) => item.ok && item.result?.comparisonId)?.result.comparisonId || comparison?.comparisonId || null,
    toolExecution: { results: agent.toolResults },
    context: { ...context, trip: agent.resolvedTrip, responseSource: directNumericClaim ? "safe_fallback" : routeToolSucceeded || comparison ? "llm_grounded" : agent.toolResults.length ? "llm_grounded" : "direct_model_text", modelSelectedTools: agent.modelSelectedTools, modelRequests: agent.modelRequests, toolRequestDiagnostics: agent.toolRequestDiagnostics || null, routeToolExecuted: routeToolSucceeded, numericRouteClaimsGrounded: routeToolSucceeded || Boolean(reusableRoute) },
  };
}

module.exports = { answer, responseLanguage };
