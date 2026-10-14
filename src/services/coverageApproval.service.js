const fs = require("node:fs");
const path = require("node:path");

const VEHICLES = Object.freeze(["BIKE", "RICKSHAW", "ECONOMY_CAR", "STANDARD_CAR", "PREMIUM_CAR"]);
const CLASSIFICATIONS = Object.freeze(["READY_FOR_REVIEW", "APP_CHECK_REQUIRED", "MORE_RESEARCH_REQUIRED", "CONFLICTING_EVIDENCE"]);
const REGISTER_PATH = path.resolve(__dirname, "../../COVERAGE_EVIDENCE_REGISTER.csv");
const BYKEA_STAGING_KEYS = Object.freeze([
  "PK001|urbancab|BIKE",
  "PK001|urbancab|RICKSHAW",
  "PK002|urbancab|BIKE",
  "PK002|urbancab|RICKSHAW",
]);

function csvRows(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
}

function readRegister(registerPath = REGISTER_PATH) {
  return csvRows(fs.readFileSync(registerPath, "utf8"));
}

function classify(row, vehicle) {
  const provider = String(row.provider_internal_id).toLowerCase();
  const city = String(row.city).toLowerCase();
  const listed = row.status === "OFFICIAL_LISTED" && row.evidence_confidence === "HIGH" && row.service_area_scope === "CITY_WIDE";
  // The Pakistan rider page lists cities and classes separately. It does not
  // bind each class to each city, so every city/category pairing needs app
  // confirmation before it can be an approval candidate.
  if (provider === "quickride" && listed && ["BIKE", "RICKSHAW", "ECONOMY_CAR", "STANDARD_CAR"].includes(vehicle)) return "APP_CHECK_REQUIRED";
  if (provider === "urbancab" && ["lahore", "karachi"].includes(city) && row.status === "OFFICIAL_LISTED" && ["BIKE", "RICKSHAW"].includes(vehicle)) return "READY_FOR_REVIEW";
  if (provider === "urbancab" && ["lahore", "karachi", "islamabad"].includes(city) && row.status === "OFFICIAL_LISTED") return "APP_CHECK_REQUIRED";
  if (provider === "urbancab" && city === "rawalpindi" && row.status === "REVIEW_REQUIRED") return "APP_CHECK_REQUIRED";
  if (provider === "indrive" && ["lahore", "karachi", "islamabad"].includes(city) && row.status === "REVIEW_REQUIRED") return "APP_CHECK_REQUIRED";
  return "MORE_RESEARCH_REQUIRED";
}

function mappingFor(row, vehicle, classification) {
  const provider = String(row.provider_internal_id).toLowerCase();
  if (classification === "READY_FOR_REVIEW") return { providerVehicle: vehicle === "ECONOMY_CAR" ? "Economy" : vehicle === "BIKE" ? (provider === "urbancab" ? "Motorbike" : "Bike") : vehicle === "RICKSHAW" ? "Rickshaw" : null, unambiguous: true };
  if (provider === "quickride" && vehicle === "STANDARD_CAR") return { providerVehicle: "Comfort", unambiguous: false };
  if (provider === "urbancab" && vehicle === "STANDARD_CAR") return { providerVehicle: "Car", unambiguous: false };
  return { providerVehicle: null, unambiguous: false };
}

function buildApprovalMatrix({ registerPath = REGISTER_PATH } = {}) {
  return readRegister(registerPath).flatMap((row) => VEHICLES.map((vehicleType) => {
    const classification = classify(row, vehicleType);
    const mapping = mappingFor(row, vehicleType, classification);
    const unresolvedQuestions = [];
    if (classification === "APP_CHECK_REQUIRED") unresolvedQuestions.push("Confirm this exact provider category is selectable for the exact city pickup in the app.");
    if (classification === "MORE_RESEARCH_REQUIRED") unresolvedQuestions.push("Locate current official city-specific service evidence and confirm the city boundary.");
    if (row.service_area_scope !== "CITY_WIDE") unresolvedQuestions.push("Confirm whether the evidence covers the canonical city or only a zone/airport feature.");
    return Object.freeze({
      key: `${row.city_id}|${row.provider_internal_id}|${vehicleType}`,
      cityId: row.city_id,
      city: row.city,
      providerInternalId: row.provider_internal_id,
      providerDisplayName: row.provider_display_name,
      vehicleType,
      classification,
      evidenceConfidence: row.evidence_confidence,
      evidenceType: row.evidence_type,
      serviceAreaScope: row.service_area_scope,
      sourceUrl: row.source_url,
      evidenceStatus: row.status,
      providerVehicle: mapping.providerVehicle,
      mappingUnambiguous: mapping.unambiguous,
      unresolvedQuestions,
      reviewerApproved: false,
      productionEnabled: false,
    });
  }));
}

function candidateFor(input, matrix = buildApprovalMatrix()) {
  if (!input || Array.isArray(input)) throw new Error("Approval requires one exact city-provider-vehicle combination.");
  const key = input.key || `${input.cityId}|${input.providerInternalId}|${input.vehicleType}`;
  const candidate = matrix.find((item) => item.key.toLowerCase() === String(key).toLowerCase());
  if (!candidate) throw new Error("Unknown city-provider-vehicle combination.");
  return candidate;
}

function validateApprovalRequest(request, matrix = buildApprovalMatrix()) {
  const candidate = candidateFor(request, matrix);
  const errors = [];
  if (!request.reviewerId || typeof request.reviewerId !== "string") errors.push("reviewerId is required");
  if (request.approve !== true) errors.push("approve must be explicitly true");
  if (candidate.classification === "CONFLICTING_EVIDENCE") errors.push("conflicting evidence must be resolved before approval");
  if (!candidate.sourceUrl || !/^https:\/\//i.test(candidate.sourceUrl)) errors.push("official evidence URL is required");
  if (candidate.classification !== "READY_FOR_REVIEW" || !candidate.mappingUnambiguous) errors.push("vehicle mapping is not unambiguous; complete app verification first");
  if (request.productionEnabled === true && request.mappingAccepted !== true) errors.push("mappingAccepted must be explicitly true before production enablement");
  return { valid: errors.length === 0, errors, candidate };
}

function createApprovalPatch(request, matrix = buildApprovalMatrix()) {
  const validation = validateApprovalRequest(request, matrix);
  if (!validation.valid) {
    const error = new Error(validation.errors.join("; "));
    error.code = "COVERAGE_APPROVAL_REJECTED";
    error.errors = validation.errors;
    throw error;
  }
  return {
    key: validation.candidate.key,
    cityId: validation.candidate.cityId,
    city: validation.candidate.city,
    providerInternalId: validation.candidate.providerInternalId,
    vehicleType: validation.candidate.vehicleType,
    reviewerApproved: true,
    productionEnabled: request.productionEnabled === true,
    reviewerId: request.reviewerId,
    approvedAt: request.approvedAt || new Date().toISOString(),
    evidenceUrl: validation.candidate.sourceUrl,
  };
}

function summarize(matrix = buildApprovalMatrix()) {
  return Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, matrix.filter((item) => item.classification === classification).length]));
}

function recommendationAllowed(coverage) {
  return !coverage || coverage.status === "APPROVED_CONFIGURATION" || (coverage.supported === true && coverage.productionEnabled === true && coverage.verified === true);
}

function createStagingApprovalPlan(requests, matrix = buildApprovalMatrix()) {
  if (!Array.isArray(requests) || requests.length === 0) throw new Error("Staging approval requires explicit requests for exact keys.");
  const keys = requests.map((request) => String(request?.key || "").toLowerCase());
  if (new Set(keys).size !== requests.length) throw new Error("Duplicate exact approval keys are not allowed.");
  if (requests.some((request) => !BYKEA_STAGING_KEYS.map((key) => key.toLowerCase()).includes(String(request?.key || "").toLowerCase()))) throw new Error("Staging plan is limited to the four Bykea Lahore/Karachi Bike/Rickshaw keys.");
  if (requests.length !== BYKEA_STAGING_KEYS.length || !BYKEA_STAGING_KEYS.every((key) => keys.includes(key.toLowerCase()))) throw new Error("Staging plan must explicitly include each of the four Bykea keys.");
  return Object.freeze({
    planType: "BYKEA_EXACT_KEY_STAGING_DRY_RUN",
    applied: false,
    actualDatasetMutation: false,
    approvals: requests.map((request) => createApprovalPatch(request, matrix)),
    rollback: { available: true, applied: false, instruction: "Discard this in-memory plan; no register or environment mutation occurred." },
  });
}

module.exports = { VEHICLES, CLASSIFICATIONS, BYKEA_STAGING_KEYS, readRegister, buildApprovalMatrix, candidateFor, validateApprovalRequest, createApprovalPatch, createStagingApprovalPlan, summarize, recommendationAllowed };
