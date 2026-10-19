const { getConfig } = require("./yango.constants");
const { createYangoRouteStatsClient } = require("./yango.client");

function createYangoRouteStatsTransport({ config = getConfig(), client = null, testContext = config.testContext } = {}) {
  const routeStatsClient = client || createYangoRouteStatsClient({ config, testContext });
  return {
    getFareEstimates({ pickup, destination, rideType } = {}) {
      return routeStatsClient.getFareEstimates({ pickup, destination, rideType });
    },
  };
}

module.exports = { createYangoRouteStatsTransport };
