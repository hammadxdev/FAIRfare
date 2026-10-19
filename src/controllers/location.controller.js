const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { getAdapter } = require("../providers/provider.registry");

const indriveAutocompleteHandler = asyncHandler(async (req, res) => {
  const { text, cid, cityId, orderTypeId, latitude, longitude, routePointType } = req.body || {};
  if (typeof text !== "string" || !text.trim() || text.length > 120) throw new AppError("Validation failed", 400, ["text is required"]);
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) throw new AppError("Validation failed", 400, ["latitude and longitude are required"]);
  const adapter = getAdapter("indrive");
  try {
    const data = await adapter.getAutocomplete({ text, cityId: cityId ?? cid, orderTypeId, latitude, longitude, routePointType });
    return success(res, { message: "inDrive autocomplete completed successfully", data });
  } catch (error) {
    const status = error.code === "PROVIDER_AUTH_REQUIRED" ? "auth_required" : error.code === "PROVIDER_TIMEOUT" ? "timeout" : "unavailable";
    return success(res, {
      message: "inDrive autocomplete is currently unavailable",
      data: { provider: "indrive", status, source: "none", suggestions: [], error: { code: error.code || "PROVIDER_UNAVAILABLE", message: "Live provider data is currently unavailable." } },
    });
  }
});

module.exports = { indriveAutocompleteHandler };
