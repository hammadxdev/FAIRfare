const { ensureDatabaseReady } = require("../src/db/bootstrap");

ensureDatabaseReady();

const app = require("../src/app");

module.exports = app;
