const postgres = require("../../config/postgres");
const { getConfig, PROVIDER_ID } = require("./indrive.constants");
const { IndriveError, CODES } = require("./indrive.errors");

function createSessionManager({ client, config = getConfig(), now = () => Date.now(), database = postgres, logger = console } = {}) {
  let refreshPromise = null;
  let renewalTimer = null;
  let started = false;
  const refreshBufferSeconds = Number.isFinite(Number(config.refreshBufferSeconds)) ? Number(config.refreshBufferSeconds) : 300;

  function epochMillis(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    // Current Unix seconds are ~1e9; current Unix milliseconds are ~1e12.
    // Normalize legacy seconds rows once at the read boundary. All writes below
    // remain milliseconds, so no credential or expiry value is extended.
    return numeric < 100000000000 ? numeric * 1000 : numeric;
  }

  function jwtExpiryMillis(token) {
    if (typeof token !== "string") return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const exp = Number(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).exp);
      return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
    } catch (_) { return null; }
  }

  function sessionExpiryMillis(session) {
    const stored = epochMillis(session?.accessExpiresAt);
    if (stored !== null) return stored;
    return jwtExpiryMillis(session?.accessToken);
  }

  function selectCredentials(row) {
    if (!row) return null;
    const persisted = {
      provider: row.provider,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      accessExpiresAt: sessionExpiryMillis({ accessToken: row.access_token, accessExpiresAt: row.access_expires_at }),
      status: row.status,
      source: "postgresql",
      rotationVersion: Number(row.rotation_version) || 0,
      lastRotatedAt: epochMillis(row.last_rotated_at),
      updatedAt: row.updated_at,
    };
    return persisted;
  }

  async function read(executor = database) {
    let row;
    try {
      row = (await executor.query("SELECT * FROM provider_sessions WHERE provider = $1", [PROVIDER_ID])).rows[0];
    } catch (error) {
      throw error;
    }
    return selectCredentials(row);
  }

  async function load() {
    return read(database);
  }

  async function write(session, executor = database) {
    await executor.query(`
      INSERT INTO provider_sessions (provider, access_token, refresh_token, access_expires_at, status, rotation_version, last_rotated_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,
        refresh_token=excluded.refresh_token, access_expires_at=excluded.access_expires_at,
        status=excluded.status, rotation_version=excluded.rotation_version,
        last_rotated_at=excluded.last_rotated_at, updated_at=excluded.updated_at
    `, [PROVIDER_ID, session.accessToken || null, session.refreshToken || null, session.accessExpiresAt || null,
      session.status, Number(session.rotationVersion) || 0, session.lastRotatedAt || null, now()]);
    return session;
  }

  async function save(session) {
    return write(session, database);
  }

  async function configuredRefreshToken(session = null) {
    if (!session) session = await load();
    return session?.refreshToken || null;
  }

  function hasUsableAccess(session) {
    if (!session?.accessToken) return false;
    const expiry = sessionExpiryMillis(session);
    return !Number.isFinite(expiry) || expiry > now() + refreshBufferSeconds * 1000;
  }

  function scheduleRenewal(session) {
    if (!started) return;
    if (renewalTimer) clearTimeout(renewalTimer);
    renewalTimer = null;
    const expiry = Number(session?.accessExpiresAt);
    if (!Number.isFinite(expiry) || !session?.refreshToken) return;
    const delay = Math.max(0, expiry - now() - refreshBufferSeconds * 1000);
    renewalTimer = setTimeout(async () => {
      renewalTimer = null;
      try {
        await ensureValidSession({ force: true });
        scheduleRenewal(await load());
      } catch (error) {
        // Authentication failures stop automatic renewal until reauthentication;
        // no retry loop is started and no credential detail is logged.
        logger.log("[inDrive] automatic renewal stopped", { code: error?.code || CODES.UNAVAILABLE });
      }
    }, delay);
    if (typeof renewalTimer.unref === "function") renewalTimer.unref();
  }

  async function refreshSession({ force = false } = {}) {
    const refreshWork = async (executor) => {
    const previous = await read(executor);
    if (!force && hasUsableAccess(previous)) return previous.accessToken;
    const refreshToken = await configuredRefreshToken(previous);
    if (!refreshToken) {
      const code = previous?.accessToken ? CODES.AUTH_REQUIRED : CODES.NOT_CONFIGURED;
      throw new IndriveError(code, previous?.accessToken ? "inDrive access token is expired or invalid" : "inDrive refresh token is not configured");
    }
    if (!config.deviceFingerprint || !config.fingerprint) {
      await write({ ...(previous || {}), refreshToken, status: "AUTH_REQUIRED" }, executor);
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive fingerprints are not configured");
    }
    logger.log("[inDrive] refreshing session");
    const response = await client.renew(refreshToken);
    if (response.status === 401) {
      await write({ ...(previous || {}), refreshToken, status: "AUTH_REQUIRED" }, executor);
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive session renewal was rejected", { status: response.status, errorCategory: "AUTH_ERROR" });
    }
    if (response.status === 403) {
      await write({ ...(previous || {}), refreshToken, status: "ACCESS_DENIED" }, executor);
      throw new IndriveError(CODES.ACCESS_DENIED, "inDrive session renewal was denied", { status: response.status, errorCategory: "FORBIDDEN" });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IndriveError(response.status === 429 ? CODES.RATE_LIMITED : CODES.UNAVAILABLE, "inDrive session renewal failed", { status: response.status });
    }
    const body = response.body || {};
    const expiresIn = Number(body.expires_in);
    if (!body.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new IndriveError(CODES.BAD_RESPONSE, "inDrive renewal response is missing a valid access token or expiry");
    }
    const session = await write({
      accessToken: body.access_token,
      refreshToken: body.refresh_token || refreshToken,
      accessExpiresAt: now() + expiresIn * 1000,
      status: "READY",
      source: "postgresql",
      rotationVersion: (Number(previous?.rotationVersion) || 0) + 1,
      lastRotatedAt: now(),
    }, executor);
    scheduleRenewal(session);
    logger.log("[inDrive] session renewed");
    return session.accessToken;
    };

    if (typeof database.withTransaction === "function") {
      return database.withTransaction(async (transaction) => {
        await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PROVIDER_ID}:token-renewal`]);
        return refreshWork(transaction);
      });
    }
    return refreshWork(database);
  }

  async function ensureValidSession({ force = false } = {}) {
    const session = await load();
    if (!force && !session?.accessToken && !configuredRefreshToken(session)) {
      if (!refreshPromise) refreshPromise = refreshSession({ force }).finally(() => { refreshPromise = null; });
      return refreshPromise;
    }
    if (config.mode === "real" && (!config.deviceFingerprint || !config.fingerprint)) {
      throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive fingerprints are not configured");
    }
    if (!force && hasUsableAccess(session)) {
      logger.log("[inDrive] access token valid");
      return session.accessToken;
    }
    if (!refreshPromise) refreshPromise = refreshSession({ force }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function start() {
    if (started) return;
    started = true;
    try {
      const session = await load();
      if (hasUsableAccess(session)) {
        scheduleRenewal(session);
        return;
      }
      await ensureValidSession();
      scheduleRenewal(await load());
    } catch (error) {
      logger.log("[inDrive] automatic renewal unavailable", { code: error?.code || CODES.UNAVAILABLE });
    }
  }

  function stop() {
    started = false;
    if (renewalTimer) clearTimeout(renewalTimer);
    renewalTimer = null;
  }

  async function markAuthRequired() {
    await markStatus("AUTH_REQUIRED");
  }

  async function markAccessDenied() {
    await markStatus("ACCESS_DENIED");
  }

  async function markStatus(status) {
    const session = await load();
    if (!session) return;
    // Do not let a delayed 401/403 from an older request overwrite a newer
    // rotated session. The version predicate makes this a compare-and-set.
    await database.query(
      "UPDATE provider_sessions SET status = $1, updated_at = $2 WHERE provider = $3 AND rotation_version = $4",
      [status, now(), PROVIDER_ID, Number(session.rotationVersion) || 0],
    );
  }

  async function getTokenDiagnostics() {
    const session = await load();
    const expiry = sessionExpiryMillis(session);
    return {
      tokenPresent: Boolean(session?.accessToken),
      refreshTokenPresent: Boolean(session?.refreshToken),
      accessExpiresAt: Number.isFinite(expiry) ? expiry : null,
      expiryKnown: Number.isFinite(expiry),
      source: session?.source || "none",
      rotationVersion: Number(session?.rotationVersion) || 0,
      status: session?.status || "NOT_CONFIGURED",
    };
  }

  async function getStatus() {
    if (!config.enabled) return "DISABLED";
    if (config.mode !== "real") return "READY";
    try {
      const current = await load();
      if (current?.status === "ACCESS_DENIED") return "ACCESS_DENIED";
      await ensureValidSession();
      const session = await load();
      return Number.isFinite(sessionExpiryMillis(session)) ? "READY" : "EXPIRY_UNKNOWN";
    }
    catch (error) {
      if (error.code === CODES.NOT_CONFIGURED) return "NOT_CONFIGURED";
      if (error.code === CODES.AUTH_REQUIRED) return "AUTH_REQUIRED";
      if (error.code === CODES.ACCESS_DENIED) return "ACCESS_DENIED";
      return "TEMPORARILY_UNAVAILABLE";
    }
  }

  return { load, save, refreshSession, ensureValidSession, markAuthRequired, markAccessDenied, getStatus, getTokenDiagnostics, hasUsableAccess, start, stop };
}

module.exports = { createSessionManager };
