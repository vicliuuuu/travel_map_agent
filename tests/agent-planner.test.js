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

test("buildPlanDataFromOrder keeps clustered order contiguous per day (OI-1)", () => {
  // 顺序已按城市聚类：哥本哈根两点在前，马尔默两点在后。
  const places = [
    { name: "小美人鱼" },
    { name: "市政厅" },
    { name: "马尔默竞技场" },
    { name: "利姆港" },
  ];
  const order = ["小美人鱼", "市政厅", "马尔默竞技场", "利姆港"];
  const planData = agentPlanner.buildPlanDataFromOrder(order, places, "哥本哈根", 2);
  assert.equal(planData.length, 2);
  // 连续分块：同城景点必须落在同一天，而非被轮询打散到两天。
  assert.deepEqual(
    planData[0].items.map((item) => item.title),
    ["小美人鱼", "市政厅"]
  );
  assert.deepEqual(
    planData[1].items.map((item) => item.title),
    ["马尔默竞技场", "利姆港"]
  );
});

test("buildPlanDataFromOrder splits unevenly with remainder front-loaded", () => {
  const places = ["A", "B", "C", "D", "E"].map((name) => ({ name }));
  const order = ["A", "B", "C", "D", "E"];
  const planData = agentPlanner.buildPlanDataFromOrder(order, places, "City", 2);
  // 5 点 / 2 天 → 前一天 3 个（余数前置），后一天 2 个，且各自连续。
  assert.deepEqual(
    planData[0].items.map((item) => item.title),
    ["A", "B", "C"]
  );
  assert.deepEqual(
    planData[1].items.map((item) => item.title),
    ["D", "E"]
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
  assert.equal(dailyPlans[0].closedLoop, true);
});

test("buildDailyPlansFromPlanData fills transit durations from lookups", () => {
  const dailyPlans = agentPlanner.buildDailyPlansFromPlanData(
    [
      {
        day: 1,
        items: [
          { type: "visit", title: "哥本哈根市政厅", durationMin: 90 },
          { type: "visit", title: "马尔默竞技场", durationMin: 120 },
        ],
      },
    ],
    null,
    1,
    {
      travelLookup: () => 20,
      transitLookup: (from, to) => {
        if (from === "哥本哈根市政厅" && to === "马尔默竞技场") {
          return {
            totalDurationMin: 72,
            legs: [
              { type: "walk", durationMin: 12 },
              { type: "train", line: "Öresundståg", from: "København H", to: "Malmö C", durationMin: 36 },
              { type: "walk", durationMin: 24 },
            ],
          };
        }
        return null;
      },
    }
  );

  const transitSeg = dailyPlans[0].segments.find(
    (seg) => seg.type === "transit" && seg.from === "哥本哈根市政厅"
  );
  assert.equal(transitSeg.durationMin, 72);
  assert.equal(transitSeg.mode, "transit");
  assert.equal(Array.isArray(transitSeg.legs), true);
  assert.equal(transitSeg.legs.length, 3);
});

test("verifyHotelClosure flags open days", () => {
  const openResult = agentPlanner.verifyHotelClosure(
    [
      {
        day: 1,
        segments: [
          { type: "visit", placeName: "A" },
          { type: "transit", from: "A", to: "酒店" },
        ],
      },
    ],
    { mode: "single", hotel: { name: "酒店" } }
  );
  assert.equal(openResult.closed, false);
  assert.deepEqual(openResult.openDays, [1]);

  const closedResult = agentPlanner.verifyHotelClosure(
    [
      {
        day: 1,
        segments: [
          { type: "transit", from: "酒店", to: "A" },
          { type: "visit", placeName: "A" },
          { type: "transit", from: "A", to: "酒店" },
        ],
      },
    ],
    { mode: "single", hotel: { name: "酒店" } }
  );
  assert.equal(closedResult.closed, true);
});

test("getStrategyTemplate falls back to fastest", () => {
  assert.equal(agentPlanner.getStrategyTemplate("unknown").id, "fastest");
  assert.equal(agentPlanner.getStrategyTemplate("least-transfer").id, "least-transfer");
  assert.equal(agentPlanner.listStrategyTemplates().length, 3);
});

test("computeRouteMetrics counts cross-city and backtrack", () => {
  const meta = {
    a: { city: "Copenhagen" },
    b: { city: "Malmo" },
    c: { city: "Copenhagen" },
  };
  const metrics = agentPlanner.computeRouteMetrics(["A", "B", "C"], meta, () => null);
  assert.equal(metrics.crossCityCount, 2);
  assert.equal(metrics.backtrackCount, 1);
  assert.equal(metrics.placeCount, 3);
});

test("chooseBestOrder prefers fewer cross-city under least-transfer", () => {
  const meta = {
    a: { city: "X" },
    b: { city: "Y" },
    c: { city: "X" },
  };
  const chosen = agentPlanner.chooseBestOrder(
    [
      { source: "llm", order: ["A", "B", "C"] },
      { source: "greedy", order: ["A", "C", "B"] },
    ],
    meta,
    () => null,
    "least-transfer"
  );
  assert.deepEqual(chosen.order, ["A", "C", "B"]);
  assert.equal(chosen.metrics.crossCityCount, 1);
});

test("buildGreedyOrder clusters same-city places for least-transfer", () => {
  const meta = {
    a: { city: "X" },
    b: { city: "Y" },
    c: { city: "X" },
  };
  const order = agentPlanner.buildGreedyOrder(["A", "B", "C"], meta, () => null, "least-transfer");
  assert.equal(order[0], "A");
  assert.equal(order[1], "C");
  assert.equal(order[2], "B");
});

test("parseTransitLegs extracts walk and transit legs", () => {
  const parsed = agentPlanner.parseTransitLegs({
    routes: [
      {
        legs: [
          {
            duration: { value: 72 * 60 },
            steps: [
              { travel_mode: "WALKING", duration: { value: 12 * 60 } },
              {
                travel_mode: "TRANSIT",
                duration: { value: 36 * 60 },
                transit_details: {
                  line: { short_name: "Öresundståg", vehicle: { type: "TRAIN" } },
                  departure_stop: { name: "København H" },
                  arrival_stop: { name: "Malmö C" },
                },
              },
              { travel_mode: "WALKING", duration: { value: 24 * 60 } },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(parsed.totalDurationMin, 72);
  assert.equal(parsed.legs.length, 3);
  assert.equal(parsed.legs[1].type, "train");
  assert.equal(parsed.legs[1].line, "Öresundståg");
  assert.equal(parsed.legs[1].from, "København H");
  assert.equal(parsed.legs[1].to, "Malmö C");
});
