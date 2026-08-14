"use strict";

// v1.7 评测运行器（内存态，单次跑通出指标）。
//
// 范围（见 doc_auto/内测-v1.7-前瞻规划.md §0）：
// - ACTIVE：批量跑评测集 → 抽取每 case 指标 → 汇总当次报告（内存返回）。
// - PENDING（本文件不做）：与历史 baseline 对比、准入门禁、报告落盘——依赖持久化存储。
//
// 解耦设计：runner 不发起网络/不知道如何规划，由调用方注入 runOne(caseInput) → 返回 trace（或 Promise<trace>）。
// 这样既能在本地用真实 server 跑，也能在单测里用合成 trace 跑，均不落盘。

var metrics = require("../metrics.js");

// 对单个 case 的期望做「符合性标注」——仅报告用途，NON-GATING（不抛错、不拦截）。
function checkExpectation(caseDef, m) {
  var expect = (caseDef && caseDef.expect) || {};
  var checks = [];
  var ok = true;

  if (typeof expect.finalStatus === "string") {
    var pass1 = m.finalStatus === expect.finalStatus;
    checks.push({ name: "finalStatus==" + expect.finalStatus, pass: pass1, actual: m.finalStatus });
    ok = ok && pass1;
  }
  if (Array.isArray(expect.finalStatusIn)) {
    var pass2 = expect.finalStatusIn.indexOf(m.finalStatus) >= 0;
    checks.push({ name: "finalStatus in [" + expect.finalStatusIn.join(",") + "]", pass: pass2, actual: m.finalStatus });
    ok = ok && pass2;
  }
  if (expect.violationsZero === true) {
    var pass3 = (Number(m.violationCount) || 0) === 0;
    checks.push({ name: "violationCount==0", pass: pass3, actual: m.violationCount });
    ok = ok && pass3;
  }
  if (typeof expect.maxRepairRounds === "number") {
    var pass4 = (Number(m.repairRounds) || 0) <= expect.maxRepairRounds;
    checks.push({ name: "repairRounds<=" + expect.maxRepairRounds, pass: pass4, actual: m.repairRounds });
    ok = ok && pass4;
  }

  return { meetsExpectation: ok, checks: checks };
}

// 运行评测集。
// 参数：{ cases: [...], runOne: (caseInput) => trace|Promise<trace> }
// 返回：{ generatedAt, caseCount, caseResults: [...], aggregate, gating:false }
async function runEvalSet(options) {
  var opts = options || {};
  var cases = Array.isArray(opts.cases) ? opts.cases : [];
  var runOne = opts.runOne;
  if (typeof runOne !== "function") {
    throw new Error("runEvalSet: 需要注入 runOne(caseInput) 函数");
  }

  var caseResults = [];
  var perRequestMetrics = [];

  for (var i = 0; i < cases.length; i += 1) {
    var caseDef = cases[i];
    var result = { id: caseDef.id, name: caseDef.name };
    try {
      var trace = await runOne(caseDef.input);
      var m = metrics.computeMetricsFromTrace(trace);
      var exp = checkExpectation(caseDef, m);
      result.status = "ran";
      result.metrics = m;
      result.meetsExpectation = exp.meetsExpectation;
      result.checks = exp.checks;
      perRequestMetrics.push(m);
    } catch (err) {
      // 不静默：单个 case 运行失败如实记录，其余继续跑。
      result.status = "error";
      result.error = err && err.message ? err.message : String(err);
      result.meetsExpectation = false;
    }
    caseResults.push(result);
  }

  return {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    caseResults: caseResults,
    aggregate: metrics.aggregateMetrics(perRequestMetrics),
    // 明确标记：本期不做门禁（PENDING），期望符合性仅供参考。
    gating: false,
  };
}

module.exports = {
  runEvalSet: runEvalSet,
  checkExpectation: checkExpectation,
};
