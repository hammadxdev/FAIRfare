const readline = require("node:readline");
const { withTransaction } = require("../src/config/postgres");

const PROVIDER = "indrive";

function decodeJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch (_) {
    return null;
  }
}

function validateTokenPair(accessToken, refreshToken) {
  if (typeof accessToken !== "string" || accessToken.trim().length < 20 || accessToken.length > 20000) throw new Error("invalid access token format");
  if (typeof refreshToken !== "string" || refreshToken.trim().length < 20 || refreshToken.length > 20000) throw new Error("invalid refresh token format");
  const accessClaims = decodeJwt(accessToken);
  const refreshClaims = decodeJwt(refreshToken);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessExp = Number(accessClaims?.exp);
  const refreshExp = Number(refreshClaims?.exp);
  if (!Number.isFinite(accessExp) || accessExp <= nowSeconds) throw new Error("access token must contain a future exp claim");
  if (!Number.isFinite(refreshExp) || refreshExp <= nowSeconds) throw new Error("refresh token must contain a future exp claim");
  return { accessExpiresAt: accessExp * 1000 };
}

function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return readPipedSecret();
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let value = "";
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") { cleanup(); reject(new Error("cancelled")); return; }
        if (char === "\r" || char === "\n") { cleanup(); process.stdout.write("\n"); resolve(value); return; }
        if (char === "\b" || char === "\u007f") { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    function cleanup() { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function readPipedSecret() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

async function readPair() {
  if (!process.stdin.isTTY) {
    const input = await readPipedSecret();
    let parsed;
    try { parsed = JSON.parse(input); } catch (_) { throw new Error("stdin must contain JSON with access_token and refresh_token"); }
    return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token };
  }
  return { accessToken: await readSecret("Access token: "), refreshToken: await readSecret("Refresh token: ") };
}

async function replaceSession() {
  const { accessToken, refreshToken } = await readPair();
  const { accessExpiresAt } = validateTokenPair(accessToken, refreshToken);
  const rotatedAt = Date.now();
  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PROVIDER}:token-renewal`]);
    const existing = (await client.query("SELECT rotation_version FROM provider_sessions WHERE provider = $1 FOR UPDATE", [PROVIDER])).rows[0];
    const rotationVersion = (Number(existing?.rotation_version) || 0) + 1;
    await client.query(`
      INSERT INTO provider_sessions (provider, access_token, refresh_token, access_expires_at, status, rotation_version, last_rotated_at, updated_at)
      VALUES ($1,$2,$3,$4,'READY',$5,$6,$6)
      ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,
        refresh_token=excluded.refresh_token, access_expires_at=excluded.access_expires_at,
        status=excluded.status, rotation_version=excluded.rotation_version,
        last_rotated_at=excluded.last_rotated_at, updated_at=excluded.updated_at
    `, [PROVIDER, accessToken.trim(), refreshToken.trim(), accessExpiresAt, rotationVersion, rotatedAt]);
    return { rotationVersion, accessExpiresAt };
  });
  process.stdout.write(`${JSON.stringify({ stored: true, provider: PROVIDER, ...result })}\n`);
}

if (require.main === module) {
  if (process.argv[2] !== "replace") {
    process.stderr.write("Usage: node scripts/indriveSession.cjs replace\n");
    process.exitCode = 2;
  } else {
    replaceSession().catch(() => {
      process.stderr.write("Credential storage failed; no credential details were recorded.\n");
      process.exitCode = 1;
    });
  }
}

module.exports = { decodeJwt, validateTokenPair, replaceSession };
