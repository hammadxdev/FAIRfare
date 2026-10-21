const { URL } = require("node:url");
const APPROVAL = "FAIRFARE_TEST_DATABASE_APPROVED";
const MARKER_SETTING = "fairfare.test_identity";

function isolatedTestDatabase(env = process.env) {
  const raw = env.TEST_DATABASE_URL;
  if (!raw) return { configured: false, code: "TEST_DATABASE_NOT_CONFIGURED" };
  if (env.DATABASE_URL && raw === env.DATABASE_URL) return { configured: false, code: "TEST_DATABASE_MUST_NOT_EQUAL_DATABASE_URL" };
  if (env.FAIRFARE_TEST_DATABASE_APPROVED !== APPROVAL) return { configured: false, code: "TEST_DATABASE_APPROVAL_REQUIRED" };
  if (env.NODE_ENV !== "test") return { configured: false, code: "TEST_DATABASE_ENVIRONMENT_REQUIRED" };
  let parsed;
  try { parsed = new URL(raw); } catch { return { configured: false, code: "TEST_DATABASE_INVALID_URL" }; }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) return { configured: false, code: "TEST_DATABASE_MUST_BE_POSTGRES" };
  if (["options", "host", "port", "user", "dbname", "service"].some((key) => parsed.searchParams.has(key))) return { configured: false, code: "TEST_DATABASE_CLIENT_TARGET_OVERRIDE_FORBIDDEN" };
  const expectedHost = env.FAIRFARE_TEST_DATABASE_HOST;
  const expectedName = env.FAIRFARE_TEST_DATABASE_NAME;
  const expectedRole = env.FAIRFARE_TEST_DATABASE_ROLE;
  if (!expectedHost || !expectedName || !expectedRole) return { configured: false, code: "TEST_DATABASE_EXPECTED_IDENTITY_REQUIRED" };
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (parsed.hostname !== expectedHost) return { configured: false, code: "TEST_DATABASE_HOST_MISMATCH" };
  if (database !== expectedName) return { configured: false, code: "TEST_DATABASE_NAME_MISMATCH" };
  if (decodeURIComponent(parsed.username) !== expectedRole) return { configured: false, code: "TEST_DATABASE_ROLE_MISMATCH" };
  if (env.FAIRFARE_TEST_DATABASE_MARKER !== APPROVAL) return { configured: false, code: "TEST_DATABASE_MARKER_EXPECTATION_REQUIRED" };
  return { configured: true, value: raw, host: expectedHost, database: expectedName, role: expectedRole, marker: env.FAIRFARE_TEST_DATABASE_MARKER };
}

async function verifyServerIdentity({ connectionString, expected, query } = {}) {
  if (!connectionString || !expected?.database || !expected?.role || !expected?.marker) { const error = new Error("TEST_DATABASE_EXPECTED_IDENTITY_REQUIRED"); error.code = "TEST_DATABASE_EXPECTED_IDENTITY_REQUIRED"; throw error; }
  if (typeof query !== "function") {
    const { Client } = require("pg"); const client = new Client({ connectionString, statement_timeout: 3000, connectionTimeoutMillis: 3000 });
    try { await client.connect(); query = (text, params) => client.query(text, params); const result = await query("SELECT current_database() AS database_name, current_user AS role_name, current_setting($1, true) AS test_identity", [MARKER_SETTING]); return assertIdentity(result.rows?.[0], expected); }
    finally { await client.end().catch(() => undefined); }
  }
  const result = await query("SELECT current_database() AS database_name, current_user AS role_name, current_setting($1, true) AS test_identity", [MARKER_SETTING]);
  return assertIdentity(result.rows?.[0], expected);
}

function assertIdentity(row, expected) {
  if (!row || row.database_name !== expected.database || row.role_name !== expected.role || row.test_identity !== expected.marker) { const error = new Error("TEST_DATABASE_SERVER_IDENTITY_MISMATCH"); error.code = "TEST_DATABASE_SERVER_IDENTITY_MISMATCH"; throw error; }
  return { verified: true, database: expected.database, role: expected.role, marker: expected.marker };
}

async function requireVerifiedTestDatabase({ env = process.env, query } = {}) {
  const result = isolatedTestDatabase(env);
  if (!result.configured) {
    const error = new Error(result.code);
    error.code = result.code;
    throw error;
  }
  await verifyServerIdentity({ connectionString: result.value, expected: result, query });
  return result;
}

module.exports = { APPROVAL, MARKER_SETTING, isolatedTestDatabase, verifyServerIdentity, requireVerifiedTestDatabase };
