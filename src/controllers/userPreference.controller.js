const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/apiResponse");
const { getPreferences, updatePreferences } = require("../services/userPreference.service");

const readPreferences = asyncHandler(async (req, res) => success(res, { message: "Preferences fetched successfully", data: getPreferences(req.user.id) }));
const savePreferences = asyncHandler(async (req, res) => success(res, { message: "Preferences saved successfully", data: updatePreferences(req.user.id, req.body) }));

module.exports = { readPreferences, savePreferences };
