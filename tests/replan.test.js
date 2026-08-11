"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const replan = require("../replan.js");

function visit(title) {
  return { type: "visit", title: title, durationMin: 90 };
}

function samplePlan() {
  return [
    { day: 1, city: "X", items: [visit("A1"), visit("A2")] },
    { day: 2, city: "X", items: [visit("B1"), visit("B2"), visit("B3")] },
    { day: 3, city: "Y", items: [visit("C1")] },
    { day: 4, city: "Y", items: [visit("D1"), visit("D2")] },
  ];
}

const META = {
  a1: { city: "X", priority: "medium" },
  a2: { city: "X", priority: "medium" },
  b1: { city: "X", priority: "medium" },
  b2: { city: "X", priority: "medium" },
  b3: { city: "X", priority: "medium" },
  c1: { city: "Y", priority: "medium" },
  d1: { city: "Y", priority: "medium" },
  d2: { city: "Y", priority: "medium" },
};

function noTravel() {
  return null;
}

// ---- analyzeImpact ----

test("analyzeImpact: remove 影响所在天", () => {
  const affected = replan.analyzeImpact({ type: "remove_place", placeName: "B2" }, samplePlan());
  assert.deepEqual(affected, [2]);
});

test("analyzeImpact: move 影响源天 + 目标天（升序去重）", () => {
  const affected = replan.analyzeImpact({ type: "move_place", placeName: "A1", toDay: 3 }, samplePlan());
  assert.deepEqual(affected, [1, 3]);
});

test("analyzeImpact: move 到同一天只算一次", () => {
  const affected = replan.analyzeImpact({ type: "move_place", placeName: "A1", toDay: 1 }, samplePlan());
  assert.deepEqual(affected, [1]);
});

// ---- applyChange ----

test("applyChange: remove 从 planData 移除该点，不改入参", () => {
  const plan = samplePlan();
  const out = replan.applyChange(plan, { type: "remove_place", placeName: "B2" });
  const day2 = out.find((d) => d.day === 2);
  assert.deepEqual(day2.items.map((it) => it.title), ["B1", "B3"]);
  // 入参不被修改
  assert.equal(plan[1].items.length, 3);
});

test("applyChange: move 从源天移除、加入目标天", () => {
  const out = replan.applyChange(samplePlan(), { type: "move_place", placeName: "A1", toDay: 3 });
  const day1 = out.find((d) => d.day === 1);
  const day3 = out.find((d) => d.day === 3);
  assert.deepEqual(day1.items.map((it) => it.title), ["A2"]);
  assert.ok(day3.items.map((it) => it.title).indexOf("A1") >= 0);
});

// ---- incrementalReplan ----

test("incrementalReplan(remove): 未受影响天逐字节不变 + 复用率正确", () => {
  const plan = samplePlan();
  const res = replan.incrementalReplan({
    planData: plan,
    changeEvent: { type: "remove_place", placeName: "B2" },
    placeMetaMap: META,
    travelLookup: noTravel,
    strategy: "fastest",
  });
  // 4 天，受影响 1 天 → 复用 0.75
  assert.equal(res.affectedDays.length, 1);
  assert.ok(Math.abs(res.reusedRatio - 0.75) < 1e-9);
  // 未受影响天（1/3/4）与原始一致
  assert.deepEqual(res.planData[0], plan[0]);
  assert.deepEqual(res.planData[2], plan[2]);
  assert.deepEqual(res.planData[3], plan[3]);
  // 受影响天不再含 B2
  const day2 = res.planData.find((d) => d.day === 2);
  assert.ok(day2.items.map((it) => it.title).indexOf("B2") < 0);
  assert.equal(day2.items.length, 2);
});

test("incrementalReplan(move): 目标天获得该点、源天失去、其余天不变", () => {
  const plan = samplePlan();
  const res = replan.incrementalReplan({
    planData: plan,
    changeEvent: { type: "move_place", placeName: "A1", toDay: 3 },
    placeMetaMap: META,
    travelLookup: noTravel,
    strategy: "fastest",
  });
  assert.deepEqual(res.affectedDays, [1, 3]);
  assert.ok(Math.abs(res.reusedRatio - 0.5) < 1e-9);
  const day1 = res.planData.find((d) => d.day === 1);
  const day3 = res.planData.find((d) => d.day === 3);
  assert.ok(day1.items.map((it) => it.title).indexOf("A1") < 0);
  assert.ok(day3.items.map((it) => it.title).indexOf("A1") >= 0);
  // 未受影响天（2/4）不变
  assert.deepEqual(res.planData[1], plan[1]);
  assert.deepEqual(res.planData[3], plan[3]);
});

test("incrementalReplan: 全部景点集合守恒（remove 恰好少一个）", () => {
  const plan = samplePlan();
  const before = [];
  plan.forEach((d) => d.items.forEach((it) => before.push(it.title)));
  const res = replan.incrementalReplan({
    planData: plan,
    changeEvent: { type: "remove_place", placeName: "C1" },
    placeMetaMap: META,
    travelLookup: noTravel,
    strategy: "fastest",
  });
  const after = [];
  res.planData.forEach((d) => d.items.forEach((it) => after.push(it.title)));
  assert.equal(after.length, before.length - 1);
  assert.ok(after.indexOf("C1") < 0);
});

test("buildTravelLookupFromDailyPlans: 命中已知段（双向），未知返回 null", () => {
  const dailyPlans = [
    { day: 1, segments: [{ type: "transit", from: "A1", to: "A2", durationMin: 25 }] },
  ];
  const lookup = replan.buildTravelLookupFromDailyPlans(dailyPlans);
  assert.equal(lookup("A1", "A2"), 25);
  assert.equal(lookup("A2", "A1"), 25); // 反向也命中
  assert.equal(lookup("A1", "Z9"), null);
});
