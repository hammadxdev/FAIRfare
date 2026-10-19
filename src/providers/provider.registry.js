const ridego = require("./ridego.provider");
const quickride = process.env.NODE_ENV === "test" ? require("./quickride.provider") : require("./yango.provider");
// Keep the legacy quickride application ID for fare/history compatibility,
// while exposing the actual Yango integration under its provider name in
// status diagnostics.
const yango = require("./yango.provider");
const urbancab = process.env.NODE_ENV === "test" ? require("./urbancab.provider") : require("./bykea.provider");
// The inDrive adapter uses the server-side authorized JWT and validated live
// transport when configured; it remains simulated when the backend is run in
// simulation mode.
const indrive = require("./indrive/indrive.adapter");
const { resolveProviderConfig } = require("../services/providerRuntimeConfig.service");
const { getConfig: getIndriveConfig } = require("./indrive/indrive.constants");
const { getConfig: getYangoConfig } = require("./yango/yango.constants");

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

function statusEntries() {
  return [
    { id: "indrive", adapter: indrive },
    { id: "quickride", adapter: quickride },
    { id: "yango", adapter: yango },
    { id: "urbancab", adapter: urbancab },
  ];
}

async function getProviderStatus() {
  return Promise.all(statusEntries().map(async ({ id, adapter }) => {
    const runtime = id === "indrive"
      ? await resolveProviderConfig("indrive", getIndriveConfig())
      : id === "yango"
        ? await resolveProviderConfig("yango", getYangoConfig())
        : { activated: false, config: null };
    const configured = runtime.activated ? runtime.config : null;
    return {
      id,
      enabled: configured ? Boolean(configured.enabled) : id === "indrive"
        ? Boolean(getIndriveConfig().enabled)
        : id === "yango"
          ? Boolean(getYangoConfig().enabled)
          : true,
      mode: configured?.mode || (adapter.liveTransportEnabled === true ? (adapter.mode || "authorized-live") : adapter.mode || "unavailable"),
      status: typeof adapter.getStatus === "function" ? await adapter.getStatus() : "NOT_CONFIGURED",
    };
  }));
}

module.exports = {
  getAdapter,
  getAllAdapters,
  statusEntries,
  getProviderStatus,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ALIASES,
  canonicalProviderId,
  providerDisplayName,
  supportedProviderDisplayNames,
};
