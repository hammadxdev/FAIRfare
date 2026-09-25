const PROVIDER_ID = "indrive";
const PROVIDER_NAME = "inDrive";

const TOKEN_RENEW_URL = "https://ath-gw-cf.euce1.indriverapp.com/api/auth/v1/token/renew";
const PRICING_URL = "https://api-gw-cf.sa.apse1.aws.indriverapp.com/recprice-gateway-backend/api/pricing/v6/price";
const ORDER_TYPE_IDS = [2, 33, 31, 29, 11];
const ORDER_TYPE_CATEGORIES = {
  2: { name: "Moto", normalizedCategory: "BIKE" },
  31: { name: "Rickshaw", normalizedCategory: "RICKSHAW" },
};

function getConfig(env = process.env) {
  return {
    enabled: env.INDRIVE_ENABLED !== "false",
    mode: env.INDRIVE_MODE || "simulated",
    refreshToken: env.INDRIVE_REFRESH_TOKEN || "",
    deviceFingerprint: env.INDRIVE_DEVICE_FINGERPRINT || "",
    fingerprint: env.INDRIVE_FINGERPRINT || "",
    appVersion: env.INDRIVE_APP_VERSION || "android 5.157.0",
    language: env.INDRIVE_LANGUAGE || "en_US",
    osType: env.INDRIVE_OS_TYPE || "android",
    appFlavor: env.INDRIVE_APP_FLAVOR || "indriver",
    timeoutMs: Number(env.INDRIVE_REQUEST_TIMEOUT_MS || 10000),
    refreshBufferSeconds: Number(env.INDRIVE_REFRESH_BUFFER_SECONDS || 300),
  };
}

module.exports = {
  PROVIDER_ID,
  PROVIDER_NAME,
  TOKEN_RENEW_URL,
  PRICING_URL,
  ORDER_TYPE_IDS,
  ORDER_TYPE_CATEGORIES,
  getConfig,
};
