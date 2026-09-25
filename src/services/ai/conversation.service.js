const db = require("../../config/database");
const AppError = require("../../utils/AppError");

const MAX_TITLE_LENGTH = 60;
const MAX_CONTEXT_MESSAGES = 12;

function titleFromMessage(message) {
  const clean = String(message || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New Chat";
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH - 3).trim()}...` : clean;
}

function publicConversation(row) {
  return { id: row.id, title: row.title, isPinned: Boolean(row.is_pinned), createdAt: row.created_at, updatedAt: row.updated_at };
}

function getOwned(conversationId, userId) {
  const row = db.prepare("SELECT id, user_id, title, is_pinned, created_at, updated_at FROM ai_conversations WHERE id = ? AND user_id = ?").get(conversationId, userId);
  if (!row) throw new AppError("Conversation not found", 404);
  return row;
}

function create(userId, title = "New Chat") {
  const result = db.prepare("INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)").run(userId, String(title).trim() || "New Chat");
  return publicConversation(db.prepare("SELECT * FROM ai_conversations WHERE id = ?").get(result.lastInsertRowid));
}

function list(userId) {
  return db.prepare("SELECT id, title, is_pinned, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC, id DESC").all(userId).map(publicConversation);
}

function get(userId, conversationId) {
  const conversation = getOwned(conversationId, userId);
  const messages = db.prepare("SELECT id, role, content, model_id, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC").all(conversation.id).map((row) => ({ id: row.id, role: row.role, content: row.content, ...(row.model_id ? { modelId: row.model_id } : {}), createdAt: row.created_at }));
  return { ...publicConversation(conversation), messages };
}

function rename(userId, conversationId, title) {
  const clean = String(title || "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_TITLE_LENGTH) throw new AppError(`title must be between 1 and ${MAX_TITLE_LENGTH} characters`, 400);
  getOwned(conversationId, userId);
  db.prepare("UPDATE ai_conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(clean, conversationId, userId);
  return publicConversation(getOwned(conversationId, userId));
}

function update(userId, conversationId, changes = {}) {
  const conversation = getOwned(conversationId, userId);
  const fields = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const clean = String(changes.title || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length > MAX_TITLE_LENGTH) throw new AppError(`title must be between 1 and ${MAX_TITLE_LENGTH} characters`, 400);
    fields.push("title = ?"); values.push(clean);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "isPinned")) {
    if (typeof changes.isPinned !== "boolean") throw new AppError("isPinned must be a boolean", 400);
    fields.push("is_pinned = ?"); values.push(changes.isPinned ? 1 : 0);
  }
  if (!fields.length) throw new AppError("No conversation changes provided", 400);
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ai_conversations SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`).run(...values, conversationId, userId);
  return publicConversation(getOwned(conversationId, userId));
}

function remove(userId, conversationId) { getOwned(conversationId, userId); db.prepare("DELETE FROM ai_conversations WHERE id = ? AND user_id = ?").run(conversationId, userId); }

function ensure(userId, conversationId) {
  if (conversationId == null) return create(userId);
  const conversation = getOwned(conversationId, userId);
  return publicConversation(conversation);
}

function addMessage(userId, conversationId, role, content, modelId = null) {
  getOwned(conversationId, userId);
  const result = db.prepare("INSERT INTO ai_messages (conversation_id, role, content, model_id) VALUES (?, ?, ?, ?)").run(conversationId, role, content, modelId);
  db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(conversationId, userId);
  return db.prepare("SELECT id, role, content, created_at FROM ai_messages WHERE id = ?").get(result.lastInsertRowid);
}

function titleFirstMessage(userId, conversationId, message) {
  const row = getOwned(conversationId, userId);
  if (row.title !== "New Chat") return;
  db.prepare("UPDATE ai_conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(titleFromMessage(message), conversationId, userId);
}

function recentMessages(userId, conversationId) {
  getOwned(conversationId, userId);
  return db.prepare("SELECT role, content FROM (SELECT role, content, created_at, id FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at ASC, id ASC").all(conversationId, MAX_CONTEXT_MESSAGES);
}

module.exports = { create, list, get, rename, update, remove, ensure, addMessage, titleFirstMessage, recentMessages, titleFromMessage, MAX_CONTEXT_MESSAGES };
