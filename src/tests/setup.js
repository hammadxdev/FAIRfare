// Point every test file at an isolated sqlite file and make sure it's migrated + seeded.
process.env.DB_PATH = process.env.DB_PATH || "./data/test.sqlite";
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-only-fairfare-access-secret";
process.env.FAIRFARE_PREDICTION_TIMEOUT_MS = process.env.FAIRFARE_PREDICTION_TIMEOUT_MS || "30000";

const { ensureDatabaseReady } = require("../db/bootstrap");
ensureDatabaseReady();

module.exports = require("../app");
