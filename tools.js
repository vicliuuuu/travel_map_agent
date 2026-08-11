"use strict";

// v1.5 可插拔工具层（doc §3.1 / §8.1 / §8.3）。
// 统一 Tool 抽象 + ToolRegistry + invokeTool，一次做对，后续工具零侵入接入：
//   - 幂等缓存：相同 args 命中缓存（cacheKey 对 args 归一化）；
//   - 错误码标准化：不同 provider 的错误统一映射到枚举，供降级/校验决策消费；
//   - 降级策略：工具不可用时按分级降级（跳过并标注 / 保守估计 / 致命失败），不静默；
//   - 来源标注：外部事实统一带 source / fetchedAt / verifyState，防幻觉。
// 约束（遵循「无静默失败」）：降级/错误必须 emit 埋点并记录日志，不得静默吞掉。

var STD_ERROR_CODES = {
  RATE_LIMIT: "RATE_LIMIT",
  NOT_FOUND: "NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  DISABLED: "DISABLED",
  INVALID_ARGS: "INVALID_ARGS",
};

// 降级分级（doc §8.3）：
//   skip         → 跳过并标注 unverified（如天气不可用）；对应校验项不计硬失败；
//   conservative → 用保守估计（如拥堵系数取 1.0）；
//   fatal        → 致命失败，向上抛出（如 geocode 全失败进 fallback）。
var DEGRADE_MODES = {
  SKIP: "skip",
  CONSERVATIVE: "conservative",
  FATAL: "fatal",
};

var VERIFY_STATE = {
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
};

// args → 稳定缓存键：键名排序 + 字符串归一化（trim/小写/去音符/折叠空格），保证幂等命中。
function normalizeArgValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  }
  return String(value);
}

function defaultCacheKey(args) {
  var obj = args || {};
  return Object.keys(obj)
    .sort()
    .map(function (key) {
      return key + "=" + normalizeArgValue(obj[key]);
    })
    .join("&");
}

// 外部事实来源标注（doc §2.2.3 / §4）：所有外部事实输出必须带 source/fetchedAt/verifyState。
function stampFactSource(data, meta) {
  var m = meta || {};
  var base = data && typeof data === "object" ? data : { value: data };
  return Object.assign({}, base, {
    source: m.source || "unknown",
    fetchedAt: m.fetchedAt || new Date().toISOString(),
    verifyState: m.verifyState || VERIFY_STATE.VERIFIED,
  });
}

// 标准化任意 provider 错误到统一枚举，供降级/校验决策消费。
function normalizeError(err, customNormalize) {
  if (typeof customNormalize === "function") {
    var mapped = customNormalize(err);
    if (mapped) {
      return mapped;
    }
  }
  if (err && err.code && STD_ERROR_CODES[err.code]) {
    return err.code;
  }
  var msg = String((err && err.message) || err || "").toLowerCase();
  if (/timeout|timed out|etimedout/.test(msg)) {
    return STD_ERROR_CODES.TIMEOUT;
  }
  if (/rate.?limit|too many requests|429|quota/.test(msg)) {
    return STD_ERROR_CODES.RATE_LIMIT;
  }
  if (/not found|no result|zero_results|404/.test(msg)) {
    return STD_ERROR_CODES.NOT_FOUND;
  }
  return STD_ERROR_CODES.PROVIDER_ERROR;
}

function withTimeout(promiseFactory, timeoutMs) {
  var ms = Number(timeoutMs) || 0;
  var invocation = Promise.resolve().then(promiseFactory);
  if (ms <= 0) {
    return invocation;
  }
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) {
        return;
      }
      settled = true;
      var e = new Error("工具调用超时 (" + ms + "ms)");
      e.code = STD_ERROR_CODES.TIMEOUT;
      reject(e);
    }, ms);
    invocation.then(
      function (value) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      function (err) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function normalizeToolDef(def) {
  var d = def || {};
  if (!d.name) {
    throw new Error("工具定义缺少 name");
  }
  if (typeof d.invoke !== "function") {
    throw new Error("工具「" + d.name + "」缺少 invoke 实现");
  }
  return {
    name: d.name,
    schema: d.schema || null,
    invoke: d.invoke,
    cacheKey: typeof d.cacheKey === "function" ? d.cacheKey : defaultCacheKey,
    normalizeError: typeof d.normalizeError === "function" ? d.normalizeError : null,
    timeoutMs: Number(d.timeoutMs) || 0,
    retries: Number.isFinite(Number(d.retries)) ? Number(d.retries) : 0,
    enabled: d.enabled !== false,
    degradeMode: d.degradeMode || DEGRADE_MODES.SKIP,
    fallbackData: d.fallbackData || null,
    source: d.source || d.name,
    native: Boolean(d.native), // 存量工具（geocode/travel）自带缓存，跳过注册表缓存层
    stampSource: d.stampSource !== false, // 外部事实类工具默认标注来源
  };
}

function createToolRegistry(options) {
  var opts = options || {};
  var tracer = opts.tracer || null;
  var logger = opts.logger || console;
  var clockNow = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
  var isoNow = typeof opts.isoNow === "function" ? opts.isoNow : function () { return new Date().toISOString(); };
  var tools = {};
  var cache = opts.cache || {};
  var stats = { calls: 0, cacheHits: 0, degrades: 0, errors: 0 };

  function register(def) {
    var normalized = normalizeToolDef(def);
    tools[normalized.name] = normalized;
    return api;
  }

  function get(name) {
    return tools[name] || null;
  }

  function isEnabled(name) {
    return Boolean(tools[name] && tools[name].enabled);
  }

  function listEnabled() {
    return Object.keys(tools)
      .filter(function (name) { return tools[name].enabled; })
      .map(function (name) { return tools[name]; });
  }

  function emitToolCall(payload, status, durationMs) {
    if (!tracer || typeof tracer.emit !== "function") {
      return;
    }
    tracer.emit({
      stage: "tool",
      eventType: "tool_call",
      status: status || "ok",
      durationMs: durationMs || 0,
      payload: payload,
    });
  }

  function emitFactSource(tool, data) {
    if (!tracer || typeof tracer.factSource !== "function") {
      return;
    }
    if (!data || !data.source) {
      return;
    }
    tracer.factSource({
      tool: tool,
      source: data.source,
      fetchedAt: data.fetchedAt,
      verifyState: data.verifyState,
    });
  }

  function emitDegrade(tool, reason, fallbackUsed) {
    if (tracer && typeof tracer.toolDegrade === "function") {
      tracer.toolDegrade({ tool: tool, reason: reason, fallbackUsed: fallbackUsed });
    }
    // 无静默失败：降级必须记录日志
    try {
      logger.warn("[tools] 工具「" + tool + "」降级：" + reason + "（fallbackUsed=" + fallbackUsed + "）");
    } catch (logErr) {
      try {
        process.stderr.write("[tools] 降级日志失败: " + (logErr && logErr.message) + "\n");
      } catch (ignore) {
        // 已尽力记录
      }
    }
  }

  async function runWithRetries(tool, args) {
    var attempt = 0;
    var lastErr = null;
    while (attempt <= tool.retries) {
      try {
        return await withTimeout(function () { return tool.invoke(args); }, tool.timeoutMs);
      } catch (err) {
        lastErr = err;
        attempt += 1;
      }
    }
    throw lastErr;
  }

  // 统一调用入口：永不抛出（除 fatal 降级），返回结构化结果供上层判定。
  // 返回：{ ok, tool, data, cacheHit, degraded, degradeMode, errorCode, error, durationMs }
  async function invoke(name, args) {
    var started = clockNow();
    stats.calls += 1;
    var tool = tools[name];

    if (!tool) {
      var unknownErr = new Error("未知工具: " + name);
      unknownErr.code = STD_ERROR_CODES.PROVIDER_ERROR;
      throw unknownErr;
    }

    if (!tool.enabled) {
      emitToolCall({ tool: name, ok: false, degraded: true, errorCode: STD_ERROR_CODES.DISABLED }, "warn", 0);
      emitDegrade(name, "tool_disabled", Boolean(tool.fallbackData));
      stats.degrades += 1;
      return {
        ok: false,
        tool: name,
        data: tool.fallbackData,
        cacheHit: false,
        degraded: true,
        degradeMode: DEGRADE_MODES.SKIP,
        errorCode: STD_ERROR_CODES.DISABLED,
        error: "工具未启用",
        durationMs: 0,
      };
    }

    var key = null;
    if (!tool.native) {
      try {
        key = tool.name + "::" + tool.cacheKey(args || {});
      } catch (keyErr) {
        key = null;
      }
      if (key && Object.prototype.hasOwnProperty.call(cache, key)) {
        stats.cacheHits += 1;
        emitToolCall({ tool: name, ok: true, cacheHit: true }, "ok", 0);
        return {
          ok: true,
          tool: name,
          data: cache[key],
          cacheHit: true,
          degraded: false,
          degradeMode: null,
          errorCode: null,
          error: null,
          durationMs: clockNow() - started,
        };
      }
    }

    try {
      var raw = await runWithRetries(tool, args || {});
      var data = raw;
      if (tool.stampSource && !tool.native) {
        data = stampFactSource(raw, {
          source: tool.source,
          fetchedAt: isoNow(),
          verifyState: (raw && raw.verifyState) || VERIFY_STATE.VERIFIED,
        });
      }
      if (key) {
        cache[key] = data;
      }
      var durationOk = clockNow() - started;
      emitToolCall({ tool: name, ok: true, cacheHit: false, provider: tool.source }, "ok", durationOk);
      emitFactSource(name, data);
      return {
        ok: true,
        tool: name,
        data: data,
        cacheHit: false,
        degraded: false,
        degradeMode: null,
        errorCode: null,
        error: null,
        durationMs: durationOk,
      };
    } catch (err) {
      var code = normalizeError(err, tool.normalizeError);
      var durationErr = clockNow() - started;
      stats.errors += 1;
      emitToolCall({ tool: name, ok: false, cacheHit: false, errorCode: code, error: err && err.message }, "error", durationErr);

      if (tool.degradeMode === DEGRADE_MODES.FATAL) {
        // 致命工具失败：不降级，向上抛出（遵循无静默失败，调用方进 fallback）。
        throw err;
      }

      // 非致命：按分级降级，标注 unverified，不计硬失败。
      stats.degrades += 1;
      var fallbackData = null;
      if (tool.degradeMode === DEGRADE_MODES.CONSERVATIVE && tool.fallbackData) {
        fallbackData = stampFactSource(tool.fallbackData, {
          source: tool.source,
          fetchedAt: isoNow(),
          verifyState: VERIFY_STATE.UNVERIFIED,
        });
      }
      emitDegrade(name, code, Boolean(fallbackData));
      return {
        ok: false,
        tool: name,
        data: fallbackData,
        cacheHit: false,
        degraded: true,
        degradeMode: tool.degradeMode,
        errorCode: code,
        error: err && err.message,
        durationMs: durationErr,
      };
    }
  }

  function getStats() {
    return Object.assign({}, stats, {
      cacheSize: Object.keys(cache).length,
    });
  }

  var api = {
    register: register,
    get: get,
    isEnabled: isEnabled,
    listEnabled: listEnabled,
    invoke: invoke,
    getStats: getStats,
  };
  return api;
}

// ---- 内置外部事实工具（doc §2.2）：均以 provider（异步函数）注入，便于离线测试与替换 provider ----

// opening_hours：查询景点当日 [open, close]，供闭馆风险校验消费。
function buildOpeningHoursTool(config) {
  var cfg = config || {};
  return {
    name: "opening_hours",
    enabled: cfg.enabled !== false && typeof cfg.fetch === "function",
    timeoutMs: cfg.timeoutMs || 4000,
    retries: cfg.retries || 0,
    degradeMode: DEGRADE_MODES.SKIP,
    source: cfg.source || "opening_hours_provider",
    cacheKey: function (args) {
      return normalizeArgValue(args && args.placeName) + "|" + normalizeArgValue(args && args.date);
    },
    normalizeError: cfg.normalizeError,
    invoke: function (args) {
      if (typeof cfg.fetch !== "function") {
        var e = new Error("opening_hours 未配置 provider");
        e.code = STD_ERROR_CODES.PROVIDER_ERROR;
        throw e;
      }
      return cfg.fetch(args);
    },
  };
}

// weather：查询目的地当天/近期天气，输出风险提示（暴雨/高温/暴雪）。
function buildWeatherTool(config) {
  var cfg = config || {};
  return {
    name: "weather",
    enabled: cfg.enabled !== false && typeof cfg.fetch === "function",
    timeoutMs: cfg.timeoutMs || 4000,
    retries: cfg.retries || 0,
    degradeMode: DEGRADE_MODES.SKIP,
    source: cfg.source || "weather_provider",
    cacheKey: function (args) {
      return normalizeArgValue(args && (args.city || args.placeName)) + "|" + normalizeArgValue(args && args.date);
    },
    normalizeError: cfg.normalizeError,
    invoke: function (args) {
      if (typeof cfg.fetch !== "function") {
        var e = new Error("weather 未配置 provider");
        e.code = STD_ERROR_CODES.PROVIDER_ERROR;
        throw e;
      }
      return cfg.fetch(args);
    },
  };
}

// 内置高峰时段拥堵启发式：给定当日分钟数，返回通勤时长放大系数（无需外部 API，纯函数、可测）。
//   早高峰 07:00-09:30、晚高峰 17:00-19:30 → peakFactor；相邻肩部时段 → shoulderFactor；其余 → 1.0。
function peakHourCongestionFactor(minuteOfDay, options) {
  var opts = options || {};
  var peakFactor = Number(opts.peakFactor) || 1.4;
  var shoulderFactor = Number(opts.shoulderFactor) || 1.15;
  var m = Number(minuteOfDay);
  if (!Number.isFinite(m)) {
    return 1.0;
  }
  var inMorningPeak = m >= 420 && m <= 570; // 07:00-09:30
  var inEveningPeak = m >= 1020 && m <= 1170; // 17:00-19:30
  if (inMorningPeak || inEveningPeak) {
    return peakFactor;
  }
  var inShoulder = (m > 570 && m <= 630) || (m >= 960 && m < 1020) || (m > 1170 && m <= 1200);
  if (inShoulder) {
    return shoulderFactor;
  }
  return 1.0;
}

// congestion：对高峰时段段间通勤给出拥堵修正系数。默认走内置高峰启发式（无需外部 API）；
// 也可注入 fetch 接入实时路况 provider（如 Directions duration_in_traffic）。不可用时保守取 1.0（conservative 降级）。
function buildCongestionTool(config) {
  var cfg = config || {};
  var fetchFn = typeof cfg.fetch === "function"
    ? cfg.fetch
    : function (args) {
        return Promise.resolve({ factor: peakHourCongestionFactor(args && args.minuteOfDay, cfg) });
      };
  return {
    name: "congestion",
    enabled: cfg.enabled !== false,
    timeoutMs: cfg.timeoutMs || 3000,
    retries: cfg.retries || 0,
    degradeMode: DEGRADE_MODES.CONSERVATIVE,
    fallbackData: { factor: 1.0 },
    source: cfg.source || (typeof cfg.fetch === "function" ? "congestion_provider" : "peak_hour_heuristic"),
    cacheKey: function (args) {
      return normalizeArgValue(args && args.from) + ">" + normalizeArgValue(args && args.to) + "|" + normalizeArgValue(args && args.minuteOfDay);
    },
    normalizeError: cfg.normalizeError,
    invoke: fetchFn,
  };
}

module.exports = {
  STD_ERROR_CODES: STD_ERROR_CODES,
  DEGRADE_MODES: DEGRADE_MODES,
  VERIFY_STATE: VERIFY_STATE,
  defaultCacheKey: defaultCacheKey,
  normalizeArgValue: normalizeArgValue,
  stampFactSource: stampFactSource,
  normalizeError: normalizeError,
  withTimeout: withTimeout,
  createToolRegistry: createToolRegistry,
  buildOpeningHoursTool: buildOpeningHoursTool,
  buildWeatherTool: buildWeatherTool,
  buildCongestionTool: buildCongestionTool,
  peakHourCongestionFactor: peakHourCongestionFactor,
};
