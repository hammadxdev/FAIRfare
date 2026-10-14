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

const PROVIDER_DISPLAY_NAMES = Object.freeze({
  indrive: "inDrive",
  quickride: "Yango",
  urbancab: "Bykea",
});

const PROVIDER_ALIASES = Object.freeze({
  indrive: "indrive",
  "in-drive": "indrive",
  "in drive": "indrive",
  yango: "quickride",
  quickride: "quickride",
  "quick ride": "quickride",
  bykea: "urbancab",
  urbancab: "urbancab",
  "urban cab": "urbancab",
});

function canonicalProviderId(value) {
  const key = String(value || "").trim().toLowerCase();
  return PROVIDER_ALIASES[key] || null;
}

function providerDisplayName(value) {
  const id = canonicalProviderId(value);
  return id ? PROVIDER_DISPLAY_NAMES[id] : null;
}

function supportedProviderDisplayNames() {
  return Object.freeze(Object.values(PROVIDER_DISPLAY_NAMES));
}

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

module.exports = {
  getAdapter,
  getAllAdapters,
  getProviderStatus,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ALIASES,
  canonicalProviderId,
  providerDisplayName,
  supportedProviderDisplayNames,
};
