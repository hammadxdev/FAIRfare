const { query } = require("../config/postgres");
const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { getProviderStatus } = require("../providers/provider.registry");

const getProviders = asyncHandler(async (req, res) => {
  // Prepared fresh per request rather than once at module load — see the
  // comment in app.js's readiness middleware for why a module-load-time
  // prepared statement isn't safe to trust on this platform.
  const providers = (await query(`SELECT id, name, display_name, logo_url, deep_link_url FROM providers WHERE is_active = true ORDER BY id`)).rows
    .map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.display_name,
      logoUrl: p.logo_url,
      deepLinkUrl: p.deep_link_url,
    }));

  return success(res, { message: "Providers fetched successfully", data: providers });
});

const getProviderStatuses = asyncHandler(async (req, res) => {
  return success(res, { message: "Provider statuses fetched successfully", data: { providers: await getProviderStatus() } });
});

module.exports = { getProviders, getProviderStatuses };
