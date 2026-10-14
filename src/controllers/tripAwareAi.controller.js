const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { answer, validateMessage } = require("../services/tripAwareAiAssistant.service");
const conversations = require("../services/ai/conversation.service");
const existing = require("./ai.controller");

function idParam(value) { const id = String(value || ""); if (!id) throw new AppError("Invalid conversation id", 400); return id; }
const chat = asyncHandler(async (req, res) => {
  const error = validateMessage(req.body?.message); if (error) throw new AppError(error, 400);
  const comparisonId = req.body?.comparisonId == null ? null : String(req.body.comparisonId); if (comparisonId != null && !comparisonId) throw new AppError("Invalid comparison id", 400);
  const clientMessageId = req.body?.clientMessageId == null ? null : String(req.body.clientMessageId).trim(); if (clientMessageId && clientMessageId.length > 100) throw new AppError("Invalid client message id", 400);
  const existingConversation = await conversations.findByClientMessageId(req.user.id, clientMessageId || null);
  const conversation = existingConversation || await conversations.ensure(req.user.id, req.body?.conversationId == null ? null : idParam(req.body.conversationId));
  const text = req.body.message.trim();
  await conversations.addMessage(req.user.id, conversation.id, "USER", text, null, clientMessageId || null);
  await conversations.titleFirstMessage(req.user.id, conversation.id, text);
  const result = await answer({ userId: req.user.id, message: text, comparisonId, conversationId: conversation.id });
  if (result.available) await conversations.addMessage(req.user.id, conversation.id, "ASSISTANT", result.reply, result.modelId);
  return success(res, { message: "AI Ride Assistant response generated", data: { ...result, conversation: await conversations.get(req.user.id, conversation.id) } });
});

module.exports = { chat, listConversations: existing.listConversations, createConversation: existing.createConversation, getConversation: existing.getConversation, renameConversation: existing.renameConversation, deleteConversation: existing.deleteConversation };
