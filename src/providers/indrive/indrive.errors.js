class IndriveError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IndriveError";
    this.code = code;
    this.details = details;
    this.isProviderError = true;
  }
}

const CODES = Object.freeze({
  NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  AUTH_REQUIRED: "PROVIDER_AUTH_REQUIRED",
  TIMEOUT: "PROVIDER_TIMEOUT",
  RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  BAD_RESPONSE: "PROVIDER_BAD_RESPONSE",
  UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  UNSUPPORTED_CATEGORY: "PROVIDER_UNSUPPORTED_CATEGORY",
  MALFORMED_REQUEST: "PROVIDER_MALFORMED_REQUEST",
});

module.exports = { IndriveError, CODES };
