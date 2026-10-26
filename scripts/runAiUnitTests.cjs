const { spawnSync } = require("node:child_process");

const files = [
  "src/tests/aiDomainPolicy.test.js",
  "src/tests/aiIntentRouter.test.js",
  "src/tests/aiGroundingPolicy.test.js",
  "src/tests/aiGroundingDecision.test.js",
  "src/tests/aiFareGrounding.test.js",
  "src/tests/aiToolSchemas.test.js",
  "src/tests/aiToolAuthorization.test.js",
  "src/tests/aiToolExecutor.test.js",
  "src/tests/vehicleType.test.js",
  "src/tests/aiTripPlannerAuthorization.test.js",
  "src/tests/serviceIdentityResolver.test.js",
  "src/tests/tripPlanner.test.js",
  "src/tests/fareForecast.test.js",
];
const result = spawnSync(process.execPath, ["--test", "--test-isolation=none", ...files], { stdio: "inherit", env: { ...process.env, NODE_ENV: "test" } });
process.exit(result.status ?? 1);
