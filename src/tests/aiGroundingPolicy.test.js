const test = require("node:test");
const assert = require("node:assert/strict");
const { comparisonContext, derivedFacts } = require("../services/ai/aiRideAssistant.service");
const { groundedReply, SYSTEM_INSTRUCTIONS } = require("../services/ai/llmClient");

function context(responseLanguage = "english") {
  return {
    responseLanguage,
    comparison: {
      rides: [
        { provider: "Yango", fare: 320, currency: "PKR", pickupEtaMin: 12, availability: "available", isCheapest: false, isFastest: false, bookWait: { status: "BOOK_NOW" } },
        { provider: "inDrive", fare: 280, currency: "PKR", pickupEtaMin: 18, availability: "available", isCheapest: true, isFastest: false, bookWait: { status: "BOOK_NOW" } },
        { provider: "Bykea", fare: 350, currency: "PKR", pickupEtaMin: 7, availability: "available", isCheapest: false, isFastest: true, bookWait: { status: "BOOK_NOW" } },
      ],
      derivedFacts: {
        cheapest: { provider: "inDrive", fare: 280, currency: "PKR" },
        fastest: { provider: "Bykea", pickupEtaMin: 7 },
        bookWaitStatus: "BOOK_NOW",
      },
    },
  };
}

test("comparison grounding supplies deterministic cheapest and fastest facts", () => {
  const result = comparisonContext({ results: [
    { provider: { displayName: "Yango" }, fare: 320, etaMin: 12, isAvailable: true, isCheapest: false, isFastest: false },
    { provider: { displayName: "inDrive" }, fare: 280, etaMin: 18, isAvailable: true, isCheapest: true, isFastest: false },
    { provider: { displayName: "Bykea" }, fare: 350, etaMin: 7, isAvailable: true, isCheapest: false, isFastest: true },
  ] });
  assert.deepEqual(result.rides.map(({ provider, fare, pickupEtaMin }) => ({ provider, fare, pickupEtaMin })), [
    { provider: "Yango", fare: 320, pickupEtaMin: 12 },
    { provider: "inDrive", fare: 280, pickupEtaMin: 18 },
    { provider: "Bykea", fare: 350, pickupEtaMin: 7 },
  ]);
  assert.equal(result.rides[1].isCheapest, true);
  assert.equal(result.rides[2].isFastest, true);
  assert.deepEqual(derivedFacts(result.rides), {
    cheapest: { provider: "inDrive", fare: 280, currency: "PKR" },
    fastest: { provider: "Bykea", pickupEtaMin: 7 },
    bookWaitStatus: null,
  });
});

test("grounded simple answers preserve scalar fares and advisory Book/Wait semantics", () => {
  const english = context();
  assert.equal(groundedReply({ text: "invented PKR 280-350 range", message: "Which ride is cheapest?", context: english }), "inDrive is currently estimated as the cheapest at PKR 280.");
  assert.equal(groundedReply({ text: "Book immediately", message: "Should I book now?", context: english }), "Booking now looks reasonable. Fair Fare's signal is advisory and does not guarantee a future fare.");
  assert.equal(groundedReply({ text: "It will be cheaper", message: "Will this definitely be cheaper later?", context: english }), "No—Fair Fare cannot guarantee that the fare will be cheaper later. The expected fare is only a model reference.");
});

test("Roman Urdu simple answers mirror language without converting fares to ranges", () => {
  const roman = context("roman_urdu");
  assert.equal(groundedReply({ text: "English range PKR 280-350", message: "Konsi ride sab se sasti hai?", context: roman }), "inDrive filhal sab se sasti estimated option hai, PKR 280.");
  assert.equal(groundedReply({ text: "English answer", message: "Mujhe abhi ride book karni chahiye ya wait karun?", context: roman }), "Abhi book karna reasonable lagta hai. Fair Fare ka signal sirf advisory hai aur future fare ki guarantee nahi deta.");
  assert.match(groundedReply({ text: "English answer", message: "Agar main wait karun to kya fare kam ho jayega?", context: roman }), /guarantee nahi deta/);
});

test("system policy distinguishes expected fare from future fare and provider offer", () => {
  assert.match(SYSTEM_INSTRUCTIONS, /scalar fare remains a scalar fare/i);
  assert.match(SYSTEM_INSTRUCTIONS, /model reference/i);
  assert.match(SYSTEM_INSTRUCTIONS, /final provider or driver offer may differ/i);
  assert.match(SYSTEM_INSTRUCTIONS, /does not complete booking/i);
  assert.match(SYSTEM_INSTRUCTIONS, /roman_urdu/i);
});
