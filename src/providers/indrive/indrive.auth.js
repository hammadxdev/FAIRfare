const postgres = require("../../config/postgres");
const { getConfig, PROVIDER_ID } = require("./indrive.constants");
const { IndriveError, CODES } = require("./indrive.errors");

function createSessionManager({ client, config = getConfig(), now = () => Date.now(), database = postgres, logger = console } = {}) {
  let refreshPromise = null;

  async function load() {
    const row = (await database.query("SELECT * FROM provider_sessions WHERE provider = $1", [PROVIDER_ID])).rows[0];
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

  async function save(session) {
    await database.query(`
      INSERT INTO provider_sessions (provider, access_token, refresh_token, access_expires_at, status, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,
        refresh_token=excluded.refresh_token, access_expires_at=excluded.access_expires_at,
        status=excluded.status, updated_at=excluded.updated_at
    `, [PROVIDER_ID,session.accessToken || null,session.refreshToken || null,session.accessExpiresAt || null,session.status,now()]);
    return session;
  }

  async function configuredRefreshToken(session = null) {
    if (!session) session = await load();
    return session?.refreshToken || config.refreshToken || null;
  }

  function hasUsableAccess(session) {
    return Boolean(session?.accessToken && Number(session.accessExpiresAt) > now() + config.refreshBufferSeconds * 1000);
  }

  async function refreshSession() {
    const previous = await load();
    const refreshToken = await configuredRefreshToken(previous);
    if (!refreshToken) {
      await save({ ...(previous || {}), accessToken: previous?.accessToken || null, refreshToken: null, accessExpiresAt: previous?.accessExpiresAt || null, status: "NOT_CONFIGURED" });
      throw new IndriveError(CODES.NOT_CONFIGURED, "inDrive refresh token is not configured");
    }
    if (!config.deviceFingerprint || !config.fingerprint) {
      await save({ ...(previous || {}), refreshToken, status: "AUTH_REQUIRED" });
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive fingerprints are not configured");
    }
    logger.log("[inDrive] refreshing session");
    const response = await client.renew(refreshToken);
    if (response.status === 401 || response.status === 403) {
      await save({ ...(previous || {}), refreshToken, status: "AUTH_REQUIRED" });
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
    const session = await save({
      accessToken: body.access_token,
      refreshToken: body.refresh_token || refreshToken,
      accessExpiresAt: now() + expiresIn * 1000,
      status: "READY",
    });
    logger.log("[inDrive] session renewed");
    return session.accessToken;
  }

  async function ensureValidSession({ force = false } = {}) {
    const session = await load();
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

  async function markAuthRequired() {
    const session = await load() || {};
    await save({ ...session, status: "AUTH_REQUIRED" });
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
