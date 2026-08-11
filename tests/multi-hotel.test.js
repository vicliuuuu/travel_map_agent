"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const agentPlanner = require("../agent-planner.js");

function lodgingMulti(hotels) {
  return { mode: hotels.length > 1 ? "multi" : "single", hotel: hotels[0], hotels: hotels };
}

function planDays(count) {
  const arr = [];
  for (let i = 0; i < count; i += 1) {
    arr.push({ day: i + 1, items: [{ type: "visit", title: "P" + (i + 1), durationMin: 90 }] });
  }
  return arr;
}

// ---- buildDayHotelMap ----

test("buildDayHotelMap: 无酒店 → 全部 hotel=null", () => {
  const map = agentPlanner.buildDayHotelMap(null, 3);
  assert.equal(map.days.length, 3);
  assert.ok(map.days.every((d) => d.hotel === null));
  assert.deepEqual(map.gapDays, []);
  assert.equal(map.hasDates, false);
});

test("buildDayHotelMap: 单酒店 → 全程覆盖，日期从入住日起算（兼容旧行为）", () => {
  const lodging = lodgingMulti([
    { name: "H", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-02" },
  ]);
  const map = agentPlanner.buildDayHotelMap(lodging, 3);
  assert.equal(map.days.length, 3);
  assert.ok(map.days.every((d) => d.hotel && d.hotel.name === "H"));
  assert.equal(map.days[0].date, "2026-08-01");
  assert.equal(map.days[2].date, "2026-08-03");
  assert.deepEqual(map.gapDays, []);
});

test("buildDayHotelMap: 多酒店按日期覆盖 + 换酒店日记 changeFrom", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-03" },
    { name: "B", address: "", checkInDate: "2026-08-03", checkOutDate: "2026-08-05" },
  ]);
  const map = agentPlanner.buildDayHotelMap(lodging, 4);
  assert.equal(map.days[0].hotel.name, "A");
  assert.equal(map.days[1].hotel.name, "A");
  assert.equal(map.days[2].hotel.name, "B"); // 换酒店日算新酒店
  assert.equal(map.days[2].changeFrom.name, "A");
  assert.equal(map.days[3].hotel.name, "B");
  assert.deepEqual(map.gapDays, []);
});

test("buildDayHotelMap: 空档日进入 gapDays", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-02" },
    { name: "B", address: "", checkInDate: "2026-08-04", checkOutDate: "2026-08-05" },
  ]);
  const map = agentPlanner.buildDayHotelMap(lodging, 4);
  assert.equal(map.days[0].hotel.name, "A");
  assert.equal(map.days[1].hotel, null);
  assert.equal(map.days[2].hotel, null);
  assert.equal(map.days[3].hotel.name, "B");
  assert.deepEqual(map.gapDays, [2, 3]);
});

// ---- buildDailyPlansFromPlanData ----

test("buildDailyPlansFromPlanData: 多酒店每日按当天酒店闭环", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-03" },
    { name: "B", address: "", checkInDate: "2026-08-03", checkOutDate: "2026-08-05" },
  ]);
  const dp = agentPlanner.buildDailyPlansFromPlanData(planDays(4), lodging, 4, {});
  // day1 首段从 A 出发，末段回 A
  assert.equal(dp[0].hotelName, "A");
  assert.equal(dp[0].segments[0].from, "A");
  assert.equal(dp[0].segments[dp[0].segments.length - 1].to, "A");
  assert.equal(dp[0].closedLoop, true);
  // day4 闭环到 B
  assert.equal(dp[3].hotelName, "B");
  assert.equal(dp[3].segments[dp[3].segments.length - 1].to, "B");
  assert.equal(dp[3].closedLoop, true);
});

test("buildDailyPlansFromPlanData: 换酒店日首段为行李转移腿（旧→新）", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-03" },
    { name: "B", address: "", checkInDate: "2026-08-03", checkOutDate: "2026-08-05" },
  ]);
  const dp = agentPlanner.buildDailyPlansFromPlanData(planDays(4), lodging, 4, {});
  const day3 = dp[2];
  assert.equal(day3.hotelName, "B");
  assert.equal(day3.changeFromHotel, "A");
  const first = day3.segments[0];
  assert.equal(first.type, "transit");
  assert.equal(first.luggageTransfer, true);
  assert.equal(first.from, "A");
  assert.equal(first.to, "B");
  // 行李转移后，游览首段从新酒店 B 出发，末段回 B，仍闭环
  assert.equal(day3.segments[1].from, "B");
  assert.equal(day3.segments[day3.segments.length - 1].to, "B");
  assert.equal(day3.closedLoop, true);
});

test("buildDailyPlansFromPlanData: 空档日退化无酒店闭环（无首尾腿）", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-02" },
    { name: "B", address: "", checkInDate: "2026-08-04", checkOutDate: "2026-08-05" },
  ]);
  const dp = agentPlanner.buildDailyPlansFromPlanData(planDays(4), lodging, 4, {});
  // day2 空档：无酒店名、首段不是从酒店出发（第一段应为 visit）
  assert.equal(dp[1].hotelName, "");
  assert.equal(dp[1].segments[0].type, "visit");
});

test("buildDailyPlansFromPlanData: 单酒店保持旧行为（全程闭环到该酒店）", () => {
  const lodging = lodgingMulti([
    { name: "H", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-03" },
  ]);
  const dp = agentPlanner.buildDailyPlansFromPlanData(planDays(3), lodging, 3, {});
  assert.ok(dp.every((d) => d.hotelName === "H"));
  assert.ok(dp.every((d) => d.segments[0].from === "H"));
  assert.ok(dp.every((d) => d.segments[d.segments.length - 1].to === "H"));
});

// ---- verifyHotelClosure ----

test("verifyHotelClosure: 多酒店按当天酒店判定，全部闭环时 closed=true", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-03" },
    { name: "B", address: "", checkInDate: "2026-08-03", checkOutDate: "2026-08-05" },
  ]);
  const dp = agentPlanner.buildDailyPlansFromPlanData(planDays(4), lodging, 4, {});
  const res = agentPlanner.verifyHotelClosure(dp, lodging);
  assert.equal(res.closed, true);
  assert.deepEqual(res.openDays, []);
});

test("verifyHotelClosure: 无酒店直接视为闭环通过", () => {
  const res = agentPlanner.verifyHotelClosure([{ day: 1, segments: [] }], null);
  assert.equal(res.closed, true);
});

// ---- validateLodging ----

test("validateLodging: 离店早于/等于入住 → error", () => {
  const lodging = lodgingMulti([
    { name: "H", address: "", checkInDate: "2026-08-03", checkOutDate: "2026-08-01" },
  ]);
  const res = agentPlanner.validateLodging(lodging, 2);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /离店日期须晚于入住日期/);
});

test("validateLodging: 区间重叠 → warning", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-04" },
    { name: "B", address: "", checkInDate: "2026-08-02", checkOutDate: "2026-08-05" },
  ]);
  const res = agentPlanner.validateLodging(lodging, 4);
  assert.ok(res.warnings.some((w) => /区间重叠/.test(w)));
});

test("validateLodging: 空档日 → warning", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-02" },
    { name: "B", address: "", checkInDate: "2026-08-04", checkOutDate: "2026-08-05" },
  ]);
  const res = agentPlanner.validateLodging(lodging, 4);
  assert.ok(res.warnings.some((w) => /没有酒店覆盖/.test(w)));
});

test("validateLodging: 相邻衔接（离店日==下一家入住日）不算重叠", () => {
  const lodging = lodgingMulti([
    { name: "A", address: "", checkInDate: "2026-08-01", checkOutDate: "2026-08-03" },
    { name: "B", address: "", checkInDate: "2026-08-03", checkOutDate: "2026-08-05" },
  ]);
  const res = agentPlanner.validateLodging(lodging, 4);
  assert.equal(res.errors.length, 0);
  assert.ok(!res.warnings.some((w) => /区间重叠/.test(w)));
});
