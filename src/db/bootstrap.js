let isBootstrapped = false;

function ensureDatabaseReady() {
  if (isBootstrapped) return;

  const { runMigrations } = require("./migrate");
  const { seedDatabase } = require("./seed");

  runMigrations();
  seedDatabase();

  isBootstrapped = true;
}

module.exports = {
  ensureDatabaseReady,
};
