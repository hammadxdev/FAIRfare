const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { answer, validateMessage } = require("../services/tripAwareAiAssistant.service");
const conversations = require("../services/ai/conversation.service");
const conversationMemory = require("../services/ai/conversationMemory.service");
const existing = require("./ai.controller");
const TOOL_AGENT_ENABLED = () => String(process.env.FAIRFARE_AI_TOOL_AGENT_ENABLED || "false").toLowerCase() === "true";
const MEMORY_ENABLED = () => String(process.env.FAIRFARE_AI_PHASE3_SCHEMA_VERIFIED || "false").toLowerCase() === "true" && String(process.env.FAIRFARE_AI_MEMORY_ENABLED || "false").toLowerCase() === "true";

function idParam(value) { const id = String(value || ""); if (!id) throw new AppError("Invalid conversation id", 400); return id; }
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
  const text = req.body.message.trim();
  const userMessage = await conversations.addMessage(req.user.id, conversation.id, "USER", text, null, clientMessageId || null);
  await conversations.titleFirstMessage(req.user.id, conversation.id, text);
  const result = await answer({ userId: req.user.id, message: text, comparisonId, conversationId: conversation.id, clientMessageId, requestRunId: requestRun?.id || null });
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
  return success(res, { message: "AI Ride Assistant response generated", data: { ...result, conversation: await conversations.get(req.user.id, conversation.id) } });
  } catch (error) {
    if (requestRun?.claimOwner) {
      const uncertain = ["TOOL_TIMEOUT", "REQUEST_DEADLINE_EXCEEDED"].includes(error.code);
      try { await conversations.completeRequestRun(req.user.id, requestRun.id, { status: uncertain ? "UNCERTAIN" : "FAILED", errorCode: error.code || "AI_REQUEST_FAILED" }); } catch (stateError) { if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.warn("[AI] request-run state update failed", { code: stateError.code || "REQUEST_RUN_UPDATE_FAILED" }); }
    }
    throw error;
  }
});

module.exports = { chat, listConversations: existing.listConversations, createConversation: existing.createConversation, getConversation: existing.getConversation, renameConversation: existing.renameConversation, deleteConversation: existing.deleteConversation };
