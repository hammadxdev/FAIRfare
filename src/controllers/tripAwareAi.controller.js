const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { answer, validateMessage } = require("../services/tripAwareAiAssistant.service");
const crypto = require("crypto");
const conversations = require("../services/ai/conversation.service");
const conversationMemory = require("../services/ai/conversationMemory.service");
const existing = require("./ai.controller");
const TOOL_AGENT_ENABLED = () => String(process.env.FAIRFARE_AI_TOOL_AGENT_ENABLED || "false").toLowerCase() === "true";
const MEMORY_ENABLED = () => String(process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED || "false").toLowerCase() === "true" && String(process.env.FAIRFARE_AI_MEMORY_ENABLED || "false").toLowerCase() === "true";

function idParam(value) { const id = String(value || ""); if (!id) throw new AppError("Invalid conversation id", 400); return id; }
function buildTraceDiagnostics(result, requestId) {
  const semantic = result.context?.semanticUnderstanding;
  const semanticDiagnostics = result.context?.semanticUnderstandingDiagnostics || { attempted: false, succeeded: false };
  const execution = Array.isArray(result.toolExecution) ? result.toolExecution : result.toolExecution?.results || [];
  const safeToolName = (value) => String(value || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80) || null;
  const toolNames = execution.map((item) => safeToolName(item.name)).filter(Boolean);
  const toolCallingMode = result.context?.toolCallingMode || null;
  let noToolExecutionReason = null;
  if (!toolNames.length) {
    if (!TOOL_AGENT_ENABLED()) noToolExecutionReason = "TOOL_AGENT_DISABLED";
    else if (String(process.env.FAIRFARE_AI_MODEL_TOOLS_ENABLED || "false").toLowerCase() !== "true") noToolExecutionReason = "MODEL_TOOL_CALLING_DISABLED";
    else if (result.context?.toolIntent && ["route_information", "compare_fares", "cheapest_ride", "current_trip"].includes(result.context.toolIntent) && result.context?.trip?.status !== "RESOLVED") noToolExecutionReason = "VERIFIED_ROUTE_REQUIRED";
  }
  return {
    requestId,
    backendVersion: process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null,
    modelFirstEnabled: String(process.env.FAIRFARE_AI_MODEL_FIRST_ENABLED || "false").toLowerCase() === "true",
    semanticUnderstandingAttempted: semanticDiagnostics.attempted === true,
    semanticUnderstandingSucceeded: semanticDiagnostics.succeeded === true,
    semanticErrorCategory: semanticDiagnostics.errorCategory || null,
    semanticParseIssue: semanticDiagnostics.parseIssue || null,
    semanticValidationIssues: semanticDiagnostics.validationIssues || [],
    semanticScope: semantic?.scope || null,
    semanticIntent: semantic?.intent || null,
    detectedLanguage: semantic?.replyLanguage || result.context?.responseLanguage || null,
    contextMode: result.context?.trip?.source === "conversation_history" ? "follow_up" : "new",
    routeResolutionStatus: result.context?.routeResolutionStatus || result.context?.trip?.status || "not_attempted",
    toolCallingMode,
    serverSelectedIntent: result.context?.toolIntent || null,
    modelSelectedTools: toolCallingMode === "model_selected" ? (result.context?.modelSelectedTools || toolNames).map(safeToolName).filter(Boolean) : [],
    toolsActuallyExecuted: execution.filter((item) => item.executed === true || item.executed === undefined && item.ok === true).map((item) => safeToolName(item.name)).filter(Boolean),
    toolCallCount: execution.length,
    toolRejectedCount: execution.filter((item) => item.ok !== true).length,
    modelRequestCount: Number.isInteger(result.context?.modelRequests) ? result.context.modelRequests : null,
    toolSuccessOrFailure: execution.map((item) => ({ name: item.name || null, success: item.ok === true, error: item.ok === true ? null : item.error?.code || "TOOL_FAILED" })),
    noToolExecutionReason,
    liveComparisonAttempted: execution.some((item) => item.name === "compare_live_fares" && item.executed === true),
    liveComparisonStatus: execution.some((item) => item.name === "compare_live_fares" && item.executed === true) ? (execution.some((item) => item.name === "compare_live_fares" && item.ok === true && item.result?.status === "OK") ? "completed" : "failed") : "not_attempted",
    responseSource: result.context?.responseSource || (result.fallbackUsed ? "safe_fallback" : result.comparisonId ? "llm_grounded" : result.modelId ? "llm_direct" : "deterministic"),
    fallbackReason: result.fallbackUsed ? result.errorCode || "llm_fallback" : null,
    totalLatencyMs: null,
  };
}

function clientSafeToolExecution(value) {
  const results = Array.isArray(value) ? value : value?.results;
  if (!Array.isArray(results)) return value;
  return { results: results.map((item) => {
    if (item?.name !== "search_locations") return item;
    const candidates = Array.isArray(item.result?.candidates) ? item.result.candidates : [];
    const valid = candidates.filter((candidate) => Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng));
    return {
      ...item,
      result: {
        status: item.result?.status || "UNKNOWN",
        diagnostics: {
          candidateCount: candidates.length,
          validCandidateCount: valid.length,
          ambiguous: valid.length > 1,
          hasVerifiedCandidate: valid.length === 1,
        },
        candidates: candidates.slice(0, 5).map((candidate) => ({
          name: candidate.name || null,
          address: candidate.address || null,
          city: candidate.city || null,
          placeId: candidate.placeId || null,
          approximate: candidate.approximate === true,
          resolutionType: candidate.resolutionType || null,
        })),
      },
    };
  }) };
}
const chat = asyncHandler(async (req, res) => {
  const error = validateMessage(req.body?.message); if (error) throw new AppError(error, 400);
  const comparisonId = req.body?.comparisonId == null ? null : String(req.body.comparisonId); if (comparisonId != null && !comparisonId) throw new AppError("Invalid comparison id", 400);
  const clientMessageId = req.body?.clientMessageId == null ? null : String(req.body.clientMessageId).trim(); if (clientMessageId && clientMessageId.length > 100) throw new AppError("Invalid client message id", 400);
  const existingConversation = await conversations.findByClientMessageId(req.user.id, clientMessageId || null);
  const conversation = existingConversation || await conversations.ensure(req.user.id, req.body?.conversationId == null ? null : idParam(req.body.conversationId));
  let requestRun = null;
  if (TOOL_AGENT_ENABLED() && clientMessageId) {
    requestRun = await conversations.claimRequestRun(req.user.id, conversation.id, clientMessageId);
    if (requestRun.status === "COMPLETED" && requestRun.response_json) return success(res, { message: "AI Ride Assistant response generated", data: { ...requestRun.response_json, conversation: await conversations.get(req.user.id, conversation.id) } });
    if (!requestRun.claimOwner && requestRun.status === "PENDING") throw new AppError("AI request is already in progress", 409);
    if (!requestRun.claimOwner && ["FAILED", "UNCERTAIN"].includes(requestRun.status)) {
      if (requestRun.response_json) return success(res, { message: "AI Ride Assistant response generated", data: { ...requestRun.response_json, conversation: await conversations.get(req.user.id, conversation.id) } });
      throw new AppError("AI request requires a safe retry after an uncertain prior attempt", 409);
    }
  }
  try {
  const requestId = req.headers["x-request-id"] ? String(req.headers["x-request-id"]).slice(0, 100) : crypto.randomUUID();
  const text = req.body.message.trim();
  const userMessage = await conversations.addMessage(req.user.id, conversation.id, "USER", text, null, clientMessageId || null);
  await conversations.titleFirstMessage(req.user.id, conversation.id, text);
  const result = await answer({ userId: req.user.id, message: text, comparisonId, conversationId: conversation.id, clientMessageId, requestRunId: requestRun?.id || null, requestId });
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const diagnostics = buildTraceDiagnostics(result, requestId);
    result.context = { ...result.context, diagnostics };
    console.info("[AI][trace]", diagnostics);
  }
  if (result.available) await conversations.addMessage(req.user.id, conversation.id, "ASSISTANT", result.reply, result.modelId);
  if (MEMORY_ENABLED() && result.comparisonId) {
    const identity = result.context?.serviceIdentity;
    await conversationMemory.addComparisonReference({ userId: req.user.id, conversationId: conversation.id, messageId: userMessage?.id || null, comparisonId: result.comparisonId, referenceType: "used", providerId: identity?.provider?.id || null, serviceCode: identity?.service?.code || null });
    await conversationMemory.saveContext({ userId: req.user.id, conversationId: conversation.id, currentComparisonId: result.comparisonId, activeProviderId: identity?.provider?.id || null, activeServiceCode: identity?.service?.code || null });
  }
  if (MEMORY_ENABLED()) await conversationMemory.summarizeOlderMessages({ userId: req.user.id, conversationId: conversation.id });
  if (requestRun) {
    const uncertain = Boolean(result.toolExecution?.results?.some((item) => item?.uncertain)) || result.errorCode === "REQUEST_DEADLINE_EXCEEDED";
    await conversations.completeRequestRun(req.user.id, requestRun.id, { status: uncertain ? "UNCERTAIN" : result.available === false ? "FAILED" : "COMPLETED", toolExecution: result.toolExecution || null, response: result, comparisonId: result.comparisonId || null, errorCode: result.errorCode || null });
  }
  return success(res, { message: "AI Ride Assistant response generated", data: { ...result, toolExecution: clientSafeToolExecution(result.toolExecution), conversation: await conversations.get(req.user.id, conversation.id) } });
  } catch (error) {
    if (requestRun?.claimOwner) {
      const uncertain = ["TOOL_TIMEOUT", "REQUEST_DEADLINE_EXCEEDED"].includes(error.code);
      try { await conversations.completeRequestRun(req.user.id, requestRun.id, { status: uncertain ? "UNCERTAIN" : "FAILED", errorCode: error.code || "AI_REQUEST_FAILED" }); } catch (stateError) { if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.warn("[AI] request-run state update failed", { code: stateError.code || "REQUEST_RUN_UPDATE_FAILED" }); }
    }
    throw error;
  }
});

module.exports = { chat, listConversations: existing.listConversations, createConversation: existing.createConversation, getConversation: existing.getConversation, renameConversation: existing.renameConversation, deleteConversation: existing.deleteConversation, buildTraceDiagnostics };
