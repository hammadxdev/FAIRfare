const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { validate } = require("../../scripts/validateFareDataset");

test("synthetic training dataset is present, typed, unique, and has at least 500 rows", () => {
  const report = validate(path.join(__dirname, "../../ml/datasets/fare_training_synthetic.csv"));
  assert.equal(report.rows, 600);
  assert.equal(report.uniqueIds, 600);
  assert.equal(report.errors.length, 0);
});
