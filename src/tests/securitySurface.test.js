const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");

const originalOrigins = process.env.FAIRFARE_ALLOWED_ORIGINS;
const originalHealthToken = process.env.HEALTH_DIAGNOSTICS_TOKEN;

test.after(() => {
  if (originalOrigins === undefined) delete process.env.FAIRFARE_ALLOWED_ORIGINS;
  else process.env.FAIRFARE_ALLOWED_ORIGINS = originalOrigins;
  if (originalHealthToken === undefined) delete process.env.HEALTH_DIAGNOSTICS_TOKEN;
  else process.env.HEALTH_DIAGNOSTICS_TOKEN = originalHealthToken;
});

test("CORS allows an explicitly configured browser origin", async () => {
  process.env.FAIRFARE_ALLOWED_ORIGINS = "https://fairfare.example, https://staging.fairfare.example";
  const response = await request(app).get("/api/health").set("Origin", "https://fairfare.example");
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "https://fairfare.example");
}
);

test("CORS omits permission for an unlisted browser origin", async () => {
  process.env.FAIRFARE_ALLOWED_ORIGINS = "https://fairfare.example";
  const response = await request(app).get("/api/health").set("Origin", "https://evil.example");
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
}
);

test("native/no-Origin requests remain compatible", async () => {
  process.env.FAIRFARE_ALLOWED_ORIGINS = "https://fairfare.example";
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.application, "alive");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
}
);

test("allowed CORS preflight returns the configured origin and methods", async () => {
  process.env.FAIRFARE_ALLOWED_ORIGINS = "https://fairfare.example";
  const response = await request(app)
    .options("/api/ai/chat")
    .set("Origin", "https://fairfare.example")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "authorization, content-type");
  assert.equal(response.status, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://fairfare.example");
  assert.match(response.headers["access-control-allow-methods"], /POST/);
}
);

test("disallowed CORS preflight receives no permission", async () => {
  process.env.FAIRFARE_ALLOWED_ORIGINS = "https://fairfare.example";
  const response = await request(app)
    .options("/api/ai/chat")
    .set("Origin", "https://evil.example")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "authorization");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
}
);

test("public health is minimal and config diagnostics are not public", async () => {
  delete process.env.HEALTH_DIAGNOSTICS_TOKEN;
  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.data, { application: "alive" });
  const config = await request(app).get("/api/health/config");
  assert.equal(config.status, 404);
  assert.equal(JSON.stringify(config.body).includes("GROQ_API_KEY"), false);
}
);

test("health diagnostics require the internal token and still expose only booleans", async () => {
  process.env.HEALTH_DIAGNOSTICS_TOKEN = "test-health-token";
  const denied = await request(app).get("/api/health/config").set("x-health-diagnostics-token", "wrong");
  assert.equal(denied.status, 404);
  const allowed = await request(app).get("/api/health/config").set("x-health-diagnostics-token", "test-health-token");
  assert.equal(allowed.status, 200);
  assert.equal(typeof allowed.body.data.GROQ_API_KEY, "boolean");
  assert.equal(JSON.stringify(allowed.body).includes("your_server_side"), false);
}
);
