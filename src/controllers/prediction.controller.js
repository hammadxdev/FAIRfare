const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { predictFare } = require("../services/farePrediction.service");

const predictFareHandler = asyncHandler(async (req, res) => {
  const prediction = await predictFare(req.body || {});
  const statusCode = prediction.status === "AVAILABLE" || prediction.status === "MODEL_NOT_TRAINED" ? 200 : 422;
  return success(res, { message: "Fare prediction completed", data: prediction, statusCode });
});

module.exports = { predictFareHandler };
