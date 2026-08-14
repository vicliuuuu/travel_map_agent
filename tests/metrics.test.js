const test = require("node:test");
const assert = require("node:assert/strict");
const metrics = require("../metrics.js");

function traceWithSummary() {
  return {
    traceId: "t-1",
    requestId: "r-1",
    schemaVersion: "1.7.0",
    events: [
      { eventType: "request_summary", stage: "finalize", status: "ok", durationMs: 1234, payload: { totalDurationMs: 1234, finalStatus: "ok", repairRounds: 2, totalTokens: 500 } },
      { eventType: "validation", stage: "verify", status: "error", payload: { level: "error", pass: false, code: "TIME_OVERLOAD" } },
      { eventType: "validation", stage: "verify", status: "warn", payload: { level: "warn", pass: true, code: "OPENING_RISK" } },
      { eventType: "validation", stage: "verify", status: "ok", payload: { level: "ok", pass: true } },
      { eventType: "tool_call", stage: "tool", status: "ok", payload: { tool: "geocode", ok: true, cacheHit: false } },
      { eventType: "tool_call", stage: "tool", status: "ok", payload: { tool: "geocode", ok: true, cacheHit: true } },
      { eventType: "tool_call", stage: "tool", status: "error", payload: { tool: "weather", ok: false, cacheHit: false } },
      { eventType: "token_usage", stage: "llm", status: "ok", payload: { totalTokens: 500, calls: 3 } },
    ],
  };
}

test("computeMetricsFromTrace: reads request_summary and counts events precisely", () => {
  const m = metrics.computeMetricsFromTrace(traceWithSummary());
  assert.equal(m.finalStatus, "ok");
  assert.equal(m.totalDurationMs, 1234);
  assert.equal(m.repairRounds, 2);
  assert.equal(m.violationCount, 1);
  assert.equal(m.warningCount, 1);
  assert.equal(m.toolCallCount, 3);
  assert.equal(m.toolErrorCount, 1);
  assert.equal(m.cacheHitRate, 0.3333);
  assert.equal(m.fallbackTriggered, false);
  assert.equal(m.totalTokens, 500);
  assert.equal(m.incrementalReusedRatio, null);
});

test("computeMetricsFromTrace: infers status/duration/rounds/tokens without request_summary", () => {
  const trace = {
    events: [
      { eventType: "state_exit", stage: "build_context", status: "ok", durationMs: 100, payload: {} },
      { eventType: "state_exit", stage: "verify", status: "warn", durationMs: 50, payload: {} },
      { eventType: "repair_action", stage: "repair", status: "ok", payload: { action: "remove_place" } },
      { eventType: "fallback", stage: "fallback", status: "warn", payload: { reason: "max_rounds" } },
      { eventType: "token_usage", stage: "llm", status: "ok", payload: { totalTokens: 200 } },
      { eventType: "validation", stage: "verify", status: "error", payload: { level: "error", pass: false } },
    ],
  };
  const m = metrics.computeMetricsFromTrace(trace);
  assert.equal(m.finalStatus, "fallback");
  assert.equal(m.totalDurationMs, 150);
  assert.equal(m.repairRounds, 1);
  assert.equal(m.totalTokens, 200);
  assert.equal(m.fallbackTriggered, true);
  assert.equal(m.violationCount, 1);
});

test("computeMetricsFromTrace: picks incremental_replan reusedRatio", () => {
  const trace = {
    events: [
      { eventType: "incremental_replan", stage: "incremental_replan", status: "ok", payload: { changeType: "remove_place", reusedRatio: 0.75, dayCount: 4 } },
    ],
  };
  const m = metrics.computeMetricsFromTrace(trace);
  assert.equal(m.incrementalReusedRatio, 0.75);
});

test("computeMetricsFromTrace: throws on non-trace input (no silent failure)", () => {
  assert.throws(() => metrics.computeMetricsFromTrace(null), /events/);
  assert.throws(() => metrics.computeMetricsFromTrace({}), /events/);
});

test("aggregateMetrics: computes rates and averages over a batch", () => {
  const okTrace = traceWithSummary();
  const fbTrace = {
    events: [
      { eventType: "request_summary", stage: "finalize", status: "warn", payload: { totalDurationMs: 800, finalStatus: "fallback", repairRounds: 4, totalTokens: 300 } },
      { eventType: "validation", stage: "verify", status: "error", payload: { level: "error", pass: false } },
      { eventType: "tool_call", stage: "tool", status: "ok", payload: { ok: true, cacheHit: true } },
    ],
  };
  const agg = metrics.aggregateMetrics([okTrace, fbTrace]);
  assert.equal(agg.requestCount, 2);
  assert.equal(agg.successRate, 0.5);
  assert.equal(agg.fallbackRate, 0.5);
  assert.equal(agg.errorRate, 0);
  assert.equal(agg.violationRate, 1); // both have >=1 violation
  assert.equal(agg.avgRepairRounds, 3); // (2+4)/2
  assert.equal(agg.avgTotalTokens, 400); // (500+300)/2
  assert.equal(agg.perRequest.length, 2);
});

test("aggregateMetrics: empty batch returns null rates, zero count", () => {
  const agg = metrics.aggregateMetrics([]);
  assert.equal(agg.requestCount, 0);
  assert.equal(agg.successRate, null);
});

test("METRIC_DEFINITIONS documents every core metric", () => {
  ["finalStatus", "totalDurationMs", "repairRounds", "violationCount", "cacheHitRate", "successRate"].forEach((k) => {
    assert.equal(typeof metrics.METRIC_DEFINITIONS[k], "string");
  });
});
