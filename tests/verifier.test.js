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

// ---- v1.5 校验层扩展 ----

test("computeArrivalTimeline accumulates transit + visit durations from day start", () => {
  const dayPlan = {
    day: 1,
    segments: [
      { type: "transit", durationMin: 30 },
      { type: "visit", placeName: "A", visitDurationMin: 120 },
      { type: "transit", durationMin: 40 },
      { type: "visit", placeName: "B", visitDurationMin: 90 },
    ],
  };
  const arrivals = verifier.computeArrivalTimeline(dayPlan, 9 * 60);
  assert.equal(arrivals.length, 2);
  assert.equal(arrivals[0].arrivalMin, 9 * 60 + 30); // 09:30
  assert.equal(arrivals[1].arrivalMin, 9 * 60 + 30 + 120 + 40); // 12:10
});

test("parseClockToMinutes handles HH:MM and numeric", () => {
  assert.equal(verifier.parseClockToMinutes("18:00"), 1080);
  assert.equal(verifier.parseClockToMinutes("09:30"), 570);
  assert.equal(verifier.parseClockToMinutes(600), 600);
  assert.equal(verifier.parseClockToMinutes(""), null);
});

test("computeArrivalTimeline uses conservative fallback for missing transit (not 0)", () => {
  const dayPlan = {
    day: 1,
    segments: [
      { type: "transit", durationMin: null }, // 缺失 → 兜底 30
      { type: "visit", placeName: "A", visitDurationMin: 60 },
      { type: "transit", durationMin: null }, // 缺失 → 兜底 30
      { type: "visit", placeName: "B", visitDurationMin: 60 },
    ],
  };
  const arrivals = verifier.computeArrivalTimeline(dayPlan, 9 * 60);
  assert.equal(arrivals[0].arrivalMin, 9 * 60 + 30); // 09:30，而不是 09:00
  assert.equal(arrivals[1].arrivalMin, 9 * 60 + 30 + 60 + 30); // 11:00
});

test("computeArrivalTimeline applies congestion factor in peak windows", () => {
  const dayPlan = {
    day: 1,
    segments: [
      { type: "transit", durationMin: 60 }, // 08:00 出发（早高峰）→ ×1.4 = 84
      { type: "visit", placeName: "A", visitDurationMin: 60 },
    ],
  };
  const withCong = verifier.computeArrivalTimeline(dayPlan, 8 * 60, { enabled: true });
  const noCong = verifier.computeArrivalTimeline(dayPlan, 8 * 60, { enabled: false });
  assert.equal(noCong[0].arrivalMin, 8 * 60 + 60);
  assert.equal(withCong[0].arrivalMin, 8 * 60 + 84);
});

test("getPhysicalPreset maps preferences to thresholds", () => {
  assert.deepEqual(verifier.getPhysicalPreset("easy"), { maxVisitMinutes: 300, maxVisits: 4 });
  assert.deepEqual(verifier.getPhysicalPreset("standard"), { maxVisitMinutes: 420, maxVisits: 6 });
  assert.deepEqual(verifier.getPhysicalPreset("hardcore"), { maxVisitMinutes: 540, maxVisits: 8 });
  assert.deepEqual(verifier.getPhysicalPreset("unknown"), { maxVisitMinutes: 420, maxVisits: 6 });
});

test("OPENING_RISK is inactive without openingHoursByPlace (backward compatible)", () => {
  const planData = [visitDay(1, ["A", "B"])];
  const dailyPlans = [
    { day: 1, segments: [
      { type: "visit", placeName: "A", visitDurationMin: 120 },
      { type: "transit", durationMin: 20 },
      { type: "visit", placeName: "B", visitDurationMin: 120 },
    ] },
  ];
  const res = verifier.runVerifiers({ planData, dailyPlans, requestedDays: 1, cityOf: () => "X" });
  assert.equal(res.findings.some((f) => f.code === verifier.CODES.OPENING_RISK), false);
});

test("OPENING_RISK flags verified closure conflict as error", () => {
  const planData = [visitDay(1, ["A", "B"])];
  // A 到达 09:00，游览 120 → B 到达约 11:20；B 闭馆 11:00 → 冲突。
  const dailyPlans = [
    { day: 1, segments: [
      { type: "visit", placeName: "A", visitDurationMin: 120 },
      { type: "transit", durationMin: 20 },
      { type: "visit", placeName: "B", visitDurationMin: 60 },
    ] },
  ];
  const res = verifier.runVerifiers({
    planData,
    dailyPlans,
    requestedDays: 1,
    cityOf: () => "X",
    checks: {
      dayStartMin: 9 * 60,
      openingHoursByPlace: {
        b: { open: "09:00", close: "11:00", verifyState: "verified" },
      },
    },
  });
  const finding = res.findings.find((f) => f.code === verifier.CODES.OPENING_RISK);
  assert.ok(finding);
  assert.equal(finding.level, "error");
  assert.equal(res.pass, false);
});

test("OPENING_RISK downgrades to warn when data unverified (not a hard fail)", () => {
  const planData = [visitDay(1, ["B"])];
  const dailyPlans = [
    { day: 1, segments: [
      { type: "transit", durationMin: 200 },
      { type: "visit", placeName: "B", visitDurationMin: 60 },
    ] },
  ];
  const res = verifier.runVerifiers({
    planData,
    dailyPlans,
    requestedDays: 1,
    cityOf: () => "X",
    checks: {
      dayStartMin: 9 * 60,
      openingHoursByPlace: {
        b: { open: "09:00", close: "11:00", verifyState: "unverified" },
      },
    },
  });
  const finding = res.findings.find((f) => f.code === verifier.CODES.OPENING_RISK);
  assert.ok(finding);
  assert.equal(finding.level, "warn");
  assert.equal(res.pass, true, "未核实的闭馆风险不应判硬失败");
});

test("PHYSICAL_OVERLOAD warns when daily visit minutes exceed threshold", () => {
  const planData = [visitDay(1, ["A", "B", "C"])];
  const dailyPlans = [
    { day: 1, segments: [
      { type: "visit", placeName: "A", visitDurationMin: 200 },
      { type: "visit", placeName: "B", visitDurationMin: 200 },
      { type: "visit", placeName: "C", visitDurationMin: 200 },
    ] },
  ];
  const res = verifier.runVerifiers({
    planData,
    dailyPlans,
    requestedDays: 1,
    cityOf: () => "X",
    checks: { physicalLoad: { enabled: true, maxVisitMinutes: 420 } },
  });
  const finding = res.findings.find((f) => f.code === verifier.CODES.PHYSICAL_OVERLOAD);
  assert.ok(finding);
  assert.equal(finding.level, "warn");
  assert.equal(res.pass, true);
});

test("HOTEL_RETURN_COST warns when round-trip ratio is too high", () => {
  const planData = [visitDay(1, ["A"])];
  const dailyPlans = [
    { day: 1, segments: [
      { type: "transit", from: "酒店", to: "A", durationMin: 90 },
      { type: "visit", placeName: "A", visitDurationMin: 60 },
      { type: "transit", from: "A", to: "酒店", durationMin: 90 },
    ] },
  ];
  const res = verifier.runVerifiers({
    planData,
    dailyPlans,
    lodging: { mode: "single", hotel: { name: "酒店" } },
    requestedDays: 1,
    cityOf: () => "X",
    checks: { hotelReturnCost: { enabled: true, maxRatio: 0.35 } },
  });
  const finding = res.findings.find((f) => f.code === verifier.CODES.HOTEL_RETURN_COST);
  assert.ok(finding);
  assert.equal(finding.level, "warn");
});
