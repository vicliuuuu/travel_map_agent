const test = require("node:test");
const assert = require("node:assert/strict");
const locationData = require("../location-data.js");

test("searchCountries matches partial english input", () => {
  const results = locationData.searchCountries("Ch", 5);
  const names = results.map((item) => item.name);
  assert.ok(names.includes("China"));
  assert.ok(names.includes("Chile") || names.includes("Switzerland"));
});

test("searchCities filters by selected country", () => {
  const results = locationData.searchCities("FR", "Pa", 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Paris");
});

test("getCountryCodeFromInput resolves english and chinese names", () => {
  assert.equal(locationData.getCountryCodeFromInput("China"), "CN");
  assert.equal(locationData.getCountryCodeFromInput("中国"), "CN");
});
