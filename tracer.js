"use strict";

// v1.3 全链路 trace 埋点基线。
// 本 schema 是全项目埋点基线，后续版本（v1.4~v1.7）在其上扩展字段，v1.7 可观测体系直接消费。
// 约束：埋点不得阻塞主流程；埋点异常必须记录日志（遵循「无静默失败」），不得静默吞掉。

var crypto = require("crypto");

var SCHEMA_VERSION = "1.3.0";

function newId() {
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2);
}

// payload 摘要化：大对象裁剪，避免高频调用下 trace 体积失控。
function summarizePayload(payload, maxLen) {
  var limit = Number(maxLen) || 400;
  if (payload === null || payload === undefined) {
    return {};
  }
  if (typeof payload !== "object") {
    return { value: String(payload).slice(0, limit) };
  }
  var out = {};
  Object.keys(payload).forEach(function (key) {
    var value = payload[key];
    if (value === null || value === undefined) {
      out[key] = value;
      return;
    }
    if (typeof value === "string") {
      out[key] = value.length > limit ? value.slice(0, limit) + "…" : value;
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      out[key] = { type: "array", length: value.length, sample: value.slice(0, 3) };
      return;
    }
    // 其他对象仅保留键名摘要，避免深拷贝大对象
    out[key] = { type: "object", keys: Object.keys(value).slice(0, 12) };
  });
  return out;
}

function createTracer(options) {
  var opts = options || {};
  var traceId = opts.traceId || newId();
  var requestId = opts.requestId || traceId;
  var logger = opts.logger || console;
  var events = [];
  var timers = {};

  function emit(event) {
    try {
      var evt = event || {};
      var record = {
        traceId: traceId,
        requestId: requestId,
        schemaVersion: SCHEMA_VERSION,
        ts: typeof evt.ts === "number" ? evt.ts : Date.now(),
        stage: evt.stage || "",
        eventType: evt.eventType || "custom",
        payload: summarizePayload(evt.payload),
        durationMs: typeof evt.durationMs === "number" ? evt.durationMs : 0,
        status: evt.status || "ok",
      };
      events.push(record);
      return record;
    } catch (err) {
      // 无静默失败：埋点异常必须记录日志
      try {
        logger.warn("[tracer] emit 失败，已跳过该事件: " + (err && err.message));
      } catch (logErr) {
        // logger 亦不可用时，退回标准错误输出，仍不静默
        try {
          process.stderr.write("[tracer] emit 失败且 logger 不可用: " + (err && err.message) + "\n");
        } catch (ignore) {
          // 到此已尽力记录，不再抛出以免阻塞主流程
        }
      }
      return null;
    }
  }

  function stateEnter(stage, payload) {
    timers[stage] = Date.now();
    return emit({ stage: stage, eventType: "state_enter", status: "ok", payload: payload || {} });
  }

  function stateExit(stage, status, payload) {
    var started = timers[stage];
    var durationMs = started ? Date.now() - started : 0;
    return emit({
      stage: stage,
      eventType: "state_exit",
      status: status || "ok",
      durationMs: durationMs,
      payload: payload || {},
    });
  }

  function validation(finding) {
    var f = finding || {};
    return emit({
      stage: "verify",
      eventType: "validation",
      status: f.level === "error" ? "error" : (f.level === "warn" ? "warn" : "ok"),
      payload: {
        code: f.code,
        level: f.level,
        pass: f.pass,
        message: f.message,
        evidenceRef: f.evidence ? summarizePayload(f.evidence) : null,
      },
    });
  }

  function repairAction(info) {
    var i = info || {};
    return emit({
      stage: "repair",
      eventType: "repair_action",
      status: "ok",
      payload: {
        action: i.action,
        reason: i.reason,
        beforeScore: i.beforeScore,
        afterScore: i.afterScore,
        diff: i.diff,
      },
    });
  }

  function fallback(info) {
    var i = info || {};
    return emit({
      stage: "fallback",
      eventType: "fallback",
      status: "warn",
      payload: {
        reason: i.reason,
        unresolved: i.unresolved,
      },
    });
  }

  // 工具调用统一包裹：自动记录 durationMs / ok / cacheHit
  function withTrace(toolName, fn, meta) {
    var started = Date.now();
    return Promise.resolve()
      .then(fn)
      .then(function (result) {
        emit({
          stage: "tool",
          eventType: "tool_call",
          status: "ok",
          durationMs: Date.now() - started,
          payload: Object.assign({ tool: toolName, ok: true }, meta || {}),
        });
        return result;
      })
      .catch(function (err) {
        emit({
          stage: "tool",
          eventType: "tool_call",
          status: "error",
          durationMs: Date.now() - started,
          payload: Object.assign({ tool: toolName, ok: false, error: err && err.message }, meta || {}),
        });
        throw err;
      });
  }

  function snapshot() {
    return {
      traceId: traceId,
      requestId: requestId,
      schemaVersion: SCHEMA_VERSION,
      events: events.slice(),
      eventCount: events.length,
    };
  }

  return {
    traceId: traceId,
    requestId: requestId,
    schemaVersion: SCHEMA_VERSION,
    emit: emit,
    stateEnter: stateEnter,
    stateExit: stateExit,
    validation: validation,
    repairAction: repairAction,
    fallback: fallback,
    withTrace: withTrace,
    snapshot: snapshot,
  };
}

// 内存保留最近 N 条 trace（内测调试用），供 GET /api/debug/last-trace 消费。
var RECENT_LIMIT = 20;
var recentTraces = [];

function recordTrace(tracer) {
  if (!tracer || typeof tracer.snapshot !== "function") {
    return;
  }
  try {
    recentTraces.unshift(tracer.snapshot());
    if (recentTraces.length > RECENT_LIMIT) {
      recentTraces.length = RECENT_LIMIT;
    }
  } catch (err) {
    try {
      console.warn("[tracer] recordTrace 失败: " + (err && err.message));
    } catch (ignore) {
      // 不静默：已尽力记录
    }
  }
}

function getLastTrace() {
  return recentTraces.length ? recentTraces[0] : null;
}

function getRecentTraces() {
  return recentTraces.slice();
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  createTracer: createTracer,
  summarizePayload: summarizePayload,
  recordTrace: recordTrace,
  getLastTrace: getLastTrace,
  getRecentTraces: getRecentTraces,
};
