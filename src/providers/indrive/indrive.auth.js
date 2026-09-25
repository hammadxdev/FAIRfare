const db = require("../../config/database");
const { getConfig, PROVIDER_ID } = require("./indrive.constants");
const { IndriveError, CODES } = require("./indrive.errors");

function createSessionManager({ client, config = getConfig(), now = () => Date.now(), database = db, logger = console } = {}) {
  let refreshPromise = null;

  function load() {
    const row = database.prepare("SELECT * FROM provider_sessions WHERE provider = ?").get(PROVIDER_ID);
    if (!row) return null;
    return {
      provider: row.provider,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      accessExpiresAt: row.access_expires_at,
      status: row.status,
      updatedAt: row.updated_at,
    };
  }

  function save(session) {
    database.prepare(`
      INSERT INTO provider_sessions (provider, access_token, refresh_token, access_expires_at, status, updated_at)
      VALUES (@provider, @access_token, @refresh_token, @access_expires_at, @status, @updated_at)
      ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,
        refresh_token=excluded.refresh_token, access_expires_at=excluded.access_expires_at,
        status=excluded.status, updated_at=excluded.updated_at
    `).run({
      provider: PROVIDER_ID,
      access_token: session.accessToken || null,
      refresh_token: session.refreshToken || null,
      access_expires_at: session.accessExpiresAt || null,
      status: session.status,
      updated_at: now(),
    });
    return session;
  }

  function configuredRefreshToken(session = load()) {
    return session?.refreshToken || config.refreshToken || null;
  }

  function hasUsableAccess(session) {
    return Boolean(session?.accessToken && Number(session.accessExpiresAt) > now() + config.refreshBufferSeconds * 1000);
  }

  async function refreshSession() {
    const previous = load();
    const refreshToken = configuredRefreshToken(previous);
    if (!refreshToken) {
      save({ ...(previous || {}), accessToken: previous?.accessToken || null, refreshToken: null, accessExpiresAt: previous?.accessExpiresAt || null, status: "NOT_CONFIGURED" });
      throw new IndriveError(CODES.NOT_CONFIGURED, "inDrive refresh token is not configured");
    }
    if (!config.deviceFingerprint || !config.fingerprint) {
      save({ ...(previous || {}), refreshToken, status: "AUTH_REQUIRED" });
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive fingerprints are not configured");
    }
    logger.log("[inDrive] refreshing session");
    const response = await client.renew(refreshToken);
    if (response.status === 401 || response.status === 403) {
      save({ ...(previous || {}), refreshToken, status: "AUTH_REQUIRED" });
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive session renewal was rejected");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IndriveError(response.status === 429 ? CODES.RATE_LIMITED : CODES.UNAVAILABLE, "inDrive session renewal failed", { status: response.status });
    }
    const body = response.body || {};
    const expiresIn = Number(body.expires_in);
    if (!body.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new IndriveError(CODES.BAD_RESPONSE, "inDrive renewal response is missing a valid access token or expiry");
    }
    const session = save({
      accessToken: body.access_token,
      refreshToken: body.refresh_token || refreshToken,
      accessExpiresAt: now() + expiresIn * 1000,
      status: "READY",
    });
    logger.log("[inDrive] session renewed");
    return session.accessToken;
  }

  async function ensureValidSession({ force = false } = {}) {
    const session = load();
    if (!force && !session?.accessToken && !configuredRefreshToken(session)) {
      if (!refreshPromise) refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
      return refreshPromise;
    }
    if (config.mode === "real" && (!config.deviceFingerprint || !config.fingerprint)) {
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive fingerprints are not configured");
    }
    if (!force && hasUsableAccess(session)) {
      logger.log("[inDrive] access token valid");
      return session.accessToken;
    }
    if (!refreshPromise) refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function markAuthRequired() {
    const session = load() || {};
    save({ ...session, status: "AUTH_REQUIRED" });
  }

  async function getStatus() {
    if (!config.enabled) return "DISABLED";
    if (config.mode !== "real") return "READY";
    try { await ensureValidSession(); return "READY"; }
    catch (error) {
      if (error.code === CODES.NOT_CONFIGURED) return "NOT_CONFIGURED";
      if (error.code === CODES.AUTH_REQUIRED) return "AUTH_REQUIRED";
      return "TEMPORARILY_UNAVAILABLE";
    }
  }

  return { load, save, refreshSession, ensureValidSession, markAuthRequired, getStatus, hasUsableAccess };
}

module.exports = { createSessionManager };
