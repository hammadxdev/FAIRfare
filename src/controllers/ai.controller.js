const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { answer, validateMessage } = require("../services/ai/aiRideAssistant.service");
const conversations = require("../services/ai/conversation.service");

function idParam(value) { const id = String(value || ""); if (!id) throw new AppError("Invalid conversation id", 400); return id; }
function conversationChanges(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("Conversation changes must be an object", 400);
  const keys = Object.keys(body);
  if (!keys.length) throw new AppError("No conversation changes provided", 400);
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    if (typeof body.title !== "string") throw new AppError("title must be a string", 400);
    changes.title = body.title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "isPinned")) {
    if (typeof body.isPinned !== "boolean") throw new AppError("isPinned must be a boolean", 400);
    changes.isPinned = body.isPinned;
  }
  return changes;
}

const listConversations = asyncHandler(async (req, res) => success(res, { message: "AI conversations fetched", data: await conversations.list(req.user.id) }));
const createConversation = asyncHandler(async (req, res) => success(res, { message: "AI conversation created", data: await conversations.create(req.user.id), statusCode: 201 }));
const getConversation = asyncHandler(async (req, res) => success(res, { message: "AI conversation fetched", data: await conversations.get(req.user.id, idParam(req.params.id)) }));
const updateConversation = asyncHandler(async (req, res) => {
  const conversationId = idParam(req.params.id);
  // Resolve ownership before payload validation so another user's resource
  // remains indistinguishable from a missing resource (404).
  await conversations.get(req.user.id, conversationId);
  return success(res, { message: "AI conversation updated", data: await conversations.update(req.user.id, conversationId, conversationChanges(req.body)) });
});
const deleteConversation = asyncHandler(async (req, res) => { await conversations.remove(req.user.id, idParam(req.params.id)); return success(res, { message: "AI conversation deleted", data: null }); });

const chat = asyncHandler(async (req, res) => {
  const error = validateMessage(req.body?.message);
  if (error) throw new AppError(error, 400);
  const comparisonId = req.body?.comparisonId == null ? null : String(req.body.comparisonId);
  if (comparisonId != null && !comparisonId) throw new AppError("Invalid comparison id", 400);
  const conversation = await conversations.ensure(req.user.id, req.body?.conversationId == null ? null : idParam(req.body.conversationId));
  const text = req.body.message.trim();
  await conversations.addMessage(req.user.id, conversation.id, "USER", text);
  await conversations.titleFirstMessage(req.user.id, conversation.id, text);
  const result = await answer({ userId: req.user.id, message: text, comparisonId, conversationId: conversation.id });
  if (result.available) await conversations.addMessage(req.user.id, conversation.id, "ASSISTANT", result.reply, result.modelId);
  return success(res, { message: "AI Ride Assistant response generated", data: { ...result, conversation: await conversations.get(req.user.id, conversation.id) } });
});

module.exports = { chat, listConversations, createConversation, getConversation, renameConversation: updateConversation, updateConversation, deleteConversation };
