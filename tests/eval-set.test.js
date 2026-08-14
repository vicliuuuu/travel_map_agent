const test = require("node:test");
const assert = require("node:assert/strict");
const { EVAL_CASES } = require("../eval/eval-set.js");
const { runEvalSet, checkExpectation } = require("../eval/eval-runner.js");

// 合成 runOne：不发起网络，按 case 输入造一个「成功收敛」的内存 trace。
function syntheticRunOne(caseInput) {
  const placeCount = (caseInput.places || []).length;
  return {
    traceId: "syn-" + Math.random().toString(16).slice(2),
    events: [
      { eventType: "state_exit", stage: "build_context", status: "ok", durationMs: 120, payload: {} },
      { eventType: "state_exit", stage: "verify", status: "ok", durationMs: 30, payload: {} },
      { eventType: "state_exit", stage: "finalize", status: "ok", durationMs: 10, payload: {} },
      { eventType: "request_summary", stage: "finalize", status: "ok", payload: { totalDurationMs: 160, finalStatus: "ok", repairRounds: 0, totalTokens: 100 * placeCount } },
    ],
  };
}

test("eval-set defines representative scenarios covering v1.3–v1.6", () => {
  assert.ok(EVAL_CASES.length >= 5);
  const ids = EVAL_CASES.map((c) => c.id);
  ["cross-country-city", "same-city-dense", "no-lodging", "time-overload", "multi-hotel"].forEach((id) => {
    assert.ok(ids.includes(id), "missing case: " + id);
  });
});

test("runEvalSet: runs all cases and aggregates, non-gating", async () => {
  const report = await runEvalSet({ cases: EVAL_CASES, runOne: syntheticRunOne });
  assert.equal(report.caseCount, EVAL_CASES.length);
  assert.equal(report.caseResults.length, EVAL_CASES.length);
  assert.equal(report.gating, false);
  assert.equal(report.aggregate.requestCount, EVAL_CASES.length);
  assert.equal(report.aggregate.successRate, 1);
  report.caseResults.forEach((r) => assert.equal(r.status, "ran"));
});

test("runEvalSet: a failing case is recorded, others keep running (no silent failure)", async () => {
  const runOne = (input) => {
    if ((input.places || []).length === 0) {
      throw new Error("no places");
    }
    return syntheticRunOne(input);
  };
  const cases = [
    { id: "bad", name: "bad", input: { places: [] }, expect: {} },
    { id: "good", name: "good", input: { places: [{ name: "X" }] }, expect: { finalStatus: "ok" } },
  ];
  const report = await runEvalSet({ cases, runOne });
  const bad = report.caseResults.find((r) => r.id === "bad");
  const good = report.caseResults.find((r) => r.id === "good");
  assert.equal(bad.status, "error");
  assert.match(bad.error, /no places/);
  assert.equal(good.status, "ran");
  assert.equal(report.aggregate.requestCount, 1); // only the good one produced metrics
});

test("runEvalSet: throws when runOne not injected", async () => {
  await assert.rejects(() => runEvalSet({ cases: EVAL_CASES }), /runOne/);
});

test("checkExpectation: finalStatusIn and violationsZero", () => {
  const m = { finalStatus: "fallback", violationCount: 0, repairRounds: 1 };
  const r = checkExpectation({ expect: { finalStatusIn: ["ok", "fallback"], violationsZero: true } }, m);
  assert.equal(r.meetsExpectation, true);
  assert.equal(r.checks.length, 2);
});
