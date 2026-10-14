const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildApprovalMatrix,
  createApprovalPatch,
  validateApprovalRequest,
  summarize,
  recommendationAllowed,
} = require("../services/coverageApproval.service");
const { getDatasetMode } = require("../services/fairFareDataset.service");

test("approval matrix is exact, separate, and preserves provider IDs", () => {
  const matrix = buildApprovalMatrix();
  assert.equal(matrix.length, 315);
  assert.equal(new Set(matrix.map((row) => row.key)).size, 315);
  assert.deepEqual(summarize(matrix), {
    READY_FOR_REVIEW: 4,
    APP_CHECK_REQUIRED: 55,
    MORE_RESEARCH_REQUIRED: 256,
    CONFLICTING_EVIDENCE: 0,
  });
  assert.deepEqual([...new Set(matrix.map((row) => row.providerInternalId))].sort(), ["indrive", "quickride", "urbancab"]);
});

test("approval requires explicit action for one ready exact combination", () => {
  const matrix = buildApprovalMatrix();
  const patch = createApprovalPatch({ key: "PK001|urbancab|BIKE", reviewerId: "reviewer-1", approve: true, mappingAccepted: true }, matrix);
  assert.deepEqual(patch, {
    key: "PK001|urbancab|BIKE",
    cityId: "PK001",
    city: "Lahore",
    providerInternalId: "urbancab",
    vehicleType: "BIKE",
    reviewerApproved: true,
    productionEnabled: false,
    reviewerId: "reviewer-1",
    approvedAt: patch.approvedAt,
    evidenceUrl: "https://www.bykea.com/pk/",
  });
});

test("national Yango class listings and unclear Islamabad Bykea evidence are downgraded", () => {
  const matrix = buildApprovalMatrix();
  for (const key of [
    "PK001|quickride|BIKE",
    "PK004|quickride|ECONOMY_CAR",
    "PK006|quickride|RICKSHAW",
    "PK003|urbancab|BIKE",
  ]) {
    assert.equal(matrix.find((row) => row.key === key).classification, "APP_CHECK_REQUIRED");
  }
});

test("ambiguous mappings and missing evidence cannot be activated", () => {
  const matrix = buildApprovalMatrix();
  for (const request of [
    { key: "PK001|quickride|STANDARD_CAR", reviewerId: "r", approve: true, mappingAccepted: true, productionEnabled: true },
    { key: "PK007|quickride|BIKE", reviewerId: "r", approve: true, mappingAccepted: true, productionEnabled: true },
  ]) {
    const result = validateApprovalRequest(request, matrix);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /vehicle mapping|official evidence/);
  }
});

test("mass approval and implicit approval are rejected", () => {
  const matrix = buildApprovalMatrix();
  assert.throws(() => createApprovalPatch([{ key: "PK001|quickride|BIKE" }, { key: "PK002|quickride|BIKE" }], matrix), /one exact/);
  assert.throws(() => createApprovalPatch({ key: "PK001|quickride|BIKE", reviewerId: "r" }, matrix), /approve must be explicitly true/);
});

test("AI recommendation guard rejects unverified or ambiguous coverage", () => {
  assert.equal(recommendationAllowed({ status: "PROVIDER_CITY_UNVERIFIED", supported: false }), false);
  assert.equal(recommendationAllowed({ status: "VEHICLE_COVERAGE_UNVERIFIED", supported: false }), false);
  assert.equal(recommendationAllowed({ status: "APPROVED_CONFIGURATION", supported: true }), true);
});

test("legacy dataset mode remains the default and is not changed by the approval matrix", () => {
  const previous = process.env.FAIR_FARE_DATASET_MODE;
  delete process.env.FAIR_FARE_DATASET_MODE;
  assert.equal(getDatasetMode(), "legacy");
  if (previous === undefined) delete process.env.FAIR_FARE_DATASET_MODE;
  else process.env.FAIR_FARE_DATASET_MODE = previous;
});

test("READY_FOR_REVIEW is only a queue state and never changes activation flags", () => {
  const matrix = buildApprovalMatrix();
  const ready = matrix.filter((row) => row.classification === "READY_FOR_REVIEW");
  assert.equal(ready.length, 4);
  assert.ok(ready.every((row) => row.reviewerApproved === false && row.productionEnabled === false));
  assert.throws(() => createApprovalPatch({ key: ready[0].key, reviewerId: "reviewer-1" }, matrix), /approve must be explicitly true/);
});
