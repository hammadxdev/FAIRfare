const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/yangoNearestDrivers.sanitized.json");

function collectKeys(value, path = "$", output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeys(item, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    output.push({ key, path: `${path}.${key}` });
    collectKeys(child, `${path}.${key}`, output);
  }
  return output;
}

test("sanitized NearestDrivers fixture preserves only availability evidence", () => {
  assert.equal(fixture.response.status, 200);
  const drivers = fixture.response.body.drivers;
  assert.equal(drivers.length, 3);
  assert.equal(drivers.filter((driver) => driver.free === true).length, 3);
  assert.equal(drivers.filter((driver) => driver.display_tariff === "econom").length, 1);
  assert.equal(drivers.filter((driver) => driver.display_tariff === "business").length, 2);
  assert.equal(fixture.request.body.classes[0], "econom");
});

test("NearestDrivers does not imply tariff-wide availability, bookability, or fare", () => {
  const drivers = fixture.response.body.drivers;
  assert.equal(drivers.some((driver) => driver.display_tariff !== "econom"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.response.body, "price"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.response.body, "fare"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.response.body, "destination"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.response.body, "distance"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.response.body, "duration"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.response.body, "bookable"), false);
});

test("sanitized NearestDrivers fixture contains no captured identity or credential fields", () => {
  const keys = collectKeys(fixture).map((entry) => entry.key.toLowerCase());
  for (const forbidden of ["authorization", "cookie", "token", "session", "account", "device", "driver_id", "id", "latitude", "longitude", "coordinates"]) {
    assert.equal(keys.includes(forbidden), false, `fixture must not contain ${forbidden}`);
  }
});
