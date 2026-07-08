// Point every test file at an isolated sqlite file and make sure it's migrated + seeded.
process.env.DB_PATH = process.env.DB_PATH || "./data/test.sqlite";
process.env.NODE_ENV = "test";

require("../db/migrate");
require("../db/seed");

module.exports = require("../app");
