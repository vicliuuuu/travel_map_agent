const test = require("node:test");
const assert = require("node:assert/strict");
const scoring = require("../scoring.js");

test("normalizeMetrics clamps all cost terms into [0,1]", () => {
  const norm = scoring.normalizeMetrics({
    totalTravelMin: 100000,
    crossCityCount: 999,
    backtrackCount: 999,
    priorityScore: 100000,
    placeCount: 3,
  });
  ["travel", "crossCity", "backtrack", "priority"].forEach((key) => {
    assert.equal(norm[key] >= 0 && norm[key] <= 1, true, key + " out of [0,1]");
  });
});

test("normalizeMetrics: cross-city fraction over legs", () => {
  // 3 个点 → 2 段；2 段全跨城 → crossCity 归一化为 1。
  const norm = scoring.normalizeMetrics({
    totalTravelMin: 0,
    crossCityCount: 2,
    backtrackCount: 1,
    priorityScore: 0,
    placeCount: 3,
  });
  assert.equal(norm.crossCity, 1);
  assert.equal(norm.backtrack, 0.5);
});

test("normalizeMetrics: all-medium priority hit-rate ≈ 0.667", () => {
  // 3 个 medium 点、priorityScore=(n+1)=4，maxPriorityScore=3*(n+1)/2=6 → 命中率 2/3。
  const norm = scoring.normalizeMetrics({
    totalTravelMin: 0,
    crossCityCount: 0,
    backtrackCount: 0,
    priorityScore: 4,
    placeCount: 3,
  });
  assert.equal(Math.abs(norm.priority - 2 / 3) < 1e-9, true);
});

test("scoreMetrics: priority counts as a reduction (higher priority → lower score)", () => {
  const base = { totalTravelMin: 60, crossCityCount: 1, backtrackCount: 0, priorityScore: 4, placeCount: 3 };
  const weights = { travel: 0.5, crossCity: 0.5, backtrack: 0.5, priority: 1.0 };
  const low = scoring.scoreMetrics(Object.assign({}, base, { priorityScore: 2 }), weights);
  const high = scoring.scoreMetrics(Object.assign({}, base, { priorityScore: 6 }), weights);
  assert.equal(high.score < low.score, true);
  assert.equal(high.breakdown.priority < 0, true);
});

test("scoreMetrics: breakdown sums to score", () => {
  const detail = scoring.scoreMetrics(
    { totalTravelMin: 120, crossCityCount: 1, backtrackCount: 1, priorityScore: 3, placeCount: 3 },
    { travel: 0.4, crossCity: 0.6, backtrack: 0.3, priority: 0.2 }
  );
  const sum =
    detail.breakdown.travel +
    detail.breakdown.crossCity +
    detail.breakdown.backtrack +
    detail.breakdown.priority;
  assert.equal(Math.abs(sum - detail.score) < 1e-9, true);
});

test("applyTransportPreference: driving is a no-op, walking/transit amplify (v1.4 P2)", () => {
  const agentPlanner = require("../agent-planner.js");
  const base = { travel: 0.5, crossCity: 0.6, backtrack: 0.3, priority: 0.2 };
  const driving = agentPlanner.applyTransportPreference(base, "driving");
  assert.deepEqual(driving, base);
  const unknown = agentPlanner.applyTransportPreference(base, undefined);
  assert.deepEqual(unknown, base);
  const walking = agentPlanner.applyTransportPreference(base, "walking");
  assert.equal(walking.travel > base.travel, true);
  assert.equal(walking.crossCity > base.crossCity, true);
  const transit = agentPlanner.applyTransportPreference(base, "transit");
  assert.equal(transit.crossCity > base.crossCity, true);
  assert.equal(transit.travel, base.travel);
});

test("extreme travel value does not exceed weight (saturates)", () => {
  const detail = scoring.scoreMetrics(
    { totalTravelMin: 1e9, crossCityCount: 0, backtrackCount: 0, priorityScore: 0, placeCount: 2 },
    { travel: 1.0, crossCity: 0, backtrack: 0, priority: 0 }
  );
  // travelNorm 饱和为 1，故 travel 贡献不超过权重 1.0。
  assert.equal(detail.breakdown.travel <= 1.0 + 1e-9, true);
});
