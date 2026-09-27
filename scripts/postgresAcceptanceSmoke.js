require("../src/config/env");

const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const postgres = require("../src/config/postgres");
const emailProvider = require("../src/services/email/emailProvider");
const { getConfig } = require("../src/providers/indrive/indrive.constants");

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const users = [
  { name: `Acceptance A ${runId}`, email: `acceptance-a-${runId}@example.com`, password: `Acceptance-A-${runId}!` },
  { name: `Acceptance B ${runId}`, email: `acceptance-b-${runId}@example.com`, password: `Acceptance-B-${runId}!` },
];
const emailCodes = new Map();
const created = { userIds: [], searchIds: [], comparisonIds: [], conversationIds: [] };
const failures = [];

emailProvider.setEmailProviderForTests({
  async send({ to, subject, html }) {
    const code = html.match(/letter-spacing:8px[^>]*>(\d{6})/)?.[1];
    assert.ok(code, "acceptance email did not contain a six-digit code");
    emailCodes.set(`${to}:${subject.startsWith("Verify") ? "verify" : "reset"}`, code);
    return { accepted: true };
  },
});

function assertSuccess(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus, `expected HTTP ${expectedStatus}, received ${response.status}`);
  assert.equal(response.body?.success, true);
}

async function check(name, work) {
  try {
    await work();
    console.log(`${name}: PASS`);
  } catch (error) {
    failures.push(name);
    console.log(`${name}: FAIL (${error.code || error.name || "assertion"})`);
  }
}

async function createVerifiedUser(user) {
  const register = await request(app).post("/api/auth/register").send(user);
  assertSuccess(register);
  const verifyCode = emailCodes.get(`${user.email}:verify`);
  assert.ok(verifyCode, "verification code was not captured");
  const verify = await request(app).post("/api/auth/email/verify").send({ email: user.email, code: verifyCode });
  assertSuccess(verify);
  const login = await request(app).post("/api/auth/login").send({ email: user.email, password: user.password });
  assertSuccess(login);
  const userId = login.body.data.user.id;
  created.userIds.push(userId);
  return { id: userId, accessToken: login.body.data.accessToken };
}

async function cleanup() {
  try {
    for (const comparisonId of created.comparisonIds) {
      await postgres.query("DELETE FROM fare_observations WHERE comparison_id = $1", [comparisonId]);
      await postgres.query("DELETE FROM comparison_history_quotes WHERE comparison_id = $1", [comparisonId]);
      await postgres.query("DELETE FROM comparison_history WHERE id = $1", [comparisonId]);
    }
    for (const searchId of created.searchIds) {
      await postgres.query("DELETE FROM fare_results WHERE search_id = $1", [searchId]);
      await postgres.query("DELETE FROM fare_searches WHERE id = $1", [searchId]);
    }
    for (const userId of created.userIds) {
      await postgres.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  } catch (error) {
    console.log(`cleanup: FAIL (${error.code || error.name || "database error"})`);
    failures.push("cleanup");
  }
}

async function main() {
  let userA;
  let userB;
  let routeId;
  let comparisonId;
  let conversationId;

  await check("health/database", async () => {
    const response = await request(app).get("/api/health");
    assertSuccess(response);
    assert.equal(response.body.data.database, "connected");
  });

  await check("authenticated users", async () => {
    userA = await createVerifiedUser(users[0]);
    userB = await createVerifiedUser(users[1]);
  });

  if (!userA || !userB) {
    console.log("acceptance stopped: authenticated test-user setup failed");
    return;
  }

  await check("preferences persistence", async () => {
    const before = await request(app).get("/api/preferences").set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(before);
    const put = await request(app).put("/api/preferences").set("Authorization", `Bearer ${userA.accessToken}`).send({
      preferredVehicleType: "BIKE",
      avoidedVehicleTypes: ["PREMIUM_CAR"],
      typicalBudget: 500,
      ridePriority: "CHEAPEST",
    });
    assertSuccess(put);
    const after = await request(app).get("/api/preferences").set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(after);
    assert.equal(after.body.data.preferredVehicleType, "BIKE");
    assert.deepEqual(after.body.data.avoidedVehicleTypes, ["PREMIUM_CAR"]);
    assert.equal(after.body.data.typicalBudget, 500);
    assert.equal(after.body.data.ridePriority, "CHEAPEST");
  });

  await check("saved routes and ownership", async () => {
    const route = {
      name: `Acceptance Route ${runId}`,
      labelType: "FAVORITE",
      pickup: { name: "Acceptance Pickup", address: "A", latitude: 31.5001, longitude: 74.3001 },
      destination: { name: "Acceptance Destination", address: "B", latitude: 31.6001, longitude: 74.4001 },
    };
    const createdRoute = await request(app).post("/api/saved-routes").set("Authorization", `Bearer ${userA.accessToken}`).send(route);
    assertSuccess(createdRoute, 201);
    routeId = createdRoute.body.data.id;
    assert.ok(routeId);
    const list = await request(app).get("/api/saved-routes").set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(list);
    assert.ok(list.body.data.some((item) => item.id === routeId));
    const detail = await request(app).get(`/api/saved-routes/${routeId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(detail);
    const forbidden = await request(app).get(`/api/saved-routes/${routeId}`).set("Authorization", `Bearer ${userB.accessToken}`);
    assert.equal(forbidden.status, 404);
    const update = await request(app).put(`/api/saved-routes/${routeId}`).set("Authorization", `Bearer ${userA.accessToken}`).send({ name: `Updated Route ${runId}` });
    assertSuccess(update);
    const updated = await request(app).get(`/api/saved-routes/${routeId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(updated);
    assert.equal(updated.body.data.name, `Updated Route ${runId}`);
    const removed = await request(app).delete(`/api/saved-routes/${routeId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(removed);
    const missing = await request(app).get(`/api/saved-routes/${routeId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assert.equal(missing.status, 404);
  });

  await check("history persistence and ownership", async () => {
    assert.equal(getConfig().mode, "simulated", "INDRIVE_MODE must be simulated for this acceptance test");
    const comparison = await request(app).post("/api/fares/compare").set("Authorization", `Bearer ${userA.accessToken}`).send({
      pickup: { name: "Acceptance Pickup", lat: 31.5001, lng: 74.3001 },
      dropoff: { name: "Acceptance Destination", lat: 31.6001, lng: 74.4001 },
      vehicleType: "bike",
    });
    assertSuccess(comparison);
    comparisonId = comparison.body.data.comparisonId;
    const searchId = comparison.body.data.searchId;
    assert.ok(comparisonId);
    assert.ok(searchId);
    created.comparisonIds.push(comparisonId);
    created.searchIds.push(searchId);
    const list = await request(app).get("/api/history").set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(list);
    assert.ok(list.body.data.some((item) => item.id === comparisonId));
    const detail = await request(app).get(`/api/history/${comparisonId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(detail);
    const forbidden = await request(app).get(`/api/history/${comparisonId}`).set("Authorization", `Bearer ${userB.accessToken}`);
    assert.equal(forbidden.status, 404);
  });

  await check("AI conversation persistence and ownership", async () => {
    const createdConversation = await request(app).post("/api/ai/conversations").set("Authorization", `Bearer ${userA.accessToken}`).send({});
    assertSuccess(createdConversation, 201);
    conversationId = createdConversation.body.data.id;
    created.conversationIds.push(conversationId);
    assert.ok(conversationId);
    const list = await request(app).get("/api/ai/conversations").set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(list);
    assert.ok(list.body.data.some((item) => item.id === conversationId));
    const detail = await request(app).get(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(detail);
    const forbidden = await request(app).get(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userB.accessToken}`);
    assert.equal(forbidden.status, 404);
    const renamed = await request(app).patch(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userA.accessToken}`).send({ title: `Renamed ${runId}` });
    assertSuccess(renamed);
    const pinned = await request(app).patch(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userA.accessToken}`).send({ isPinned: true });
    assertSuccess(pinned);
    assert.equal(pinned.body.data.isPinned, true);
    const unpinned = await request(app).patch(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userA.accessToken}`).send({ isPinned: false });
    assertSuccess(unpinned);
    assert.equal(unpinned.body.data.isPinned, false);
    const removed = await request(app).delete(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assertSuccess(removed);
    const missing = await request(app).get(`/api/ai/conversations/${conversationId}`).set("Authorization", `Bearer ${userA.accessToken}`);
    assert.equal(missing.status, 404);
  });
}

main()
  .catch((error) => {
    failures.push("unexpected acceptance error");
    console.log(`unexpected acceptance error: FAIL (${error.code || error.name || "error"})`);
  })
  .finally(async () => {
    await cleanup();
    await postgres.pool?.end();
    if (failures.length) process.exitCode = 1;
  });
