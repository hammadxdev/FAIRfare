const { spawnSync } = require("node:child_process");
const path = require("node:path");
const files = process.argv.slice(2);
const selected = files.length ? files : [
  "src/tests/nativeAiAgent.test.js",
  "src/tests/nativeAiEndpoint.test.js",
  "src/tests/aiGroqProvider.test.js",
  "src/tests/aiToolSchemas.test.js",
  "src/tests/aiToolExecutor.test.js",
  "src/tests/aiToolAuthorization.test.js",
  "src/tests/aiGeocodingAndUsage.test.js",
  "src/tests/nearbyObservationAiTool.test.js",
];
// One process per file prevents module hooks/env fixtures leaking between suites.
let failed = false;
for (const file of selected) {
  if (!/^src\/tests\/[A-Za-z0-9]+\.test\.js$/.test(file)) throw new Error("Only backend test files are allowed");
  const result = spawnSync(process.execPath, ["--require", path.resolve(__dirname, "../src/tests/helpers/aiIsolation.cjs"), "--test", "--test-isolation=none", file], { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
