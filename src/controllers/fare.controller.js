const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { validateCompareFareRequest } = require("../utils/validators");
const { compareFares } = require("../services/fare.service");

const compareFaresHandler = asyncHandler(async (req, res) => {
  const errors = validateCompareFareRequest(req.body);
  if (errors.length > 0) {
    throw new AppError("Validation failed", 400, errors);
  }

  const { pickup, dropoff, vehicleType, route } = req.body;

  const result = await compareFares({
    userId: req.user.id,
    pickup: { name: pickup.name, lat: pickup.lat, lng: pickup.lng },
    dropoff: { name: dropoff.name, lat: dropoff.lat, lng: dropoff.lng },
    vehicleType,
    route,
  });

  return success(res, { message: "Fare comparison completed successfully", data: result });
});

module.exports = { compareFaresHandler };
