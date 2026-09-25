const DEFAULT_THRESHOLD_PERCENT = 10;

function configuredThreshold() {
  const value = Number(process.env.FAIRFARE_RECOMMENDATION_THRESHOLD_PERCENT);
  return Number.isFinite(value) && value > 0 && value < 100 ? value : DEFAULT_THRESHOLD_PERCENT;
}

function insufficientData(reason = "Not enough prediction data for a fare recommendation.", prediction = null) {
  return {
    status: "INSUFFICIENT_DATA",
    currentFare: null,
    expectedFare: null,
    difference: null,
    percentageDifference: null,
    reason,
    modelDataSource: prediction?.dataSource || null,
    confidence: prediction?.confidence ?? null,
  };
}

function recommendRide({ currentFare, prediction }) {
  if (typeof currentFare !== "number" || !Number.isFinite(currentFare) || currentFare < 0) {
    return insufficientData("Current fare is unavailable for a fare recommendation.", prediction);
  }
  if (!prediction || prediction.status !== "AVAILABLE" || typeof prediction.predictedFare !== "number" || !Number.isFinite(prediction.predictedFare) || prediction.predictedFare <= 0) {
    return insufficientData(undefined, prediction);
  }

  const expectedFare = prediction.predictedFare;
  const difference = currentFare - expectedFare;
  const percentageDifference = Number(((difference / expectedFare) * 100).toFixed(2));
  const threshold = configuredThreshold();
  let status = "NEUTRAL";
  let reason = "Current fare is close to the model's expected fare for similar conditions.";
  if (percentageDifference <= -threshold) {
    status = "BOOK_NOW";
    reason = `Current fare is about ${Math.abs(percentageDifference)}% below the model's expected fare for similar conditions.`;
  } else if (percentageDifference >= threshold) {
    status = "WAIT";
    reason = `Current fare is about ${Math.abs(percentageDifference)}% above the model's expected fare for similar conditions.`;
  }

  return {
    status,
    currentFare,
    expectedFare,
    difference,
    percentageDifference,
    reason,
    modelDataSource: prediction.dataSource || null,
    confidence: prediction.confidence ?? null,
  };
}

module.exports = { DEFAULT_THRESHOLD_PERCENT, configuredThreshold, recommendRide, insufficientData };
