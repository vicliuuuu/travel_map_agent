const test = require("node:test");
const assert = require("node:assert/strict");
const repair = require("../repair.js");
const verifier = require("../verifier.js");
const agentPlanner = require("../agent-planner.js");

function makeDay(day, titles) {
  return {
    day,
    city: "",
    items: titles.map((t) => ({ type: "visit", title: t, durationMin: 90 })),
  };
}

test("rescorePlanWithStrategy returns null without scoreOrder (no silent failure)", () => {
  const planData = [makeDay(1, ["A", "B"])];
  assert.equal(repair.rescorePlanWithStrategy(planData, {}), null);
});

test("strategy×repair linkage: swap_neighbor does not worsen least-transfer score (v1.4)", () => {
  // 同日城市交错 [X,Y,X]：least-transfer 下应更差；swap_neighbor 聚类为 [X,X,Y] 后不应更差。
  const meta = { a: { city: "X" }, b: { city: "Y" }, c: { city: "X" } };
  const scoreOrder = (order) =>
    agentPlanner.scoreRouteDetailed(
      agentPlanner.computeRouteMetrics(order, meta, () => null),
      "least-transfer"
    ).score;
  const context = {
    strategy: "least-transfer",
    cityOf: (name) => (meta[name.toLowerCase()] || {}).city || "",
    scoreOrder,
  };

  const planData = [makeDay(1, ["A", "B", "C"])];
  const before = repair.rescorePlanWithStrategy(planData, context);
  const repaired = repair.swapNeighbor(planData, { evidence: { day: 1 } }, context);
  const after = repair.rescorePlanWithStrategy(repaired.planData, context);

  assert.equal(typeof before === "number", true);
  assert.equal(typeof after === "number", true);
  // 修复后不破坏策略取向：策略分不升高（越低越好）。
  assert.equal(after <= before + 1e-9, true);
  // 且确实完成了聚类重排。
  assert.deepEqual(repaired.planData[0].items.map((i) => i.title), ["A", "C", "B"]);
});

test("splitDay moves the second half into a new day", () => {
  const planData = [makeDay(1, ["A", "B", "C", "D"])];
  const result = repair.splitDay(planData, { evidence: { day: 1 } }, {});
  assert.equal(result.planData.length, 2);
  assert.deepEqual(result.planData[0].items.map((i) => i.title), ["A", "B"]);
  assert.deepEqual(result.planData[1].items.map((i) => i.title), ["C", "D"]);
  assert.equal(result.planData[1].day, 2);
  // 原始数据不被修改（纯函数）
  assert.equal(planData.length, 1);
});

test("splitDay is a no-op when day has a single place", () => {
  const planData = [makeDay(1, ["A"])];
  const result = repair.splitDay(planData, { evidence: { day: 1 } }, {});
  assert.equal(result.planData.length, 1);
  assert.equal(result.changeLog.noop, true);
});

test("dropLowestPriority removes the lowest priority place", () => {
  const planData = [makeDay(1, ["高优", "低优", "中优"])];
  const context = {
    priorityOf: (name) => {
      if (name === "高优") return "high";
      if (name === "低优") return "low";
      return "medium";
    },
  };
  const result = repair.dropLowestPriority(planData, { evidence: {} }, context);
  const titles = result.planData[0].items.map((i) => i.title);
  assert.deepEqual(titles, ["高优", "中优"]);
  assert.deepEqual(result.changeLog.removed, ["低优"]);
});

test("swapNeighbor clusters same-city places together", () => {
  const planData = [makeDay(1, ["A", "B", "C"])];
  const context = {
    cityOf: (name) => (name === "B" ? "Y" : "X"),
  };
  const result = repair.swapNeighbor(planData, { evidence: { day: 1 } }, context);
  assert.deepEqual(result.planData[0].items.map((i) => i.title), ["A", "C", "B"]);
});

test("mergeDay removes an empty day and preserves places", () => {
  const planData = [makeDay(1, ["A", "B"]), makeDay(2, [])];
  const result = repair.mergeDay(planData, { evidence: { emptyDays: [2] } }, {});
  assert.equal(result.planData.length, 1);
  assert.deepEqual(result.planData[0].items.map((i) => i.title), ["A", "B"]);
});

test("advancePlace moves the closing-risk place to the front of its day (v1.5)", () => {
  const planData = [makeDay(1, ["A", "B", "C"])];
  const result = repair.advancePlace(planData, { evidence: { day: 1, place: "C" } }, {});
  assert.deepEqual(result.planData[0].items.map((i) => i.title), ["C", "A", "B"]);
  assert.deepEqual(result.changeLog.moved, ["C"]);
  // 纯函数：不修改原始数据
  assert.deepEqual(planData[0].items.map((i) => i.title), ["A", "B", "C"]);
});

test("advancePlace is a no-op when the place is already first", () => {
  const planData = [makeDay(1, ["A", "B"])];
  const result = repair.advancePlace(planData, { evidence: { day: 1, place: "A" } }, {});
  assert.equal(result.changeLog.noop, true);
});

test("applyRepair throws on unknown action (no silent failure)", () => {
  assert.throws(() => repair.applyRepair([], "no_such_action", {}, {}), /未知修复动作/);
});

test("chooseRepairAction routes OPENING_RISK to advance_place (v1.5)", () => {
  const opening = { code: verifier.CODES.OPENING_RISK, evidence: { day: 1, place: "B" } };
  const chosen = repair.chooseRepairAction([opening], {});
  assert.equal(chosen.action, "advance_place");
});

test("chooseRepairAction routes codes to actions by severity", () => {
  const overload = { code: verifier.CODES.TIME_OVERLOAD, evidence: { day: 1 } };
  const crossCity = { code: verifier.CODES.CROSS_CITY_CONFLICT, evidence: { day: 2 } };
  const context = { dayItemsCount: () => 3 };

  const chosen = repair.chooseRepairAction([crossCity, overload], context);
  assert.equal(chosen.action, "split_day");
  assert.equal(chosen.failure.code, verifier.CODES.TIME_OVERLOAD);

  const onlyCross = repair.chooseRepairAction([crossCity], context);
  assert.equal(onlyCross.action, "swap_neighbor");
});

test("chooseRepairAction drops instead of splitting when day has one place", () => {
  const overload = { code: verifier.CODES.TIME_OVERLOAD, evidence: { day: 1 } };
  const context = { dayItemsCount: () => 1 };
  const chosen = repair.chooseRepairAction([overload], context);
  assert.equal(chosen.action, "drop_lowest_priority");
});

test("shouldStopRepair stops at max rounds", () => {
  const stop = repair.shouldStopRepair({ round: 3, maxRounds: 3, scoreHistory: [10, 5], noImproveLimit: 2 });
  assert.equal(stop.stop, true);
  assert.equal(stop.reason, "max_rounds");
});

test("shouldStopRepair stops when there is no improvement", () => {
  const stop = repair.shouldStopRepair({ round: 1, maxRounds: 5, scoreHistory: [50, 50, 50], noImproveLimit: 2 });
  assert.equal(stop.stop, true);
  assert.equal(stop.reason, "no_improvement");
});

test("shouldStopRepair continues while improving", () => {
  const stop = repair.shouldStopRepair({ round: 1, maxRounds: 5, scoreHistory: [50, 40, 30], noImproveLimit: 2 });
  assert.equal(stop.stop, false);
});

test("noImprovement detects stagnation only past the limit", () => {
  assert.equal(repair.noImprovement([10, 10, 10], 2), true);
  assert.equal(repair.noImprovement([10, 8, 6], 2), false);
  assert.equal(repair.noImprovement([10, 10], 2), false);
});
