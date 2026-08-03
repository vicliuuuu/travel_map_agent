const test = require("node:test");
const assert = require("node:assert/strict");
const agentPlanner = require("../agent-planner.js");

test("applyAgentInsights merges duration and priority", () => {
  const places = [
    { name: "故宫", address: "北京", score: 4.0 },
    { name: "景山公园", address: "北京", score: 4.0 },
  ];

  const enriched = agentPlanner.applyAgentInsights(
    places,
    [
      { name: "故宫", suggestedDurationMin: 240, priority: "high", reason: "展区大" },
      { name: "景山公园", suggestedDurationMin: 60, priority: "low", reason: "停留短" },
    ],
    []
  );

  assert.equal(enriched[0].suggestedDurationMin, 240);
  assert.equal(enriched[0].score, 4.9);
  assert.equal(enriched[1].score, 3.9);
});

test("sortByRecommendedOrder reorders places by model output", () => {
  const places = [
    { name: "A" },
    { name: "B" },
    { name: "C" },
  ];

  const sorted = agentPlanner.sortByRecommendedOrder(places, ["C", "A"]);
  assert.deepEqual(sorted.map((item) => item.name), ["C", "A", "B"]);
});

test("buildPlanDataFromOrder creates visit items for map rendering", () => {
  const places = [
    { name: "A", address: "addr-a" },
    { name: "B", address: "addr-b" },
  ];
  const planData = agentPlanner.buildPlanDataFromOrder(["B", "A"], places, "Paris", 1);
  assert.equal(planData.length, 1);
  assert.deepEqual(
    planData[0].items.map((item) => item.title),
    ["B", "A"]
  );
});

test("buildDailyPlansFromRoadbook adds hotel round-trip segments", () => {
  const dailyPlans = agentPlanner.buildDailyPlansFromRoadbook(
    [
      {
        step: 1,
        placeName: "故宫",
        visitTimeRange: "2-3小时",
        visitDurationMin: 150,
        travelToNext: {
          destination: "天坛",
          durationRange: "约30分钟",
          durationMin: 30,
        },
      },
      {
        step: 2,
        placeName: "天坛",
        visitTimeRange: "1-2小时",
        visitDurationMin: 90,
      },
    ],
    {
      mode: "single",
      hotel: { name: "北京饭店", checkInDate: "2026-08-01" },
    },
    1
  );

  assert.equal(dailyPlans.length, 1);
  assert.equal(dailyPlans[0].segments[0].from, "北京饭店");
  assert.equal(dailyPlans[0].segments[dailyPlans[0].segments.length - 1].to, "北京饭店");
});

test("evaluateTimeFeasibility detects overload days", () => {
  const result = agentPlanner.evaluateTimeFeasibility(
    [
      {
        day: 1,
        segments: [
          { type: "transit", durationMin: 90 },
          { type: "visit", visitDurationMin: 360 },
          { type: "transit", durationMin: 90 },
          { type: "visit", visitDurationMin: 180 },
        ],
      },
    ],
    1
  );

  assert.equal(result.feasible, false);
  assert.equal(result.suggestedDays >= 2, true);
});

test("buildDailyPlansFromPlanData keeps visits and hotel loop", () => {
  const dailyPlans = agentPlanner.buildDailyPlansFromPlanData(
    [
      {
        day: 1,
        items: [
          { type: "visit", title: "小美人鱼", durationMin: 90 },
          { type: "visit", title: "市政厅", durationMin: 120 },
        ],
      },
    ],
    {
      mode: "single",
      hotel: { name: "Blue House", checkInDate: "2026-09-06" },
    },
    1
  );

  assert.equal(dailyPlans.length, 1);
  const segs = dailyPlans[0].segments;
  assert.equal(segs[0].type, "transit");
  assert.equal(segs[0].from, "Blue House");
  assert.equal(segs[segs.length - 1].to, "Blue House");
});
