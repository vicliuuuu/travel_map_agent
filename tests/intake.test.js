const test = require("node:test");
const assert = require("node:assert/strict");
const intake = require("../intake.js");

test("parseExtraction coerces enums, clamps numbers, drops invalid", () => {
  const { delta } = intake.parseExtraction({
    destinations: [{ country: "Japan", city: "Tokyo" }, { foo: "bar" }],
    places: [{ name: "浅草寺" }, { name: "" }, "garbage"],
    totalDays: 4,
    visitMinutes: 5000,
    strategy: "classic",
    transport: "bus",       // invalid → dropped
    physical: "EASY",       // case-insensitive → easy
    confidence: { totalDays: 0.9 },
  });
  assert.equal(delta.destinations.length, 1);
  assert.equal(delta.places.length, 1);
  assert.equal(delta.totalDays, 4);
  assert.equal(delta.visitMinutes, 480); // clamped
  assert.equal(delta.strategy, "classic");
  assert.equal(delta.transport, undefined);
  assert.equal(delta.physical, "easy");
});

test("parseExtraction throws on non-object / bad JSON (no silent failure)", () => {
  assert.throws(() => intake.parseExtraction("not json"), Error);
  assert.throws(() => intake.parseExtraction(42), /对象/);
});

test("mergeConstraints unions lists (dedup) and overrides scalars, immutably", () => {
  const base = intake.emptyDraft();
  const step1 = intake.mergeConstraints(base, { places: [{ name: "A" }], totalDays: 2 });
  const step2 = intake.mergeConstraints(step1, { places: [{ name: "A" }, { name: "B" }], totalDays: 3, strategy: "fastest" });
  assert.equal(step2.places.length, 2); // A dedup, B added
  assert.equal(step2.totalDays, 3);
  assert.equal(step2.strategy, "fastest");
  assert.equal(base.places.length, 0); // base untouched
  assert.equal(step1.totalDays, 2);    // step1 untouched
});

test("missingRequired / isRequiredComplete", () => {
  const empty = intake.emptyDraft();
  assert.deepEqual(intake.missingRequired(empty).sort(), ["destinations", "places", "totalDays"].sort());
  const full = intake.mergeConstraints(empty, {
    destinations: [{ country: "France", city: "Paris" }],
    places: [{ name: "Louvre" }],
    totalDays: 2,
  });
  assert.equal(intake.isRequiredComplete(full), true);
  assert.deepEqual(intake.missingRequired(full), []);
});

test("decideClarify asks for first missing, stops at budget, silent when complete", () => {
  const empty = intake.emptyDraft();
  const ask = intake.decideClarify(empty, 0, 6);
  assert.equal(ask.shouldAsk, true);
  assert.ok(ask.question);

  const exhausted = intake.decideClarify(empty, 6, 6);
  assert.equal(exhausted.shouldAsk, false);
  assert.equal(exhausted.reason, "budget_exhausted");

  const full = intake.mergeConstraints(empty, {
    destinations: [{ city: "Tokyo" }],
    places: [{ name: "X" }],
    totalDays: 2,
  });
  assert.equal(intake.decideClarify(full, 0, 6).shouldAsk, false);
});

test("applyDefaults fills non-required and records assumptions", () => {
  const d = intake.emptyDraft();
  const r = intake.applyDefaults(d);
  assert.equal(r.strategy, "fastest");
  assert.equal(r.transport, "driving");
  assert.equal(r.physical, "standard");
  assert.equal(r.visitMinutes, 90);
  assert.ok(r.assumptions.length >= 3);
});

test("buildPlanInputFromDraft groups places by city and applies defaults", () => {
  const d = intake.mergeConstraints(intake.emptyDraft(), {
    destinations: [{ country: "Japan", city: "Osaka" }, { country: "Japan", city: "Kyoto" }],
    places: [
      { name: "Osaka Castle", city: "Osaka" },
      { name: "Fushimi Inari", city: "Kyoto" },
      { name: "Floating Place" }, // no city → first city
    ],
    totalDays: 4,
  });
  const input = intake.buildPlanInputFromDraft(d);
  assert.equal(input.totalDays, 4);
  assert.equal(input.strategy, "fastest");
  assert.equal(input.transportPreference, "driving");
  assert.equal(input.physicalPreference, "standard");
  assert.equal(input.places.length, 3);
  // destinations grouped: Japan with 2 cities
  assert.equal(input.destinations.length, 1);
  assert.equal(input.destinations[0].country, "Japan");
  assert.equal(input.destinations[0].cities.length, 2);
  const osaka = input.destinations[0].cities.find((c) => c.city === "Osaka");
  assert.ok(osaka.places.some((p) => p.name === "Osaka Castle"));
  assert.ok(osaka.places.some((p) => p.name === "Floating Place")); // fell back to first city
});

test("buildPlanInputFromDraft builds lodging from hotels", () => {
  const d = intake.mergeConstraints(intake.emptyDraft(), {
    destinations: [{ city: "Tokyo" }],
    places: [{ name: "X" }],
    totalDays: 2,
    hotels: [{ name: "Tokyo Hotel", address: "Shinjuku" }],
  });
  const input = intake.buildPlanInputFromDraft(d);
  assert.ok(input.lodging);
  assert.equal(input.lodging.hotels.length, 1);
  assert.equal(input.lodging.hotels[0].name, "Tokyo Hotel");
});

test("extractConstraints uses injected callLlm and returns parsed delta", async () => {
  const mockLlm = (messages) => {
    assert.ok(Array.isArray(messages));
    return Promise.resolve({ places: [{ name: "浅草寺" }], totalDays: 3 });
  };
  const { delta } = await intake.extractConstraints([{ role: "user", content: "去东京玩3天，想去浅草寺" }], intake.emptyDraft(), mockLlm);
  assert.equal(delta.totalDays, 3);
  assert.equal(delta.places[0].name, "浅草寺");
});

test("extractConstraints rejects without callLlm (no silent failure)", async () => {
  await assert.rejects(() => intake.extractConstraints([], intake.emptyDraft(), null), /callLlm/);
});
