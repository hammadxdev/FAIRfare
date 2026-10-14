const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEvidenceSubmission, persistStagingApproval, rollbackStagingApproval } = require("../services/coverageEvidenceIntake.service");

const auth = { authenticated: true, reviewerId: "reviewer-1", role: "coverage_reviewer" };
const now = new Date("2026-10-13T10:00:00+05:00");
function evidence(overrides = {}) { return { key: "PK001|urbancab|BIKE", cityId: "PK001", city: "Lahore", providerInternalId: "urbancab", vehicleType: "BIKE", pickupZone: "Gulberg III", observedAt: "2026-10-13T09:30:00+05:00", screenshotRef: "private://coverage/PK001-urbancab-BIKE/observation-1.png", categorySelectable: true, decision: "APPROVE_CANDIDATE", reviewBy: "2026-11-13T23:59:00+05:00", ...overrides }; }
function repository() { const calls = []; return { calls, async transaction(work) { return work({ appendAudit: async (entry) => { calls.push(["audit", entry]); return { id: "audit-1" }; }, upsertExactCoverage: async (entry) => calls.push(["upsert", entry]), deactivateExactCoverage: async (entry) => calls.push(["deactivate", entry]) }); } }; }

test("valid intake records exact mapping and reviewer identity from auth", () => {
  const result = validateEvidenceSubmission({ authContext: auth, evidence: evidence(), now });
  assert.equal(result.providerInternalId, "urbancab"); assert.equal(result.reviewerId, "reviewer-1"); assert.equal(result.reviewerApproved, false); assert.equal(result.productionEnabled, false);
});
test("unauthorized, missing, expired, and incorrect evidence are rejected", () => {
  assert.throws(() => validateEvidenceSubmission({ authContext: { authenticated: false }, evidence: evidence(), now }), /Authenticated/);
  assert.throws(() => validateEvidenceSubmission({ authContext: auth, evidence: evidence({ screenshotRef: "https://public.example/file.png" }), now }), /secure private/);
  assert.throws(() => validateEvidenceSubmission({ authContext: auth, evidence: evidence({ reviewBy: "2026-10-12T23:59:00+05:00" }), now }), /future/);
  assert.throws(() => validateEvidenceSubmission({ authContext: auth, evidence: evidence({ city: "Karachi" }), now }), /City mapping/);
  assert.throws(() => validateEvidenceSubmission({ authContext: auth, evidence: evidence({ vehicleType: "ECONOMY_CAR" }), now }), /Provider or vehicle/);
});
test("staging persistence and rollback are exact-key, audited, and reversible", async () => {
  const repo = repository();
  const applied = await persistStagingApproval({ authContext: auth, evidence: evidence(), repository: repo, now });
  assert.deepEqual(applied, { applied: true, key: "PK001|urbancab|BIKE", reviewerId: "reviewer-1", productionEnabled: false, auditId: "audit-1", reversible: true });
  const rolledBack = await rollbackStagingApproval({ authContext: auth, key: "PK001|urbancab|BIKE", repository: repo, reason: "verification withdrawn" });
  assert.equal(rolledBack.productionEnabled, false); assert.equal(repo.calls.filter(([type]) => type === "audit").length, 2); await assert.rejects(() => rollbackStagingApproval({ authContext: auth, key: "PK003|quickride|BIKE", repository: repo }), /four exact/);
});
