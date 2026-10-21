// Integration setup is only valid with an explicitly isolated PostgreSQL test
// database. Never inherit DATABASE_URL, which may identify Supabase/staging.
const { isolatedTestDatabase, APPROVAL } = require("./helpers/testDatabaseGuard");
const verified = isolatedTestDatabase();
if (!verified.configured || process.env.FAIRFARE_TEST_DATABASE_PREFLIGHT_VERIFIED !== APPROVAL) {
  const error = new Error(!verified.configured ? verified.code : "TEST_DATABASE_PREFLIGHT_REQUIRED");
  error.code = error.message;
  throw error;
}
process.env.DATABASE_URL = verified.value;
process.env.NODE_ENV = "test";
process.env.FAIR_FARE_DATASET_MODE = "legacy";
process.env.JWT_ACCESS_SECRET = "test-only-fairfare-access-secret";
process.env.FAIRFARE_PREDICTION_TIMEOUT_MS = process.env.FAIRFARE_PREDICTION_TIMEOUT_MS || "30000";
require("../config/env");

const emailProvider = require("../services/email/emailProvider");
global.__emailTestCodes = new Map();
emailProvider.setEmailProviderForTests({
  async send({ to, subject, html }) {
    const code = html.match(/letter-spacing:8px[^>]*>(\d{6})/)?.[1];
    if (code) global.__emailTestCodes.set(`${to}:${subject.startsWith("Verify") ? "verify" : "reset"}`, code);
    return { accepted: true };
  },
});

module.exports = require("../app");
