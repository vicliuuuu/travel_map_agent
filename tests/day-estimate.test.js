"use strict";

// v1.6 天数估算（逐日装箱）+ 体力强度联动单日预算 的回归测试。
// 覆盖用户诉求：
//   1) 真实通勤/酒店往返/疲劳/时间冗余都进天数估算（不再单链 10h 写死）；
//   2) 单日预算随体力档位缩放（8/10/12h）+ 15% 冗余，体力强度真正影响「该排几天」。

const test = require("node:test");
const assert = require("node:assert");

const server = require("../server.js");
const verifier = require("../verifier.js");
const agentPlanner = require("../agent-planner.js");

function places(names) {
  return names.map(function (n) {
    return { name: n, suggestedDurationMin: 90 };
  });
}

// 统一构造 estimate 的注入项：城市映射 + 段内/跨城通勤 + 酒店往返（主酒店在 CPH）。
function makeOptions(cityMap, physicalCaps, slack) {
  return {
    physicalCaps: physicalCaps,
    slack: slack,
    cityOf: function (name) { return cityMap[name] || ""; },
    legMin: function (a, b) {
      return cityMap[a] && cityMap[b] && cityMap[a] !== cityMap[b] ? 45 : 20;
    },
    // 主酒店在 CPH：同城往返 15，跨城（马尔默）往返 50。
    hotelLegMin: function (name) {
      return cityMap[name] === "MAL" ? 50 : 15;
    },
  };
}

const STANDARD = verifier.getPhysicalPreset("standard"); // maxVisit 420 / maxVisits 6 / dayBudget 600
const EASY = verifier.getPhysicalPreset("easy");         // maxVisit 300 / maxVisits 4 / dayBudget 480
const SLACK = verifier.DAY_BUDGET_SLACK;                 // 0.85

test("estimateNaturalDaysAndSubset: 小负载同城行程 → 1 天", () => {
  const cityMap = { A: "CPH", B: "CPH", C: "CPH" };
  const est = server.estimateNaturalDaysAndSubset(
    places(["A", "B", "C"]),
    1,
    makeOptions(cityMap, STANDARD, SLACK)
  );
  assert.equal(est.naturalDays, 1);
});

test("estimateNaturalDaysAndSubset: 跨城 7 点(哥本哈根+马尔默) → 估 2 天（修复此前误判 1 天）", () => {
  const cityMap = {
    C1: "CPH", C2: "CPH", C3: "CPH", C4: "CPH",
    M1: "MAL", M2: "MAL", M3: "MAL",
  };
  const est = server.estimateNaturalDaysAndSubset(
    places(["C1", "C2", "C3", "C4", "M1", "M2", "M3"]),
    2,
    makeOptions(cityMap, STANDARD, SLACK)
  );
  // 7 点堆一天：疲劳后纯游玩 819 分钟 > 420 上限、且 7 > 6 个上限 → 1 天不可行；
  // 按城市软对齐切成 2 天后每天均可行 → naturalDays = 2。
  assert.equal(est.naturalDays, 2);
});

test("estimateNaturalDaysAndSubset: 体力强度真正影响天数（同一 4 点，标准=1 天 / 轻松=2 天）", () => {
  const cityMap = { A: "CPH", B: "CPH", C: "CPH", D: "CPH" };
  const list = places(["A", "B", "C", "D"]);

  const std = server.estimateNaturalDaysAndSubset(list, 1, makeOptions(cityMap, STANDARD, SLACK));
  assert.equal(std.naturalDays, 1); // 4 点疲劳后 414 ≤ 420、总 504 ≤ 510(600×0.85)

  const easy = server.estimateNaturalDaysAndSubset(list, 1, makeOptions(cityMap, EASY, SLACK));
  assert.equal(easy.naturalDays, 2); // 轻松档 maxVisit 300：414 > 300 → 1 天不可行，需 2 天
});

test("estimateNaturalDaysAndSubset: reqDays 内容不下时 compactPlaces 丢弃溢出点", () => {
  const cityMap = { A: "CPH", B: "CPH", C: "CPH", D: "CPH", E: "CPH" };
  const est = server.estimateNaturalDaysAndSubset(
    places(["A", "B", "C", "D", "E"]),
    1, // 只给 1 天、轻松档：一天装不下 5 个点
    makeOptions(cityMap, EASY, SLACK)
  );
  assert.ok(est.compactPlaces.length >= 1);
  assert.ok(est.droppedPlaces.length >= 1);
  assert.equal(est.compactPlaces.length + est.droppedPlaces.length, 5);
});

test("makeHybridLegMin: 真实通勤优先，缺失回退 haversine，再兜底", () => {
  const coords = {
    p1: { lat: 55.6761, lng: 12.5683 }, // Copenhagen
    p2: { lat: 55.6050, lng: 13.0038 }, // Malmö
  };
  const travelLookup = function (a, b) {
    return a === "p1" && b === "p2" ? 33 : null;
  };
  const coordOf = function (name) { return coords[name] || null; };
  const legMin = server.makeHybridLegMin(travelLookup, coordOf, 30);

  assert.equal(legMin("p1", "p2"), 33); // 命中真实缓存
  const back = legMin("p2", "p1"); // 无缓存 → haversine
  assert.ok(back > 0 && back !== 33);
  assert.equal(legMin("x", "y"), 30); // 无缓存无坐标 → 兜底
});

test("evaluateTimeFeasibility: 单日预算可注入并按 slack 缩放", () => {
  const dailyPlans = [
    { day: 1, segments: [
      { type: "visit", visitDurationMin: 300 },
      { type: "transit", durationMin: 60 },
      { type: "visit", visitDurationMin: 150 },
    ] },
  ];
  // 疲劳后：300 + 150×1.1 = 465，+60 通勤 = 525 分钟。
  const under600 = agentPlanner.evaluateTimeFeasibility(dailyPlans, 1); // 默认 600、无 buffer
  assert.equal(under600.feasible, true);

  const easyBudget = agentPlanner.evaluateTimeFeasibility(dailyPlans, 1, { dayBudgetMin: 480, slack: 1 });
  assert.equal(easyBudget.feasible, false); // 525 > 480

  const withSlack = agentPlanner.evaluateTimeFeasibility(dailyPlans, 1, { dayBudgetMin: 600, slack: 0.85 });
  assert.equal(withSlack.feasible, false); // 525 > 510(600×0.85)
});

test("runVerifiers: TIME_OVERLOAD 使用 checks.dayBudgetMin/slack", () => {
  const planData = [{ day: 1, city: "X", items: [{ type: "visit", title: "A" }] }];
  const dailyPlans = [
    { day: 1, segments: [
      { type: "visit", visitDurationMin: 300 },
      { type: "transit", durationMin: 60 },
      { type: "visit", visitDurationMin: 150 },
    ] },
  ];
  // 525 分钟：600 预算下不超载，480 预算（轻松档）下超载。
  const std = verifier.runVerifiers({
    planData, dailyPlans, requestedDays: 1, cityOf: () => "X",
    checks: { dayBudgetMin: 600, dayBudgetSlack: 1 },
  });
  assert.ok(!std.findings.some((f) => f.code === verifier.CODES.TIME_OVERLOAD));

  const easy = verifier.runVerifiers({
    planData, dailyPlans, requestedDays: 1, cityOf: () => "X",
    checks: { dayBudgetMin: 480, dayBudgetSlack: 1 },
  });
  const finding = easy.findings.find((f) => f.code === verifier.CODES.TIME_OVERLOAD);
  assert.ok(finding);
  assert.equal(finding.evidence.budgetMinutes, 480);
});
