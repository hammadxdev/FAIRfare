const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { validateCompareFareRequest } = require("../utils/validators");
const { compareFares } = require("../services/fare.service");
const crypto = require("crypto");

const compareFaresHandler = asyncHandler(async (req, res) => {
  const requestId = req.headers["x-request-id"] ? String(req.headers["x-request-id"]).slice(0, 100) : crypto.randomUUID();
  const startedAt = Date.now();
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.info("[fare][http] received", { requestId });
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

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.info("[fare][http] completed", { requestId, elapsedMs: Date.now() - startedAt, providerResults: Array.isArray(result.results) ? result.results.length : 0 });
  res.setHeader("x-fairfare-request-id", requestId);
  return success(res, { message: "Fare comparison completed successfully", data: result });
});

module.exports = { compareFaresHandler };
