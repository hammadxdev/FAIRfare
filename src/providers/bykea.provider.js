const { createAuthorizedProviderAdapter } = require("./authorized-provider.adapter");
const { getConfig } = require("./bykea/bykea.constants");
const { normalizeBykeaFareResponse } = require("./bykea/bykea.mapper");
const { createBykeaHttpTransport } = require("./bykea/bykea.client");
const { createBykeaRequestContract } = require("./bykea/bykea.request-contract");

function createBykeaProvider({ config = getConfig(), transport = null, mode = null } = {}) {
  const requestedMode = mode || config.mode;
  const configuredTransport = transport || (requestedMode === "authorized-live"
    ? createBykeaHttpTransport({ config, requestContract: createBykeaRequestContract(config) })
    : null);
  const adapter = createAuthorizedProviderAdapter({
    id: "urbancab",
    displayName: "Bykea",
    currency: config.currency,
    currencyMultiplier: config.currencyMultiplier,
    requestedMode,
    transport: configuredTransport && typeof configuredTransport.getFareEstimates === "function"
      ? {
        ...configuredTransport,
        async getFareEstimates(args) {
          const response = await configuredTransport.getFareEstimates(args);
          const isRawBykeaResponse = response && typeof response === "object" && !Array.isArray(response)
            && (Array.isArray(response.data)
              || Object.prototype.hasOwnProperty.call(response, "success")
              || Object.prototype.hasOwnProperty.call(response, "code")
              || Object.prototype.hasOwnProperty.call(response, "error")
              || Object.prototype.hasOwnProperty.call(response, "message"));
          return isRawBykeaResponse ? normalizeBykeaFareResponse(response, { serviceMappings: config.serviceMappings, vehicleType: args.rideType || null }) : response;
        },
      }
      : configuredTransport,
  });
  adapter.getNearbyDrivers = async ({ latitude, longitude, serviceCode } = {}) => {
    if (requestedMode !== "authorized-live" || typeof configuredTransport?.getNearbyDrivers !== "function") {
      return { provider: "bykea", status: "unavailable", source: "none", partners: [], error: { code: "LIVE_INTEGRATION_NOT_CONFIGURED", message: "Live Bykea nearby data is currently unavailable." } };
    }
    try {
      return await configuredTransport.getNearbyDrivers({ latitude, longitude, serviceCode });
    } catch (error) {
      const status = error?.code === "PROVIDER_TIMEOUT" ? "timeout"
        : error?.code === "PROVIDER_AUTH_REQUIRED" ? "auth_required"
          : error?.code === "PROVIDER_ACCESS_DENIED" ? "access_denied"
            : error?.code === "PROVIDER_RATE_LIMITED" ? "rate_limited"
              : error?.code === "PROVIDER_INVALID_REQUEST" ? "invalid_request"
                : "unavailable";
      return { provider: "bykea", status, source: "none", partners: [], error: { code: error?.code || "PROVIDER_UNAVAILABLE", message: "Live Bykea nearby data is currently unavailable." } };
    }
  };
  return adapter;
}

module.exports = createBykeaProvider();
module.exports.createBykeaProvider = createBykeaProvider;
