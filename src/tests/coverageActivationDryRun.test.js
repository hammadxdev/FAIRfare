const test = require("node:test");
const assert = require("node:assert/strict");
const { dryRunBykeaActivation } = require("../services/coverageActivationDryRun.service");
const { BYKEA_STAGING_KEYS, createStagingApprovalPlan, buildApprovalMatrix, recommendationAllowed } = require("../services/coverageApproval.service");
const { getDatasetMode } = require("../services/fairFareDataset.service");

function requests() {
  return BYKEA_STAGING_KEYS.map((key) => ({ key, reviewerId: "staging-reviewer", approve: true, mappingAccepted: true, productionEnabled: false }));
}

test("staging plan requires all four explicit exact Bykea keys and does not mutate state", () => {
  const plan = createStagingApprovalPlan(requests(), buildApprovalMatrix());
  assert.equal(plan.applied, false);
  assert.equal(plan.actualDatasetMutation, false);
  assert.deepEqual(plan.approvals.map((item) => item.key).sort(), [...BYKEA_STAGING_KEYS].sort());
  assert.ok(plan.approvals.every((item) => item.providerInternalId === "urbancab" && item.reviewerApproved === true && item.productionEnabled === false));
});

test("staging plan rejects other cities, categories, Yango, and inDrive", () => {
  for (const key of ["PK003|urbancab|BIKE", "PK001|urbancab|ECONOMY_CAR", "PK001|quickride|BIKE", "PK001|indrive|BIKE"]) {
    const altered = requests().map((request, index) => index === 0 ? { ...request, key } : request);
    assert.throws(() => createStagingApprovalPlan(altered, buildApprovalMatrix()), /limited to the four Bykea|Duplicate|include each/);
  }
});

test("dry run models Lahore and Karachi Bykea fares with valid synthetic Bike/Rickshaw parameters", () => {
  const dryRun = dryRunBykeaActivation({ requests: requests() });
  assert.equal(dryRun.actualDatasetMode, "legacy");
  assert.equal(dryRun.hypotheticalDatasetMode, "verified");
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.results.length, 4);
  assert.ok(dryRun.results.every((result) => result.provider.internalId === "urbancab" && result.provider.displayName === "Bykea"));
  assert.ok(dryRun.results.every((result) => result.baseline && result.estimate && result.quoteType === "FAIR_FARE_SYNTHETIC_MODEL_ESTIMATE" && result.liveProviderQuote === false));
  assert.equal(dryRun.results.find((result) => result.vehicleType === "BIKE").estimate.fare, 239);
  assert.equal(dryRun.results.find((result) => result.vehicleType === "RICKSHAW").estimate.fare, 341);
});

test("legacy and preview modes remain unchanged and AI can use only authoritative staged results", () => {
  const previous = process.env.FAIR_FARE_DATASET_MODE;
  delete process.env.FAIR_FARE_DATASET_MODE;
  assert.equal(getDatasetMode(), "legacy");
  process.env.FAIR_FARE_DATASET_MODE = "preview";
  assert.equal(getDatasetMode(), "preview");
  assert.equal(recommendationAllowed({ status: "APPROVED_CONFIGURATION", supported: true }), true);
  assert.equal(recommendationAllowed({ status: "PROVIDER_CITY_UNVERIFIED", supported: false }), false);
  if (previous === undefined) delete process.env.FAIR_FARE_DATASET_MODE; else process.env.FAIR_FARE_DATASET_MODE = previous;
});
