const test = require("node:test");
const assert = require("node:assert/strict");
const { APPROVAL, isolatedTestDatabase, verifyServerIdentity } = require("./helpers/testDatabaseGuard");
const base = { NODE_ENV: "test", FAIRFARE_TEST_DATABASE_APPROVED: APPROVAL, FAIRFARE_TEST_DATABASE_MARKER: APPROVAL, FAIRFARE_TEST_DATABASE_HOST: "127.0.0.1", FAIRFARE_TEST_DATABASE_NAME: "fairfare_test", FAIRFARE_TEST_DATABASE_ROLE: "fairfare_test_role", TEST_DATABASE_URL: "postgresql://fairfare_test_role:secret@127.0.0.1/fairfare_test" };
test("requires explicit approval and exact local identity", () => {
  assert.equal(isolatedTestDatabase({ NODE_ENV: "test" }).code, "TEST_DATABASE_NOT_CONFIGURED");
  assert.equal(isolatedTestDatabase({ ...base, FAIRFARE_TEST_DATABASE_APPROVED: "no" }).code, "TEST_DATABASE_APPROVAL_REQUIRED");
  assert.equal(isolatedTestDatabase({ ...base, FAIRFARE_TEST_DATABASE_HOST: "other" }).code, "TEST_DATABASE_HOST_MISMATCH");
  assert.equal(isolatedTestDatabase({ ...base, FAIRFARE_TEST_DATABASE_NAME: "other" }).code, "TEST_DATABASE_NAME_MISMATCH");
  assert.equal(isolatedTestDatabase({ ...base, FAIRFARE_TEST_DATABASE_ROLE: "other" }).code, "TEST_DATABASE_ROLE_MISMATCH");
});
test("rejects application URL reuse and non-test environment", () => {
  assert.equal(isolatedTestDatabase({ ...base, DATABASE_URL: base.TEST_DATABASE_URL }).code, "TEST_DATABASE_MUST_NOT_EQUAL_DATABASE_URL");
  assert.equal(isolatedTestDatabase({ ...base, NODE_ENV: "production" }).code, "TEST_DATABASE_ENVIRONMENT_REQUIRED");
});
test("rejects client-controlled target or session overrides", () => {
  assert.equal(isolatedTestDatabase({ ...base, TEST_DATABASE_URL: `${base.TEST_DATABASE_URL}?options=-c%20fairfare.test_identity=FAIRFARE_TEST_DATABASE_APPROVED` }).code, "TEST_DATABASE_CLIENT_TARGET_OVERRIDE_FORBIDDEN");
});
test("requires the independently provisioned server marker", async () => {
  const query = async () => ({ rows: [{ database_name: "fairfare_test", role_name: "fairfare_test_role", test_identity: null }] });
  await assert.rejects(() => verifyServerIdentity({ connectionString: base.TEST_DATABASE_URL, expected: { database: "fairfare_test", role: "fairfare_test_role", marker: APPROVAL }, query }), { code: "TEST_DATABASE_SERVER_IDENTITY_MISMATCH" });
});
test("accepts only the exact mocked isolated server identity", async () => {
  const query = async () => ({ rows: [{ database_name: "fairfare_test", role_name: "fairfare_test_role", test_identity: APPROVAL }] });
  const result = await verifyServerIdentity({ connectionString: base.TEST_DATABASE_URL, expected: { database: "fairfare_test", role: "fairfare_test_role", marker: APPROVAL }, query });
  assert.equal(result.verified, true);
});
test("preflight query contains no write operation", async () => {
  let statement = "";
  const query = async (text) => { statement = text; return { rows: [{ database_name: "fairfare_test", role_name: "fairfare_test_role", test_identity: APPROVAL }] }; };
  await verifyServerIdentity({ connectionString: base.TEST_DATABASE_URL, expected: { database: "fairfare_test", role: "fairfare_test_role", marker: APPROVAL }, query });
  assert.match(statement, /^SELECT current_database\(\)/);
  assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE/i);
});
