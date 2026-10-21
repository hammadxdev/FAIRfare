const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("PostgreSQL baseline documentation rejects SQLite schema as bootstrap", () => {
  const sqliteSchema = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  const documentation = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "TEST_DATABASE_BASELINE.md"), "utf8");
  assert.match(sqliteSchema, /AUTOINCREMENT/);
  assert.match(documentation, /SQLite-specific/);
  assert.match(documentation, /001.*016|001` through `016/);
  assert.match(documentation, /does not contain[\s\S]*complete[\s\S]*PostgreSQL bootstrap/i);
});
