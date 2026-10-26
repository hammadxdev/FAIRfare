const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const controllerPath = path.join(__dirname, "../controllers/provider.controller.js");

function loadController(providerAdapters, persisted, onPersisted) {
  const loaded = new Module(controllerPath, module);
  loaded.filename = controllerPath;
  loaded.paths = module.paths;
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (id) => {
    if (id === "../config/postgres") return { query: async () => ({ rows: [] }) };
    if (id === "../providers/provider.registry") return { getProviderStatus: async () => [], getAdapter: (key) => providerAdapters[key] };
    if (id === "../services/nearbyObservation.service") return { persistNearbyProviderObservation: async (args) => { persisted.push(args); onPersisted(); } };
    return originalRequire(id);
  };
  loaded._compile(require("node:fs").readFileSync(controllerPath, "utf8"), controllerPath);
  return loaded.exports;
}

function responseRecorder() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("each nearby handler captures backend start before provider await and preserves receipt time separately", async () => {
  for (const [handlerName, adapterName, providerName] of [
    ["getIndriveDrivers", "indrive", "indrive"],
    ["getYangoDrivers", "quickride", "yango"],
    ["getBykeaDrivers", "urbancab", "bykea"],
  ]) {
    const persisted = [];
    let adapterCalledAt = null;
    let finishAdapter;
    const adapterFinished = new Promise((resolve) => { finishAdapter = resolve; });
    let finishPersistence;
    const persistenceFinished = new Promise((resolve) => { finishPersistence = resolve; });
    const adapter = { async getNearbyDrivers() {
      adapterCalledAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 8));
      finishAdapter();
      return { status: "available", drivers: [], vehicles: [], partners: [] };
    } };
    const controller = loadController({ indrive: adapter, quickride: adapter, urbancab: adapter }, persisted, finishPersistence);
    const res = responseRecorder();
    await controller[handlerName]({ query: { latitude: "31.5", longitude: "74.3", rideType: "car", serviceCode: "45" } }, res, (error) => { throw error; });
    await Promise.all([adapterFinished, persistenceFinished]);

    assert.equal(res.statusCode, 200);
    const body = res.body.data;
    const persistedRequest = persisted.find((entry) => entry.provider === providerName);
    assert.ok(Date.parse(body.requestStartedAt) <= adapterCalledAt);
    assert.ok(Date.parse(body.receivedAt) >= adapterCalledAt);
    assert.equal(persistedRequest.requestStartedAt, body.requestStartedAt);
    assert.equal(persistedRequest.receivedAt, body.receivedAt);
  }
});
