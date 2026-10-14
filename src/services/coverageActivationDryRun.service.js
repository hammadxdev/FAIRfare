const { getDatasetMode, baselineFor, estimateDatasetFare } = require("./fairFareDataset.service");
const { BYKEA_STAGING_KEYS, buildApprovalMatrix, createStagingApprovalPlan } = require("./coverageApproval.service");

function dryRunBykeaActivation({ requests, distanceKm = 8, durationMin = 24, hourOfDay = 12, dayOfWeek = 2, weather = { condition: "CLEAR", source: "OPEN_METEO" } } = {}) {
  const plan = createStagingApprovalPlan(requests, buildApprovalMatrix());
  const results = plan.approvals.map((approval) => {
    const vehicleType = approval.vehicleType === "BIKE" ? "bike" : "rickshaw";
    const baseline = baselineFor(vehicleType);
    const estimate = estimateDatasetFare({ vehicleType, distanceKm, durationMin, hourOfDay, dayOfWeek, weather });
    return {
      key: approval.key,
      cityId: approval.cityId,
      city: approval.city,
      provider: { internalId: approval.providerInternalId, displayName: "Bykea" },
      vehicleType: approval.vehicleType,
      hypotheticalCoverageStatus: "APPROVED_CONFIGURATION",
      baseline,
      estimate,
      quoteType: "FAIR_FARE_SYNTHETIC_MODEL_ESTIMATE",
      liveProviderQuote: false,
    };
  });
  return {
    plan,
    requestedKeys: [...BYKEA_STAGING_KEYS],
    actualDatasetMode: getDatasetMode(),
    hypotheticalDatasetMode: "verified",
    applied: false,
    results,
    provenance: "Fair Fare synthetic dataset; not a live Bykea quotation",
  };
}

module.exports = { dryRunBykeaActivation };
