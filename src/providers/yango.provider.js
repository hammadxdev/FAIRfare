const { createAuthorizedProviderAdapter } = require("./authorized-provider.adapter");
const { getConfig } = require("./yango/yango.constants");
const { createYangoRouteStatsTransport } = require("./yango/yango.adapter");
const { resolveProviderConfig } = require("../services/providerRuntimeConfig.service");

function createYangoProvider({ transport = null, mode = null } = {}) {
  const config = getConfig();
  const requestedMode = mode || config.mode;
  const configuredTransport = transport || (requestedMode === "authorized-live" ? createYangoRouteStatsTransport({ config, testContext: config.testContext }) : null);
  return createAuthorizedProviderAdapter({
    id: "quickride",
    displayName: "Yango",
    currency: process.env.YANGO_CURRENCY || "PKR",
    currencyMultiplier: Number(process.env.YANGO_CURRENCY_MULTIPLIER || 100),
    requestedMode,
    transport: configuredTransport,
    ...(mode === null ? {
      runtimeConfigResolver: () => resolveProviderConfig("yango", config),
      transportFactory: (runtimeConfig) => createYangoRouteStatsTransport({ config: runtimeConfig, testContext: runtimeConfig.testContext }),
    } : {}),
  });
}

module.exports = createYangoProvider();
module.exports.createYangoProvider = createYangoProvider;
