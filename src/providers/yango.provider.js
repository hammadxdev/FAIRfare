const { createAuthorizedProviderAdapter } = require("./authorized-provider.adapter");
const { getConfig } = require("./yango/yango.constants");
const { createYangoRouteStatsTransport } = require("./yango/yango.adapter");
const { resolveProviderConfig } = require("../services/providerRuntimeConfig.service");

function createYangoProvider({ transport = null, mode = null } = {}) {
  const config = getConfig();
  const requestedMode = mode || config.mode;
  const configuredTransport = transport || (requestedMode === "authorized-live" ? createYangoRouteStatsTransport({ config, testContext: config.testContext }) : null);
  const adapter = createAuthorizedProviderAdapter({
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
  adapter.getNearbyDrivers = async ({ latitude, longitude, rideType } = {}) => {
    let effectiveConfig = config;
    let selectedTransport = configuredTransport;
    if (mode === null) {
      const runtime = await resolveProviderConfig("yango", config);
      if (runtime.activated) {
        effectiveConfig = runtime.config;
        selectedTransport = createYangoRouteStatsTransport({ config: effectiveConfig, testContext: effectiveConfig.testContext });
      }
    }
    if (effectiveConfig.mode !== "authorized-live" || !selectedTransport || typeof selectedTransport.getNearbyDrivers !== "function") {
      return { provider: "Yango", status: "unavailable", source: "none", drivers: [], driverCount: 0, error: { code: "LIVE_INTEGRATION_NOT_CONFIGURED", message: "Live Yango nearby data is currently unavailable." } };
    }
    try {
      return await selectedTransport.getNearbyDrivers({ latitude, longitude, rideType });
    } catch (error) {
      const status = error?.code === "PROVIDER_TIMEOUT" ? "timeout"
        : error?.code === "PROVIDER_AUTH_REQUIRED" || error?.code === "PROVIDER_AUTH_ERROR" ? "auth_required"
          : error?.code === "PROVIDER_INVALID_REQUEST" ? "invalid_request"
            : "unavailable";
      return { provider: "Yango", status, source: "none", drivers: [], driverCount: 0, error: { code: error?.code || "PROVIDER_UNAVAILABLE", message: "Live Yango nearby data is currently unavailable.", ...(error?.yangoDiagnostics ? { diagnostics: error.yangoDiagnostics } : {}) } };
    }
  };
  return adapter;
}

module.exports = createYangoProvider();
module.exports.createYangoProvider = createYangoProvider;
