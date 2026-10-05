const { getConfig, VEHICLE_TYPE_ORDER_IDS } = require("./indrive.constants");
const { createIndriveClient } = require("./indrive.client");
const { createSessionManager } = require("./indrive.auth");
const { mapPricingResponse } = require("./indrive.mapper");
const { IndriveError, CODES } = require("./indrive.errors");
const { calculateSimulatedFare } = require("../simulation.engine");

function buildPricingPayload(route) {
  const requestedCategory = route.orderTypeId ?? VEHICLE_TYPE_ORDER_IDS[route.vehicleType] ?? VEHICLE_TYPE_ORDER_IDS[String(route.vehicleType || "").toUpperCase()];
  if (!Number.isInteger(Number(requestedCategory))) {
    throw new IndriveError(CODES.UNSUPPORTED_CATEGORY, "inDrive category is not supported");
  }
  return {
    order_type_id: Number(requestedCategory),
    route: [
      { latitude: Number(route.pickup.latitude), longitude: Number(route.pickup.longitude) },
      { latitude: Number(route.destination.latitude), longitude: Number(route.destination.longitude) },
    ],
    geo: {
      distance_meters: Number(route.distanceMeters), duration_seconds: Number(route.durationSeconds),
      toll_cost: 0.0, provider: "", points: [],
    },
  };
}

function createIndriveAdapter({ config = getConfig(), client, session } = {}) {
  const indriveClient = client || createIndriveClient({ config });
  const sessionManager = session || createSessionManager({ client: indriveClient, config });
  return {
    id: "indrive", name: "indrive", displayName: "inDrive", mode: config.mode,
    getStatus: sessionManager.getStatus,
    getSessionManager: () => sessionManager,
    async getQuotes({ route, rate, vehicleType, observedAt }) {
      if (config.mode === "simulated") {
        return [{ ...calculateSimulatedFare({ provider: "indrive", vehicleType, rate, route, observedAt }), providerName: "inDrive", tripDurationSeconds: route.durationSeconds, distanceMeters: route.distanceMeters, deepLink: null }];
      }
      if (!config.enabled) throw new IndriveError(CODES.UNAVAILABLE, "inDrive is disabled");
      const accessToken = await sessionManager.ensureValidSession();
      const first = await indriveClient.getPricing(accessToken, buildPricingPayload({ ...route, vehicleType }));
      if (first.status === 401) {
        const retryToken = await sessionManager.ensureValidSession({ force: true });
        const second = await indriveClient.getPricing(retryToken, buildPricingPayload({ ...route, vehicleType }));
        if (second.status === 401) { await sessionManager.markAuthRequired(); throw new IndriveError(CODES.AUTH_REQUIRED, "inDrive pricing authentication failed"); }
        if (second.status < 200 || second.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive pricing failed", { status: second.status });
        return mapPricingResponse(second.body, route);
      }
      if (first.status === 429) throw new IndriveError(CODES.RATE_LIMITED, "inDrive pricing rate limited");
      if (first.status < 200 || first.status >= 300) throw new IndriveError(CODES.UNAVAILABLE, "inDrive pricing failed", { status: first.status });
      return mapPricingResponse(first.body, route);
    },
    getFareQuote() { throw new Error("Use getQuotes for inDrive"); },
    getPickupEtaMin() { return null; },
  };
}

const defaultAdapter = createIndriveAdapter();
module.exports = defaultAdapter;
module.exports.createIndriveAdapter = createIndriveAdapter;
module.exports.buildPricingPayload = buildPricingPayload;
