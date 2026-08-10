const test = require("node:test");
const assert = require("node:assert/strict");
const verifier = require("../verifier.js");

function visitDay(day, titles) {
  return {
    day,
    items: titles.map((t) => ({ type: "visit", title: t, durationMin: 90 })),
  };
}

test("runVerifiers passes a well-formed single day plan", () => {
  const planData = [visitDay(1, ["A", "B"])];
  const dailyPlans = [
    {
      day: 1,
      segments: [
        { type: "visit", visitDurationMin: 120 },
        { type: "transit", durationMin: 20 },
        { type: "visit", visitDurationMin: 120 },
      ],
    },
  ];
  const result = verifier.runVerifiers({
    planData,
    dailyPlans,
    lodging: null,
    requestedDays: 1,
    cityOf: () => "同城",
  });
  assert.equal(result.pass, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.score, 0);
});

test("runVerifiers flags TIME_OVERLOAD as error", () => {
  const planData = [visitDay(1, ["A", "B"])];
  const dailyPlans = [
    {
      day: 1,
      segments: [
        { type: "visit", visitDurationMin: 400 },
        { type: "transit", durationMin: 60 },
        { type: "visit", visitDurationMin: 300 },
      ],
    },
  ];
  const result = verifier.runVerifiers({ planData, dailyPlans, requestedDays: 1, cityOf: () => "X" });
  assert.equal(result.pass, false);
  const finding = result.findings.find((f) => f.code === verifier.CODES.TIME_OVERLOAD);
  assert.ok(finding);
  assert.equal(finding.level, "error");
  assert.equal(finding.evidence.day, 1);
  assert.ok(result.score > 0);
});

test("runVerifiers flags HOTEL_LOOP_BROKEN when a day is not closed", () => {
  const planData = [visitDay(1, ["A"])];
  const dailyPlans = [
    {
      day: 1,
      segments: [
        { type: "visit", placeName: "A" },
        { type: "transit", from: "A", to: "别处" },
      ],
    },
  ];
  const result = verifier.runVerifiers({
    planData,
    dailyPlans,
    lodging: { mode: "single", hotel: { name: "酒店" } },
    requestedDays: 1,
    cityOf: () => "X",
  });
  const finding = result.findings.find((f) => f.code === verifier.CODES.HOTEL_LOOP_BROKEN);
  assert.ok(finding);
  assert.equal(finding.level, "error");
});

test("runVerifiers flags CROSS_CITY_CONFLICT for same-day bouncing", () => {
  const planData = [visitDay(1, ["A", "B", "C"])];
  const dailyPlans = [{ day: 1, segments: [] }];
  const cityOf = (name) => (name === "B" ? "Y" : "X");
  const result = verifier.runVerifiers({ planData, dailyPlans, requestedDays: 1, cityOf });
  const finding = result.findings.find((f) => f.code === verifier.CODES.CROSS_CITY_CONFLICT);
  assert.ok(finding);
  assert.equal(finding.evidence.transitions, 2);
});

test("runVerifiers flags TOO_MANY_EMPTY_DAYS as warn (still non-pass)", () => {
  const planData = [visitDay(1, ["A"]), { day: 2, items: [] }];
  const dailyPlans = [
    { day: 1, segments: [{ type: "visit", visitDurationMin: 90 }] },
    { day: 2, segments: [] },
  ];
  const result = verifier.runVerifiers({ planData, dailyPlans, requestedDays: 2, cityOf: () => "X" });
  const finding = result.findings.find((f) => f.code === verifier.CODES.TOO_MANY_EMPTY_DAYS);
  assert.ok(finding);
  assert.equal(finding.level, "warn");
  // 仅有 warn 时无 error，pass 仍为 true（warn 不阻断收敛）
  assert.equal(result.pass, true);
});

test("countCrossCityTransitions counts city changes between neighbors", () => {
  const dayPlan = visitDay(1, ["A", "B", "C"]);
  const cityOf = (name) => (name === "C" ? "Z" : "X");
  assert.equal(verifier.countCrossCityTransitions(dayPlan, cityOf), 1);
});
