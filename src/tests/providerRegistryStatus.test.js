const assert = require("node:assert/strict");
const test = require("node:test");
const { getAllAdapters, statusEntries } = require("../providers/provider.registry");

test("provider status keeps legacy IDs and exposes canonical Yango separately", () => {
  assert.deepEqual(getAllAdapters().map((adapter) => adapter.id || adapter.name), ["indrive", "quickride", "urbancab"]);
  assert.deepEqual(statusEntries().map((entry) => entry.id), ["indrive", "quickride", "yango", "urbancab"]);
  assert.equal(statusEntries().find((entry) => entry.id === "quickride").adapter.displayName, "Yango");
  assert.equal(statusEntries().find((entry) => entry.id === "yango").adapter.displayName, "Yango");
});
