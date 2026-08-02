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
