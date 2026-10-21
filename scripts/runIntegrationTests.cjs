const { spawnSync } = require("node:child_process");
const { requireVerifiedTestDatabase } = require("../src/tests/helpers/testDatabaseGuard");

(async () => {

const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: undefined };
let database;
try { database = await requireVerifiedTestDatabase({ env }); } catch (error) {
  if (["TEST_DATABASE_NOT_CONFIGURED", "TEST_DATABASE_APPROVAL_REQUIRED"].includes(error.code)) {
    console.log(`${error.code}: integration tests skipped`);
    console.log("tests 0"); console.log("pass 0"); console.log("fail 0"); console.log("skipped integration suite"); process.exit(0);
  }
  console.error(error.code || "TEST_DATABASE_PREFLIGHT_FAILED"); process.exit(1);
}
if (!database) {
  console.log("TEST_DATABASE_PREFLIGHT_FAILED: integration tests skipped");
  console.log("tests 0");
  console.log("pass 0");
  console.log("fail 0");
  console.log("skipped integration suite");
  process.exit(0);
}

const files = [
  "src/tests/auth.test.js",
  "src/tests/aiConversations.test.js",
  "src/tests/aiFallback.test.js",
  "src/tests/fareObservation.test.js",
  "src/tests/history.test.js",
  "src/tests/profile.test.js",
  "src/tests/savedRoute.test.js",
  "src/tests/tripAwareAiEndpoint.test.js",
  "src/tests/userPreference.test.js",
];
env.TEST_DATABASE_URL = database.value;
env.FAIRFARE_TEST_DATABASE_PREFLIGHT_VERIFIED = "FAIRFARE_TEST_DATABASE_APPROVED";
const result = spawnSync(process.execPath, ["--test", "--test-isolation=none", ...files], { stdio: "inherit", env });
process.exit(result.status ?? 1);
})();
