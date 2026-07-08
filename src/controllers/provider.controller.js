const db = require("../config/database");
const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");

const getActiveProvidersStmt = db.prepare(
  `SELECT id, name, display_name, logo_url, deep_link_url FROM providers WHERE is_active = 1 ORDER BY id`
);

const getProviders = asyncHandler(async (req, res) => {
  const providers = getActiveProvidersStmt.all().map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.display_name,
    logoUrl: p.logo_url,
    deepLinkUrl: p.deep_link_url,
  }));

  return success(res, { message: "Providers fetched successfully", data: providers });
});

module.exports = { getProviders };
