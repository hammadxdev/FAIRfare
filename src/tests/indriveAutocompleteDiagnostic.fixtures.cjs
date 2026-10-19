const assert = require("node:assert/strict");
const { normalizeResponse } = require("./diagnoseIndriveAutocomplete.cjs");

const validItem = {
  suggest_id: "suggest-1",
  place_id: "place-1",
  address: "Lahore General University",
  description: "Lahore, Pakistan",
  latitude: 31.4742,
  longitude: 74.4163,
  locality: "Lahore",
  postal_code: "54000",
  address_type: "establishment",
};

const valid = normalizeResponse({ response: { items: [validItem] } });
assert.equal(valid.valid, true);
assert.equal(valid.suggestions.length, 1);
assert.deepEqual(valid.suggestions[0], {
  suggestId: "suggest-1",
  placeId: "place-1",
  address: "Lahore General University",
  description: "Lahore, Pakistan",
  latitude: 31.4742,
  longitude: 74.4163,
  locality: "Lahore",
  postalCode: "54000",
  addressType: "establishment",
});

const empty = normalizeResponse({ response: { items: [] } });
assert.equal(empty.valid, true);
assert.equal(empty.suggestions.length, 0);

const missingWrapper = normalizeResponse({ items: [validItem] });
assert.equal(missingWrapper.valid, false);
assert.equal(missingWrapper.errorCode, "PROVIDER_RESPONSE_ITEMS_MISSING");

const invalidCoordinates = normalizeResponse({ response: { items: [{ ...validItem, latitude: 999 }, { ...validItem, longitude: null }] } });
assert.equal(invalidCoordinates.valid, true);
assert.equal(invalidCoordinates.suggestions.length, 0);
assert.equal(invalidCoordinates.invalidItemCount, 2);

console.log("indrive-autocomplete-fixtures: PASS");
