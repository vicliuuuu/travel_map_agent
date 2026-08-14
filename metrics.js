"use strict";

// v1.7 指标计算引擎（纯内存 / 单次或批量）。
//
// 定位（见 doc_auto/内测-v1.7-前瞻规划.md §0 范围收敛）：
// - ACTIVE：对「单次请求 / 内存中的 trace」计算核心指标，并支持对一批内存 trace 做即时聚合。
// - PENDING（本模块不做）：trace 落盘、时序看板、跨次 baseline 对比、准入门禁——均依赖持久化存储。
//
// 设计原则：
// - 与埋点解耦：只按 eventType 读事件（跨 schema 版本稳定），字段缺失按文档口径降级，不臆造。
// - 口径固化：每个指标的「依赖事件 + 计算口径」写在 METRIC_DEFINITIONS，避免同名不同算法。
// - 无静默失败：输入非法（非 trace 结构）直接抛错，不返回“看起来正常”的空指标。

// 指标口径说明（书面固化，改口径需同步此表 + 单测）。
var METRIC_DEFINITIONS = {
  finalStatus: "请求最终状态：优先取 request_summary.payload.finalStatus；缺失时按 fallback 事件/终态 state_exit 推断。",
  totalDurationMs: "端到端耗时：优先 request_summary.payload.totalDurationMs；缺失时取各 state_exit.durationMs 之和。",
  repairRounds: "修复轮次：优先 request_summary.payload.repairRounds；缺失时取 repair_action 事件计数。",
  violationCount: "硬违例数：validation 事件中 level=error（或 pass=false）的条数。",
  warningCount: "告警数：validation 事件中 level=warn 的条数。",
  toolCallCount: "外部工具调用数：tool_call 事件条数。",
  toolErrorCount: "工具失败数：tool_call 事件中 status=error 的条数。",
  cacheHitRate: "缓存命中率：tool_call 中 payload.cacheHit===true 的条数 / 带 cacheHit 字段的 tool_call 条数。",
  fallbackTriggered: "是否触发兜底：存在 fallback 事件即为 true。",
  totalTokens: "LLM token 总量：优先 request_summary.payload.totalTokens；缺失时取 token_usage 累加。",
  incrementalReusedRatio: "局部重算复用率：incremental_replan.payload.reusedRatio（无该事件则为 null）。",
  // 聚合口径
  successRate: "成功率：finalStatus==='ok' 的请求数 / 总请求数。",
  fallbackRate: "兜底率：finalStatus==='fallback' 的请求数 / 总请求数。",
  errorRate: "错误率：finalStatus==='error' 的请求数 / 总请求数。",
  violationRate: "违例请求占比：violationCount>0 的请求数 / 总请求数。",
  avgRepairRounds: "平均修复轮次：sum(repairRounds) / 请求数。",
  avgDurationMs: "平均端到端耗时：sum(totalDurationMs) / 请求数。",
  avgToolCalls: "平均工具调用数：sum(toolCallCount) / 请求数。",
  avgTotalTokens: "平均 token：sum(totalTokens) / 请求数。",
};

function isTraceLike(trace) {
  return trace && typeof trace === "object" && Array.isArray(trace.events);
}

function eventsByType(events, type) {
  return events.filter(function (e) {
    return e && e.eventType === type;
  });
}

function round(value, digits) {
  var d = typeof digits === "number" ? digits : 4;
  var factor = Math.pow(10, d);
  return Math.round((Number(value) || 0) * factor) / factor;
}

// 单次请求指标：输入一个 trace snapshot（{ events: [...] }），输出结构化指标。
function computeMetricsFromTrace(trace) {
  if (!isTraceLike(trace)) {
    throw new Error("computeMetricsFromTrace: 需要包含 events 数组的 trace 结构");
  }
  var events = trace.events;

  var summaryEvt = eventsByType(events, "request_summary")[0] || null;
  var summary = summaryEvt && summaryEvt.payload ? summaryEvt.payload : {};

  var validations = eventsByType(events, "validation");
  var violationCount = validations.filter(function (e) {
    var p = e.payload || {};
    return p.level === "error" || p.pass === false;
  }).length;
  var warningCount = validations.filter(function (e) {
    return (e.payload || {}).level === "warn";
  }).length;

  var toolCalls = eventsByType(events, "tool_call");
  var toolErrorCount = toolCalls.filter(function (e) {
    return e.status === "error" || (e.payload && e.payload.ok === false);
  }).length;
  var cacheAware = toolCalls.filter(function (e) {
    return e.payload && typeof e.payload.cacheHit === "boolean";
  });
  var cacheHits = cacheAware.filter(function (e) {
    return e.payload.cacheHit === true;
  }).length;
  var cacheHitRate = cacheAware.length ? round(cacheHits / cacheAware.length) : null;

  var fallbackTriggered = eventsByType(events, "fallback").length > 0;

  // finalStatus：request_summary 优先，否则推断。
  var finalStatus = summary.finalStatus;
  if (!finalStatus) {
    if (fallbackTriggered) {
      finalStatus = "fallback";
    } else {
      var finalizeExit = eventsByType(events, "state_exit").filter(function (e) {
        return e.stage === "finalize";
      });
      finalStatus = finalizeExit.length ? "ok" : "unknown";
    }
  }

  // totalDurationMs：summary 优先，否则各 state_exit.durationMs 求和。
  var totalDurationMs = Number(summary.totalDurationMs);
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    totalDurationMs = eventsByType(events, "state_exit").reduce(function (acc, e) {
      return acc + (Number(e.durationMs) || 0);
    }, 0);
  }

  // repairRounds：summary 优先，否则 repair_action 计数。
  var repairRounds = Number(summary.repairRounds);
  if (!Number.isFinite(repairRounds)) {
    repairRounds = eventsByType(events, "repair_action").length;
  }

  // totalTokens：summary 优先，否则 token_usage 累加。
  var totalTokens = Number(summary.totalTokens);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    totalTokens = eventsByType(events, "token_usage").reduce(function (acc, e) {
      return acc + (Number((e.payload || {}).totalTokens) || 0);
    }, 0);
  }

  var replanEvt = eventsByType(events, "incremental_replan")[0] || null;
  var incrementalReusedRatio = replanEvt && replanEvt.payload && typeof replanEvt.payload.reusedRatio === "number"
    ? replanEvt.payload.reusedRatio
    : null;

  var stageDurations = {};
  eventsByType(events, "state_exit").forEach(function (e) {
    if (e.stage) {
      stageDurations[e.stage] = (stageDurations[e.stage] || 0) + (Number(e.durationMs) || 0);
    }
  });

  return {
    traceId: trace.traceId || null,
    requestId: trace.requestId || null,
    schemaVersion: trace.schemaVersion || null,
    finalStatus: finalStatus,
    totalDurationMs: totalDurationMs,
    repairRounds: repairRounds,
    violationCount: violationCount,
    warningCount: warningCount,
    toolCallCount: toolCalls.length,
    toolErrorCount: toolErrorCount,
    cacheHitRate: cacheHitRate,
    fallbackTriggered: fallbackTriggered,
    totalTokens: totalTokens,
    incrementalReusedRatio: incrementalReusedRatio,
    stageDurations: stageDurations,
  };
}

// 批量聚合：输入一组 trace 或一组「单次指标」，输出聚合指标（内存态，不落盘）。
function aggregateMetrics(items) {
  var list = Array.isArray(items) ? items : [];
  var perRequest = list.map(function (item) {
    // 兼容：既接受原始 trace，也接受已算好的单次指标。
    if (isTraceLike(item)) {
      return computeMetricsFromTrace(item);
    }
    if (item && typeof item === "object" && typeof item.finalStatus === "string") {
      return item;
    }
    throw new Error("aggregateMetrics: 每一项需为 trace 结构或单次指标结构");
  });

  var n = perRequest.length;
  if (!n) {
    return {
      requestCount: 0,
      successRate: null,
      fallbackRate: null,
      errorRate: null,
      violationRate: null,
      avgRepairRounds: null,
      avgDurationMs: null,
      avgToolCalls: null,
      avgTotalTokens: null,
      cacheHitRate: null,
      perRequest: perRequest,
    };
  }

  var counts = { ok: 0, fallback: 0, error: 0, violation: 0 };
  var sums = { repair: 0, duration: 0, toolCalls: 0, tokens: 0, cacheHits: 0, cacheAware: 0 };
  perRequest.forEach(function (m) {
    if (m.finalStatus === "ok") { counts.ok += 1; }
    if (m.finalStatus === "fallback") { counts.fallback += 1; }
    if (m.finalStatus === "error") { counts.error += 1; }
    if ((Number(m.violationCount) || 0) > 0) { counts.violation += 1; }
    sums.repair += Number(m.repairRounds) || 0;
    sums.duration += Number(m.totalDurationMs) || 0;
    sums.toolCalls += Number(m.toolCallCount) || 0;
    sums.tokens += Number(m.totalTokens) || 0;
    // 缓存命中率按“调用条数”加权：需要每请求的命中与总数。
    if (typeof m.cacheHitRate === "number" && Number(m.toolCallCount) >= 0) {
      // 无法从 rate 反推分母时，退化为按请求平均；为精确起见此处仅在有 rate 时累积近似。
      sums.cacheHits += m.cacheHitRate;
      sums.cacheAware += 1;
    }
  });

  return {
    requestCount: n,
    successRate: round(counts.ok / n),
    fallbackRate: round(counts.fallback / n),
    errorRate: round(counts.error / n),
    violationRate: round(counts.violation / n),
    avgRepairRounds: round(sums.repair / n),
    avgDurationMs: round(sums.duration / n, 2),
    avgToolCalls: round(sums.toolCalls / n, 2),
    avgTotalTokens: round(sums.tokens / n, 2),
    cacheHitRate: sums.cacheAware ? round(sums.cacheHits / sums.cacheAware) : null,
    perRequest: perRequest,
  };
}

module.exports = {
  METRIC_DEFINITIONS: METRIC_DEFINITIONS,
  computeMetricsFromTrace: computeMetricsFromTrace,
  aggregateMetrics: aggregateMetrics,
};
