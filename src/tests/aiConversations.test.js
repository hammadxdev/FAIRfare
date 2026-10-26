const test = require("node:test");
const assert = require("node:assert/strict");

test("completeRequestRun binds runId and userId as parameters six and seven", async () => {
  const postgresPath = require.resolve("../config/postgres");
  const conversationPath = require.resolve("../services/ai/conversation.service");
  const postgres = require(postgresPath);
  const originalQuery = postgres.query;
  const originalConversationModule = require.cache[conversationPath];
  let captured;
  postgres.query = async (sql, params) => {
    captured = { sql, params };
    return { rows: [{}] };
  };
  delete require.cache[conversationPath];

  try {
    const conversations = require(conversationPath);
    await conversations.completeRequestRun("user-7", "run-6");
    assert.match(captured.sql, /WHERE id=\$6 AND user_id=\$7 AND status='PENDING'/);
    assert.equal(captured.params.length, 7);
    assert.equal(captured.params[5], "run-6");
    assert.equal(captured.params[6], "user-7");
  } finally {
    postgres.query = originalQuery;
    delete require.cache[conversationPath];
    if (originalConversationModule) require.cache[conversationPath] = originalConversationModule;
  }
});

test.beforeEach(() => {
  const assistant = require("../services/ai/aiRideAssistant.service");
  assistant.setLlmClientForTests({ complete: async ({ context }) => { global.__conversationContext = context; return "Persisted assistant reply"; } });
});

test("AI conversations persist, stay ordered, and ignore client userId", async () => {
  const request = require("supertest");
  const app = require("./setup");
  const { query } = require("../config/postgres");
  const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
  const assistant = require("../services/ai/aiRideAssistant.service");
  const a = await createAuthenticatedTestUser(app, "Conversation A");
  const b = await createAuthenticatedTestUser(app, "Conversation B");
  const ah = { Authorization: authHeader(a) }; const bh = { Authorization: authHeader(b) };
  const created = await request(app).post("/api/ai/conversations").set(ah).send({ userId: b.user.id });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.match(created.body.data.title, /New Chat/);
  assert.equal(created.body.data.isPinned, false);
  assert.equal((await request(app).get("/api/ai/conversations").set(bh)).body.data.some((item) => item.id === id), false);
  assert.equal((await request(app).get(`/api/ai/conversations/${id}`).set(bh)).status, 404);
  assert.equal((await request(app).patch(`/api/ai/conversations/${id}`).set(bh).send({ title: "Nope" })).status, 404);
  assert.equal((await request(app).patch(`/api/ai/conversations/${id}`).set(bh).send({ isPinned: true, userId: a.user.id })).status, 404);
  assert.equal((await request(app).delete(`/api/ai/conversations/${id}`).set(bh)).status, 404);

  const chat = await request(app).post("/api/ai/chat").set(ah).send({ conversationId: id, userId: b.user.id, message: "I have Rs. 600 and don't want a bike" });
  assert.equal(chat.status, 200);
  assert.match(chat.body.data.conversation.title, /Rs\. 600/);
  assert.equal(chat.body.data.conversation.messages.length, 2);
  assert.equal((await request(app).get(`/api/ai/conversations/${id}`).set(ah)).body.data.messages[0].role, "USER");
  assert.equal((await request(app).post("/api/ai/chat").set(bh).send({ conversationId: id, message: "intrude" })).status, 404);
  const renamed = await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({ title: "Budget rides" });
  assert.equal(renamed.body.data.title, "Budget rides");
  assert.equal((await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({})).status, 400);
  assert.equal((await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({ isPinned: "true" })).status, 400);
  const pinned = await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({ isPinned: true, userId: b.user.id });
  assert.equal(pinned.body.data.isPinned, true);
  assert.equal((await request(app).get("/api/ai/conversations").set(ah)).body.data[0].isPinned, true);
  const unpinned = await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({ isPinned: false });
  assert.equal(unpinned.body.data.isPinned, false);
  const renamedAndPinned = await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({ title: "Budget rides again", isPinned: true });
  assert.equal(renamedAndPinned.body.data.title, "Budget rides again");
  assert.equal(renamedAndPinned.body.data.isPinned, true);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = $1", [id])).rows[0].count), 2);
  await request(app).patch(`/api/ai/conversations/${id}`).set(ah).send({ isPinned: true });
  assert.equal((await request(app).get("/api/ai/conversations").set(ah)).body.data[0].id, id);
  assert.equal((await request(app).delete(`/api/ai/conversations/${id}`).set(ah)).status, 200);
  assert.equal((await request(app).get(`/api/ai/conversations/${id}`).set(ah)).status, 404);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = $1", [id])).rows[0].count), 0);
});

test("AI failure preserves the user message but never stores fake assistant text", async () => {
  const request = require("supertest");
  const app = require("./setup");
  const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
  const assistant = require("../services/ai/aiRideAssistant.service");
  const auth = await createAuthenticatedTestUser(app, "Conversation Failure");
  assistant.setLlmClientForTests({ complete: async () => { const error = new Error("provider down"); error.code = "LLM_PROVIDER_ERROR"; throw error; } });
  const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ message: "Will it be cheaper?" });
  assert.equal(response.status, 200);
  const conversation = response.body.data.conversation;
  assert.equal(response.body.data.available, false);
  assert.equal(response.body.data.status, "UNAVAILABLE");
  assert.deepEqual(conversation.messages.map((message) => message.role), ["USER"]);
  assert.doesNotMatch(JSON.stringify(conversation), /temporarily unavailable/i);
});

test("AI context history is bounded and logout does not delete conversations", async () => {
  const request = require("supertest");
  const app = require("./setup");
  const { query } = require("../config/postgres");
  const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");
  const auth = await createAuthenticatedTestUser(app, "Conversation Context");
  let conversationId;
  for (let i = 0; i < 14; i += 1) {
    const response = await request(app).post("/api/ai/chat").set("Authorization", authHeader(auth)).send({ conversationId, message: `message ${i}` });
    conversationId = response.body.data.conversation.id;
  }
  assert.ok(global.__conversationContext.recentConversation.length <= 12);
  const logout = await request(app).post("/api/auth/logout").send({ refreshToken: auth.refreshToken });
  assert.equal(logout.status, 200);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM ai_conversations WHERE id = $1", [conversationId])).rows[0].count), 1);
  const otp = await request(app).post("/api/auth/email/otp/request").send({ email: auth.email });
  assert.equal(otp.status, 200);
  const code = global.__emailTestCodes.get(`${auth.email}:verify`);
  const login = await request(app).post("/api/auth/email/otp/verify").send({ email: auth.email, code });
  assert.equal(login.status, 200);
  assert.equal((await request(app).get("/api/ai/conversations").set("Authorization", authHeader(login.body.data))).body.data.some((item) => item.id === conversationId), true);
});
