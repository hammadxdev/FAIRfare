const ridego = require("./ridego.provider");
const quickride = require("./quickride.provider");
const urbancab = require("./urbancab.provider");

// Central lookup so services never hardcode a provider name.
// To add a real provider later: write a new adapter with the same
// { name, getFareQuote, getPickupEtaMin } shape and register it here.
const registry = {
  ridego,
  quickride,
  urbancab,
};

function getAdapter(name) {
  const adapter = registry[name];
  if (!adapter) {
    throw new Error(`No provider adapter registered for "${name}"`);
  }
  return adapter;
}

function getAllAdapters() {
  return Object.values(registry);
}

module.exports = { getAdapter, getAllAdapters };
