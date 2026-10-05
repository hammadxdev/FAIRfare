const { calculateSimulatedFare } = require("./simulation.engine");

function modeFor(provider, env = process.env) {
  const aliases = provider === "quickride" ? ["YANGO_MODE", "QUICKRIDE_MODE"] : ["BYKEA_MODE", "URBANCAB_MODE"];
  const value = aliases.map((key) => env[key]).find(Boolean);
  return String(value || "simulated").toLowerCase();
}

function createSimulatedProvider({ id, displayName }) {
  return {
    id,
    name: id,
    displayName,
    get mode() { return modeFor(id); },
    async getQuotes({ route, rate, vehicleType, observedAt, context, weather }) {
      if (this.mode !== "simulated") {
        const error = new Error(`${displayName} real adapter is not configured`);
        error.code = "PROVIDER_REAL_NOT_CONFIGURED";
        throw error;
      }
      return [{ ...calculateSimulatedFare({ provider: id, vehicleType, rate, route, observedAt, context, weather }), providerName: displayName, tripDurationSeconds: route.durationSeconds, distanceMeters: route.distanceMeters, deepLink: null }];
    },
    getStatus() { return this.mode === "simulated" ? "READY" : "NOT_CONFIGURED"; },
  };
}

module.exports = { createSimulatedProvider, modeFor };
