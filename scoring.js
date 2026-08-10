"use strict";

// v1.4 统一评分器（Scoring Engine）。
// 职责：把 computeRouteMetrics 产出的原始度量归一化到 [0,1]，按策略权重加权，
// 输出 { score, breakdown, normalized }。score 越低越好，与 v1.3 收敛口径一致。
//
// 设计约束：
// - 纯函数、无外部 require（避免与 agent-planner.js 循环依赖）；
// - scoreMetrics 接收「权重对象」而非策略 id，策略→权重的映射由调用方（agent-planner）完成；
// - 各度量归一化边界集中在 DEFAULT_BOUNDS，便于用回归样例调参。

// 归一化边界（可用样例统计后覆盖）：
// - travelSatPerLegMin：单段通勤达到该分钟数时通勤项归一化贡献饱和（封顶为 1）。
var DEFAULT_BOUNDS = {
  travelSatPerLegMin: 180,
};

function clamp01(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

// 把原始度量归一化到 [0,1]。cost 类（travel/crossCity/backtrack）越大越差；
// priority 为「命中率」，越大越好（越靠前放高优先级景点越高）。
function normalizeMetrics(metrics, bounds) {
  var m = metrics || {};
  var b = Object.assign({}, DEFAULT_BOUNDS, bounds || {});
  var placeCount = Number(m.placeCount) || 0;
  var legCount = Math.max(1, placeCount - 1);

  var travelNorm = clamp01(
    (Number(m.totalTravelMin) || 0) / (legCount * b.travelSatPerLegMin)
  );
  var crossCityNorm = clamp01((Number(m.crossCityCount) || 0) / legCount);
  var backtrackNorm = clamp01((Number(m.backtrackCount) || 0) / legCount);

  // 优先级命中率：priorityScore 相对「全高优先级」理论上限的比例。
  // computeRouteMetrics 中 base(high)=3，位置权重和为 (n+1)/2 → maxPriorityScore = 3*(n+1)/2。
  var maxPriorityScore = placeCount > 0 ? (3 * (placeCount + 1)) / 2 : 1;
  var priorityHit = clamp01((Number(m.priorityScore) || 0) / maxPriorityScore);

  return {
    travel: travelNorm,
    crossCity: crossCityNorm,
    backtrack: backtrackNorm,
    priority: priorityHit,
  };
}

// 按权重加权归一化度量，返回分数与构成。score 越低越好。
// priority 是「越高越好」，故以减项计入总分。
function scoreMetrics(metrics, weights, bounds) {
  var w = weights || {};
  var normalized = normalizeMetrics(metrics, bounds);
  var breakdown = {
    travel: (Number(w.travel) || 0) * normalized.travel,
    crossCity: (Number(w.crossCity) || 0) * normalized.crossCity,
    backtrack: (Number(w.backtrack) || 0) * normalized.backtrack,
    priority: -(Number(w.priority) || 0) * normalized.priority,
  };
  var score = breakdown.travel + breakdown.crossCity + breakdown.backtrack + breakdown.priority;
  return {
    score: score,
    breakdown: breakdown,
    normalized: normalized,
  };
}

module.exports = {
  DEFAULT_BOUNDS: DEFAULT_BOUNDS,
  clamp01: clamp01,
  normalizeMetrics: normalizeMetrics,
  scoreMetrics: scoreMetrics,
};
