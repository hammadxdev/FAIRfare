const { createAuthorizedProviderAdapter } = require("./authorized-provider.adapter");

function createBykeaProvider({ transport = null, mode = process.env.BYKEA_AUTHORIZED_LIVE === "true" ? "authorized-live" : "unavailable" } = {}) {
  return createAuthorizedProviderAdapter({ id: "urbancab", displayName: "Bykea", currency: process.env.BYKEA_CURRENCY || "PKR", currencyMultiplier: Number(process.env.BYKEA_CURRENCY_MULTIPLIER || 100), requestedMode: mode, transport });
}

module.exports = createBykeaProvider();
module.exports.createBykeaProvider = createBykeaProvider;
