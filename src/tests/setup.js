// Point every test file at an isolated sqlite file and make sure it's migrated + seeded.
process.env.DB_PATH = process.env.DB_PATH || "./data/test.sqlite";
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

const { ensureDatabaseReady } = require("../db/bootstrap");
ensureDatabaseReady();

module.exports = require("../app");
