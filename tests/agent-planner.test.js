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

test("clusterOrderByCity groups same-city contiguously, fixing OI-1 for any strategy (v1.4)", () => {
  // fastest 策略可能给出「城市交错」的顺序（哥→马→哥→马），聚类后应同城连续。
  const meta = {
    "小美人鱼": { city: "Copenhagen" },
    "马尔默竞技场": { city: "Malmo" },
    "市政厅": { city: "Copenhagen" },
    "利姆港": { city: "Malmo" },
  };
  const interleaved = ["小美人鱼", "马尔默竞技场", "市政厅", "利姆港"];
  const clustered = agentPlanner.clusterOrderByCity(interleaved, meta);
  // 首次出现的城市顺序：Copenhagen 在前、Malmo 在后；城内保留相对次序。
  assert.deepEqual(clustered, ["小美人鱼", "市政厅", "马尔默竞技场", "利姆港"]);
});

test("cluster-then-assign yields zero same-day cross-city (OI-1 root fix, v1.4)", () => {
  const meta = {
    "小美人鱼": { city: "Copenhagen" },
    "马尔默竞技场": { city: "Malmo" },
    "市政厅": { city: "Copenhagen" },
    "利姆港": { city: "Malmo" },
  };
  const interleaved = ["小美人鱼", "马尔默竞技场", "市政厅", "利姆港"];
  const clustered = agentPlanner.clusterOrderByCity(interleaved, meta);
  const places = clustered.map((name) => ({ name }));
  const planData = agentPlanner.buildPlanDataFromOrder(clustered, places, "", 2);
  const daily = agentPlanner.computeDailyMetrics(planData, meta, () => null);
  // Day1 全哥本哈根、Day2 全马尔默 → 同日跨城为 0。
  assert.equal(daily.totalCrossCityWithinDay, 0);
  assert.deepEqual(planData[0].items.map((i) => i.title), ["小美人鱼", "市政厅"]);
  assert.deepEqual(planData[1].items.map((i) => i.title), ["马尔默竞技场", "利姆港"]);
});

test("clusterOrderByCity is a no-op without city info (keeps old behavior)", () => {
  const order = ["A", "B", "C", "D"];
  assert.deepEqual(agentPlanner.clusterOrderByCity(order, {}), order);
});

test("computeDailyMetrics counts within-day cross-city only", () => {
  const meta = { a: { city: "X" }, b: { city: "Y" }, c: { city: "X" } };
  const planData = [
    { day: 1, items: [{ type: "visit", title: "A" }, { type: "visit", title: "B" }] },
    { day: 2, items: [{ type: "visit", title: "C" }] },
  ];
  const daily = agentPlanner.computeDailyMetrics(planData, meta, () => null);
  // Day1 A(X)→B(Y) 1 次同日跨城；Day2 单点 0 次。天与天之间不计。
  assert.equal(daily.totalCrossCityWithinDay, 1);
  assert.deepEqual(daily.crossCityByDay, [{ day: 1, crossCity: 1 }, { day: 2, crossCity: 0 }]);
});

test("buildPriorityOrder sorts high→low stably (v1.4)", () => {
  const meta = {
    a: { priority: "low" },
    b: { priority: "high" },
    c: { priority: "medium" },
    d: { priority: "high" },
  };
  // 高优先级 B、D 提前且保留原始先后；medium C 次之；low A 最后。
  const order = agentPlanner.buildPriorityOrder(["A", "B", "C", "D"], meta);
  assert.deepEqual(order, ["B", "D", "C", "A"]);
});

test("generateCandidateOrders dedups and stays within K (v1.4)", () => {
  const meta = {
    a: { city: "X", priority: "high" },
    b: { city: "Y", priority: "low" },
    c: { city: "X", priority: "medium" },
  };
  const candidates = agentPlanner.generateCandidateOrders(
    ["A", "B", "C"],
    meta,
    () => null,
    "least-transfer",
    { K: 20 }
  );
  // 至少包含 llm 基准候选。
  assert.equal(candidates.some((c) => c.source === "llm"), true);
  // 所有候选都必须覆盖全部 3 个景点（同集合不同序，不丢点）。
  candidates.forEach((c) => {
    assert.equal(c.order.length, 3);
    assert.deepEqual([...c.order].sort(), ["A", "B", "C"]);
  });
  // 去重：不存在两个顺序完全相同的候选。
  const sigs = candidates.map((c) => agentPlanner.orderSignature(c.order));
  assert.equal(new Set(sigs).size, sigs.length);
  // 受控：不超过 K。
  assert.equal(candidates.length <= 20, true);
});

test("generateCandidateOrders respects small K cap (v1.4)", () => {
  const meta = { a: { city: "X" }, b: { city: "Y" }, c: { city: "Z" }, d: { city: "W" } };
  const candidates = agentPlanner.generateCandidateOrders(
    ["A", "B", "C", "D"],
    meta,
    () => null,
    "fastest",
    { K: 2 }
  );
  assert.equal(candidates.length <= 2, true);
});

test("chooseBestOrder exposes breakdown and secondBest (v1.4)", () => {
  const meta = { a: { city: "X" }, b: { city: "Y" }, c: { city: "X" } };
  const chosen = agentPlanner.chooseBestOrder(
    [
      { source: "llm", order: ["A", "B", "C"] },
      { source: "greedy", order: ["A", "C", "B"] },
    ],
    meta,
    () => null,
    "least-transfer"
  );
  assert.equal(typeof chosen.breakdown === "object" && chosen.breakdown !== null, true);
  assert.equal(chosen.secondBest !== null, true);
  assert.equal(chosen.secondBest.cost >= chosen.cost, true);
  assert.equal(Array.isArray(chosen.candidates), true);
});

test("buildStrategyExplanationDetail explains why chosen beats second best (v1.4)", () => {
  const meta = { a: { city: "X" }, b: { city: "Y" }, c: { city: "X" } };
  const chosen = agentPlanner.chooseBestOrder(
    [
      { source: "llm", order: ["A", "B", "C"] },
      { source: "greedy", order: ["A", "C", "B"] },
    ],
    meta,
    () => null,
    "least-transfer"
  );
  const detail = agentPlanner.buildStrategyExplanationDetail("least-transfer", chosen);
  assert.equal(detail.strategy, "least-transfer");
  assert.equal(detail.secondBest !== null, true);
  assert.equal(detail.scoreGap >= 0, true);
  assert.equal(typeof detail.reason === "string" && detail.reason.length > 0, true);
  assert.equal(detail.chosenBreakdown !== null, true);
});

test("buildStrategyExplanationDetail handles single candidate gracefully (v1.4)", () => {
  const detail = agentPlanner.buildStrategyExplanationDetail("fastest", {
    source: "llm",
    order: ["A"],
    cost: 1.23,
    breakdown: { travel: 1.23, crossCity: 0, backtrack: 0, priority: 0 },
    secondBest: null,
  });
  assert.equal(detail.secondBest, null);
  assert.equal(detail.scoreGap, null);
  assert.equal(detail.reason.includes("单一候选"), true);
});

test("compareStrategies returns primary=user strategy and a contrasting runner-up (v1.4)", () => {
  const meta = {
    a: { city: "X", priority: "low" },
    b: { city: "Y", priority: "high" },
    c: { city: "X", priority: "medium" },
  };
  const candidates = agentPlanner.generateCandidateOrders(["A", "B", "C"], meta, () => null, "least-transfer", { K: 20 });
  const cmp = agentPlanner.compareStrategies(candidates, meta, () => null, "least-transfer");
  assert.equal(cmp.primary.strategy, "least-transfer");
  assert.equal(Array.isArray(cmp.primary.order), true);
  if (cmp.runnerUp) {
    // 次优策略必须是其他策略，且顺序与主方案不同。
    assert.notEqual(cmp.runnerUp.strategy, "least-transfer");
    assert.notEqual(
      agentPlanner.orderSignature(cmp.runnerUp.order),
      agentPlanner.orderSignature(cmp.primary.order)
    );
    assert.equal(typeof cmp.runnerUp.tradeoff === "string", true);
  }
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
