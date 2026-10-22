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
  return createAuthorizedProviderAdapter({
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
}

module.exports = createBykeaProvider();
module.exports.createBykeaProvider = createBykeaProvider;
