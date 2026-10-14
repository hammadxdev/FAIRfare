function configuredOrigins(env = process.env) {
  return String(env.FAIRFARE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== "*");
}

function isOriginAllowed(origin, env = process.env) {
  if (!origin) return true;
  return configuredOrigins(env).includes(origin);
}

function corsOptions(env = process.env) {
  return {
    origin(origin, callback) {
      // Native mobile requests normally omit Origin. Bearer-token requests do
      // not require browser credential sharing, so these remain compatible.
      if (isOriginAllowed(origin, env)) return callback(null, true);
      // Returning false omits CORS headers; the browser then blocks the caller
      // while the server does not disclose configuration or credentials.
      return callback(null, false);
    },
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Client-Message-Id"],
    optionsSuccessStatus: 204,
  };
}

module.exports = { configuredOrigins, isOriginAllowed, corsOptions };
