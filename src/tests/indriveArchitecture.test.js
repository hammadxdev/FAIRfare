const test = require("node:test");
const assert = require("node:assert/strict");
const architecture = require("../providers/indrive-architecture");

test("provider session lifecycle is independent and single-flight", async () => {
  let now = 1_700_000_000_000;
  let refreshCalls = 0;
  let saved = { accessToken: "old-access", refreshToken: "old-refresh", accessExpiresAt: now + 1000, status: "READY", updatedAt: now };
  const manager = architecture.createSessionManager({
    clock: () => now,
    store: { load: async () => ({ ...saved }), save: async (next) => { saved = { ...next }; } },
    refresh: async ({ refreshToken }) => { refreshCalls += 1; assert.equal(refreshToken, "old-refresh"); return { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 }; },
  });
  assert.equal(await manager.isExpiringSoon(), true);
  assert.deepEqual(await Promise.all([manager.getAccessToken(), manager.getAccessToken(), manager.getAccessToken()]), ["new-access", "new-access", "new-access"]);
  assert.equal(refreshCalls, 1);
  assert.equal(saved.refreshToken, "new-refresh");
  assert.equal((await manager.getSessionStatus()).status, "READY");
  assert.equal(await manager.getValidAccessToken(), "new-access");
});

test("JWT expiry is decoded safely for scheduling only", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: 1_700_000_600 })).toString("base64url");
  const token = `${header}.${payload}.unverified`;
  assert.equal(architecture.decodeJwtExpiry(token), 1_700_000_600_000);
  assert.equal(architecture.decodeJwtExpiry("not-a-jwt"), null);
  const manager = architecture.createSessionManager({
    initialSession: { accessToken: token, refreshToken: "refresh" },
    clock: () => 1_700_000_000_000,
    expiryBufferSeconds: 300,
  });
  assert.equal(await manager.getValidAccessToken(), token);
});

test("invalid refresh responses are rejected without replacing persisted session", async () => {
  let saved = { accessToken: "old", refreshToken: "refresh", accessExpiresAt: 0, status: "READY" };
  const manager = architecture.createSessionManager({
    store: { load: async () => ({ ...saved }), save: async (next) => { saved = { ...next }; } },
    refresh: async () => ({ accessToken: "", expiresIn: 3600 }),
    clock: () => 1_700_000_000_000,
  });
  await assert.rejects(manager.getValidAccessToken(), (error) => error.code === architecture.CODES.BAD_RESPONSE);
  assert.equal(saved.accessToken, "old");
});

test("provider refresh failure marks reauthentication without affecting FairFare auth", async () => {
  let saved = { accessToken: "old-access", refreshToken: "old-refresh", accessExpiresAt: 0, status: "READY", updatedAt: 1 };
  const manager = architecture.createSessionManager({
    store: { load: async () => ({ ...saved }), save: async (next) => { saved = { ...next }; } },
    refresh: async () => { throw Object.assign(new Error("revoked"), { code: 401 }); },
  });
  await assert.rejects(manager.getAccessToken(), (error) => error.code === architecture.CODES.AUTH_REQUIRED);
  assert.equal(saved.status, "AUTH_REQUIRED");
});

test("normalized provider operations validate, convert and preserve explicit statuses", async () => {
  const provider = architecture.createIndriveProvider();
  const suggestions = await provider.getSuggestions({ text: "lgu", latitude: 31.4, longitude: 74.3, sessionId: "synthetic-session" });
  assert.equal(suggestions.status, "available");
  assert.equal(suggestions.suggestions[0].source, "indrive-mock");

  const route = await provider.getRoute({ pickup: { latitude: 31.4, longitude: 74.3 }, destination: { latitude: 31.5, longitude: 74.35 } });
  assert.deepEqual(route.route, { distanceMeters: 9301, durationSeconds: 1139, encodedPolyline: null });

  const fares = await provider.getFareEstimates({ pickup: { latitude: 31.4, longitude: 74.3 }, destination: { latitude: 31.5, longitude: 74.35 }, route: route.route });
  assert.equal(fares.currency, "PKR");
  assert.equal(fares.status, "unavailable");
  assert.deepEqual(fares.estimates, []);
  assert.equal(fares.error.code, "LIVE_INTEGRATION_NOT_CONFIGURED");

  const drivers = await provider.getNearbyDrivers({ latitude: 31.4, longitude: 74.3, rideType: "ride_mini" });
  assert.equal(drivers.status, "unavailable");
  assert.notEqual(drivers.status, "no_drivers");
  const invalid = await provider.getSuggestions({ text: "" });
  assert.equal(invalid.status, "invalid_request");
  assert.equal(invalid.code, architecture.CODES.INVALID_REQUEST);
});

test("provider status and normalized responses contain no credentials", async () => {
  const provider = architecture.createIndriveProvider();
  const output = JSON.stringify(await provider.getProviderStatus());
  assert.doesNotMatch(output, /accessToken|refreshToken|fingerprint|authorization/i);
});
