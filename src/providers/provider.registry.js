const ridego = require("./ridego.provider");
const quickride = require("./quickride.provider");
const urbancab = require("./urbancab.provider");
const indrive = require("./indrive/indrive.adapter");

// Central lookup so services never hardcode a provider name.
// To add a real provider later: write a new adapter with the same
// { name, getFareQuote, getPickupEtaMin } shape and register it here.
const registry = {
  indrive,
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

function getProviderStatus() {
  return Promise.all(getAllAdapters().map(async (adapter) => ({
    id: adapter.id || adapter.name,
    enabled: adapter.id === "indrive" ? Boolean(require("./indrive/indrive.constants").getConfig().enabled) : true,
    mode: adapter.mode || "simulated",
    status: typeof adapter.getStatus === "function" ? await adapter.getStatus() : "READY",
  })));
}

module.exports = { getAdapter, getAllAdapters, getProviderStatus };
