const test = require("node:test");
const assert = require("node:assert/strict");
const { createYangoProvider } = require("../providers/yango.provider");
const { createBykeaProvider } = require("../providers/bykea.provider");
const { normalizeLiveQuote } = require("../providers/authorized-provider.adapter");
const { normalizeLiveEstimate } = require("../providers/indrive-architecture");

const route = {
  pickup: { latitude: 31.4742, longitude: 74.4163 },
  destination: { latitude: 31.5204, longitude: 74.3587 },
  distanceMeters: 9301,
  durationSeconds: 1139,
};

test("Yango injected authorized response is normalized as a live vehicle quote", async () => {
  const provider = createYangoProvider({ mode: "authorized-live", transport: { async getFareEstimates() { return { status: "available", currency: "PKR", estimates: [{ rideType: "yango_go", categoryName: "Go", fareMinor: 45000, priceType: "fixed" }] }; } } });
  const response = await provider.getFareEstimates({ ...route, rideType: "standard" });
  assert.equal(response.source, "live");
  assert.deepEqual(response.estimates[0], { categoryId: "yango_go", categoryName: "Go", rideType: "yango_go", fare: 450, currency: "PKR", priceType: "fixed", isEstimate: true, quotedAt: response.estimates[0].quotedAt, expiresAt: null, source: "live" });
});

test("fare contract preserves Yango from qualifier and exact major-unit fare", async () => {
  const provider = createYangoProvider({ mode: "authorized-live", transport: { async getFareEstimates() {
    return { status: "available", currency: "PKR", estimates: [{ categoryId: "econom", categoryName: "Economy", fare: 316, priceQualifier: "from", priceText: "$SIGN$316 $CURRENCY$", surgeMultiplier: 1.5095, categoryType: "passenger" }] };
  } } });
  const response = await provider.getFareEstimates({ ...route });
  assert.equal(response.estimates[0].fare, 316);
  assert.equal(response.estimates[0].currency, "PKR");
  assert.equal(response.estimates[0].priceQualifier, "from");
  assert.equal(response.estimates[0].surgeMultiplier, 1.5095);
});

test("Bykea injected authorized response is normalized without making the provider live by default", async () => {
  const unavailableYango = require("../providers/yango.provider");
  assert.equal(unavailableYango.liveTransportEnabled, false);
  const unavailable = require("../providers/bykea.provider");
  assert.equal(unavailable.liveTransportEnabled, false);
  const provider = createBykeaProvider({ mode: "authorized-live", transport: { async getFareEstimates() { return { status: "available", currency: "PKR", estimates: [{ categoryId: "motorbike", categoryName: "Motorbike", fare: 220, priceType: "estimate" }] }; } } });
  const response = await provider.getFareEstimates({ ...route, rideType: "bike" });
  assert.equal(response.estimates[0].fare, 220);
  assert.equal(response.estimates[0].categoryName, "Motorbike");
  assert.equal(response.source, "live");
});

test("inDrive distinguishes suggested negotiable fares from fixed quotes", () => {
  const suggested = normalizeLiveEstimate({ fare: 320, negotiable: true }, "PKR", 100);
  const fixed = normalizeLiveEstimate({ fareMinor: 45000, priceType: "fixed" }, "PKR", 100);
  assert.equal(suggested.priceType, "suggested");
  assert.equal(suggested.isNegotiable, true);
  assert.equal(fixed.priceType, "fixed");
  assert.equal(fixed.fare, 450);
});

test("invalid and stale injected quotes are rejected", () => {
  assert.equal(normalizeLiveQuote({ fare: 0 }, { currency: "PKR" }), null);
  assert.equal(normalizeLiveQuote({ fare: 300, expiresAt: "2020-01-01T00:00:00.000Z" }, { currency: "PKR" }), null);
});

test("one provider failure does not block another provider result", async () => {
  const providers = [
    createYangoProvider({ mode: "authorized-live", transport: { async getFareEstimates() { throw Object.assign(new Error("timeout"), { code: "PROVIDER_TIMEOUT" }); } } }),
    createBykeaProvider({ mode: "authorized-live", transport: { async getFareEstimates() { return { status: "available", currency: "PKR", estimates: [{ fare: 280, categoryName: "Motorbike" }] }; } } }),
  ];
  const settled = await Promise.allSettled(providers.map((provider) => provider.getFareEstimates({ ...route, rideType: "bike" })));
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[0].value.status, "timeout");
  assert.equal(settled[1].value.status, "available");
  assert.equal(settled[1].value.estimates[0].fare, 280);
});

test("Yango diagnostics survive adapter normalization while other providers stay unchanged", async () => {
  const diagnostics = { provider: "yango", upstreamStatus: 429, errorCategory: "RATE_LIMITED", requestReachedUpstream: true };
  const yango = createYangoProvider({ mode: "authorized-live", transport: { async getFareEstimates() { throw Object.assign(new Error("internal"), { code: "PROVIDER_RATE_LIMITED", yangoDiagnostics: diagnostics }); } } });
  const response = await yango.getFareEstimates({ ...route, rideType: "car" });
  assert.equal(response.error.code, "PROVIDER_RATE_LIMITED");
  assert.deepEqual(response.error.diagnostics, diagnostics);
  assert.equal(response.error.message, "Live fare data is currently unavailable.");

  const indriveLike = require("../providers/authorized-provider.adapter").createAuthorizedProviderAdapter({ id: "indrive", displayName: "inDrive", requestedMode: "authorized-live", transport: { async getFareEstimates() { throw Object.assign(new Error("internal"), { code: "PROVIDER_ERROR", yangoDiagnostics: diagnostics }); } } });
  const other = await indriveLike.getFareEstimates({ ...route, rideType: "car" });
  assert.equal(other.error.diagnostics, undefined);
});
