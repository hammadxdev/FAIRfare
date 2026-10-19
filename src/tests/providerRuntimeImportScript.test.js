const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("runtime configuration import loads environment before PostgreSQL", () => {
  const script = fs.readFileSync(path.join(__dirname, "../../scripts/migrateProviderRuntimeConfig.cjs"), "utf8");
  const envImport = script.indexOf('require("../src/config/env")');
  const postgresImport = script.indexOf('require("../src/config/postgres")');
  assert.ok(envImport >= 0);
  assert.ok(postgresImport > envImport);
});
