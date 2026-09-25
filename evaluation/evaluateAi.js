const fs = require("fs");
const path = require("path");
const { comparisonContext } = require("../src/services/ai/aiRideAssistant.service");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "ai_assistant_cases.json"), "utf8"));
const context = { comparison: comparisonContext(fixture.scenario.comparison), preferences: fixture.scenario.preferences, history: [] };

function readPath(value, pathValue) { return pathValue.split(".").reduce((current, key) => current == null ? undefined : current[key], value); }
let passed = 0; let failed = 0;
for (const testCase of fixture.cases) {
  const failures = testCase.constraints.filter((constraint) => readPath(context, constraint.path) !== constraint.equals);
  if (failures.length === 0) { passed += 1; } else { failed += 1; console.error(`${testCase.id}: ${failures.map((failure) => `${failure.path} expected ${JSON.stringify(failure.equals)}`).join(", ")}`); }
}
const serialized = JSON.stringify(context);
for (const secretName of ["password_hash", "accessToken", "refreshToken", "sessionToken", "AI_API_KEY", "deviceFingerprint", "providerCredentials"]) {
  if (serialized.includes(secretName)) { failed += 1; console.error(`secret boundary: ${secretName}`); }
}
console.log(JSON.stringify({ cases: fixture.cases.length, passed, failed, secretBoundary: failed === 0 ? "PASS" : "FAIL" }));
if (failed) process.exitCode = 1;
