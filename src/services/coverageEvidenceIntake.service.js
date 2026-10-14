const { BYKEA_STAGING_KEYS } = require("./coverageApproval.service");

const ALLOWED_DECISIONS = Object.freeze(["APPROVE_CANDIDATE", "APP_CHECK_REQUIRED", "MORE_RESEARCH_REQUIRED", "REJECT"]);
const KEY_METADATA = Object.freeze({
  "PK001|urbancab|BIKE": { cityId: "PK001", city: "Lahore", providerInternalId: "urbancab", vehicleType: "BIKE", displayName: "Bykea" },
  "PK001|urbancab|RICKSHAW": { cityId: "PK001", city: "Lahore", providerInternalId: "urbancab", vehicleType: "RICKSHAW", displayName: "Bykea" },
  "PK002|urbancab|BIKE": { cityId: "PK002", city: "Karachi", providerInternalId: "urbancab", vehicleType: "BIKE", displayName: "Bykea" },
  "PK002|urbancab|RICKSHAW": { cityId: "PK002", city: "Karachi", providerInternalId: "urbancab", vehicleType: "RICKSHAW", displayName: "Bykea" },
});

function parseDate(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid ISO timestamp.`);
  return date;
}

function requireReviewer(authContext) {
  if (!authContext?.authenticated) throw new Error("Authenticated reviewer required.");
  if (!authContext.reviewerId || !["coverage_reviewer", "coverage_admin"].includes(authContext.role)) throw new Error("Reviewer is not authorized for coverage changes.");
  return authContext.reviewerId;
}

function validateEvidenceSubmission({ authContext, evidence, now = new Date() } = {}) {
  const reviewerId = requireReviewer(authContext);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("Evidence submission is required.");
  const key = String(evidence.key || "").toLowerCase();
  const metadataKey = Object.keys(KEY_METADATA).find((item) => item.toLowerCase() === key);
  const expected = metadataKey ? KEY_METADATA[metadataKey] : null;
  if (!expected) throw new Error("Evidence intake is limited to the four exact Bykea staging keys.");
  if (evidence.cityId !== expected.cityId || String(evidence.city || "").toLowerCase() !== expected.city.toLowerCase()) throw new Error("City mapping does not match the exact staging key.");
  if (String(evidence.providerInternalId || "").toLowerCase() !== expected.providerInternalId || String(evidence.vehicleType || "").toUpperCase() !== expected.vehicleType) throw new Error("Provider or vehicle mapping does not match the exact staging key.");
  if (!String(evidence.pickupZone || "").trim()) throw new Error("pickupZone is required.");
  const observedAt = parseDate(evidence.observedAt, "observedAt");
  if (!/([+\-]\d{2}:?\d{2}|Z)$/.test(String(evidence.observedAt))) throw new Error("observedAt must include an explicit timezone offset; use Asia/Karachi (+05:00).");
  if (!String(evidence.screenshotRef || "").startsWith("private://coverage/")) throw new Error("screenshotRef must be a secure private coverage reference.");
  if (typeof evidence.categorySelectable !== "boolean") throw new Error("categorySelectable is required.");
  if (!ALLOWED_DECISIONS.includes(evidence.decision)) throw new Error("Unsupported reviewer decision.");
  const reviewBy = parseDate(evidence.reviewBy, "reviewBy");
  if (reviewBy <= now) throw new Error("Evidence reviewBy must be in the future.");
  return Object.freeze({
    evidenceId: String(evidence.evidenceId || `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    key: metadataKey,
    ...expected,
    pickupZone: String(evidence.pickupZone).trim(),
    observedAt: observedAt.toISOString(),
    timezone: "Asia/Karachi",
    screenshotRef: String(evidence.screenshotRef),
    categorySelectable: evidence.categorySelectable,
    reviewerId,
    decision: evidence.decision,
    reviewBy: reviewBy.toISOString(),
    submittedAt: new Date(now).toISOString(),
    reviewerApproved: false,
    productionEnabled: false,
  });
}

async function persistStagingApproval({ authContext, evidence, repository, now = new Date() } = {}) {
  const reviewerId = requireReviewer(authContext);
  const submission = validateEvidenceSubmission({ authContext, evidence, now });
  if (submission.decision !== "APPROVE_CANDIDATE" || submission.categorySelectable !== true) throw new Error("Only explicitly approved, selectable categories can enter staging.");
  if (new Date(submission.reviewBy) <= now) throw new Error("Evidence has expired.");
  if (!repository || typeof repository.transaction !== "function") throw new Error("Authorized staging repository is required.");
  return repository.transaction(async (tx) => {
    const audit = await tx.appendAudit({ action: "STAGING_APPROVAL_REQUESTED", key: submission.key, reviewerId, evidenceId: submission.evidenceId });
    await tx.upsertExactCoverage({ key: submission.key, cityId: submission.cityId, providerInternalId: submission.providerInternalId, vehicleType: submission.vehicleType, reviewerApproved: true, productionEnabled: false, evidenceId: submission.evidenceId, reviewBy: submission.reviewBy });
    return { applied: true, key: submission.key, reviewerId, productionEnabled: false, auditId: audit.id, reversible: true };
  });
}

async function rollbackStagingApproval({ authContext, key, repository, reason } = {}) {
  const reviewerId = requireReviewer(authContext);
  const normalizedKey = String(key || "").toLowerCase();
  if (!BYKEA_STAGING_KEYS.map((item) => item.toLowerCase()).includes(normalizedKey)) throw new Error("Rollback is limited to the four exact Bykea staging keys.");
  if (!repository || typeof repository.transaction !== "function") throw new Error("Authorized staging repository is required.");
  return repository.transaction(async (tx) => {
    const audit = await tx.appendAudit({ action: "STAGING_APPROVAL_ROLLED_BACK", key: normalizedKey, reviewerId, reason: String(reason || "reviewer requested rollback").slice(0, 300) });
    await tx.deactivateExactCoverage({ key: normalizedKey, reviewerApproved: false, productionEnabled: false });
    return { applied: true, key: normalizedKey, reviewerApproved: false, productionEnabled: false, auditId: audit.id };
  });
}

module.exports = { ALLOWED_DECISIONS, KEY_METADATA, requireReviewer, validateEvidenceSubmission, persistStagingApproval, rollbackStagingApproval };
