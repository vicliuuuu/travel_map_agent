"use strict";

// v2.0（变体 A）对话式约束抽取与草稿管理。
//
// 定位（见 doc_auto/内测-v2.0-实施方案.md）：把多轮自然语言收敛为结构化「约束草稿」，
// 供对话状态机决定「该问 / 可规划」，并在规划前映射为现有 plan 端点入参。
//
// 设计原则：
// - 纯函数为主（合并/必填判定/澄清决策/草稿→入参），便于单测、不依赖网络。
// - 抽取走注入的 LLM 调用（function-calling / JSON），抽取解析（parseExtraction）本身是纯函数。
// - 安全边界：绝不抽取/记录任何 API key、Base URL、model。
// - 无静默失败：解析异常抛出由调用方处理，不返回“看似正常”的空结果掩盖错误。

var STRATEGY_VALUES = ["fastest", "least-transfer", "classic"];
var TRANSPORT_VALUES = ["driving", "transit", "walking"];
var PHYSICAL_VALUES = ["easy", "standard", "hardcore"];
var REQUIRED_FIELDS = ["destinations", "places", "totalDays"];
var DEFAULTS = { visitMinutes: 90, strategy: "fastest", transport: "driving", physical: "standard" };
var DEFAULT_CLARIFY_BUDGET = 6;

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function coerceEnum(value, allowed) {
  var v = String(value || "").trim().toLowerCase();
  return allowed.indexOf(v) >= 0 ? v : null;
}

function coerceDays(value) {
  var n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.min(30, Math.floor(n));
}

function coerceVisitMinutes(value) {
  var n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.max(30, Math.min(480, Math.floor(n)));
}

function emptyDraft() {
  return {
    destinations: [],
    places: [],
    hotels: [],
    totalDays: null,
    visitMinutes: null,
    strategy: null,
    transport: null,
    physical: null,
    _confidence: {},
    _assumptions: [],
  };
}

function cleanDestination(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  var country = String(item.country || "").trim();
  var city = String(item.city || "").trim();
  if (!country && !city) {
    return null;
  }
  return { country: country, city: city };
}

function cleanPlace(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  var name = String(item.name || "").trim();
  if (!name) {
    return null;
  }
  var out = { name: name, address: String(item.address || "").trim() };
  var city = String(item.city || "").trim();
  if (city) {
    out.city = city;
  }
  return out;
}

function cleanHotel(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  var name = String(item.name || "").trim();
  var address = String(item.address || "").trim();
  if (!name && !address) {
    return null;
  }
  return {
    name: name,
    address: address,
    checkInDate: String(item.checkInDate || "").trim(),
    checkOutDate: String(item.checkOutDate || "").trim(),
  };
}

// 把 LLM 返回的原始 JSON 抽取结果，校验/裁剪为干净的 delta（纯函数）。
function parseExtraction(rawJson) {
  var raw = rawJson;
  if (typeof raw === "string") {
    raw = JSON.parse(raw); // 非法 JSON 抛错，不静默
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("parseExtraction: 抽取结果需为对象");
  }
  var delta = {};
  if (Array.isArray(raw.destinations)) {
    delta.destinations = raw.destinations.map(cleanDestination).filter(Boolean);
  }
  if (Array.isArray(raw.places)) {
    delta.places = raw.places.map(cleanPlace).filter(Boolean);
  }
  if (Array.isArray(raw.hotels)) {
    delta.hotels = raw.hotels.map(cleanHotel).filter(Boolean);
  }
  var days = coerceDays(raw.totalDays);
  if (days !== null) {
    delta.totalDays = days;
  }
  var vm = coerceVisitMinutes(raw.visitMinutes);
  if (vm !== null) {
    delta.visitMinutes = vm;
  }
  var strat = coerceEnum(raw.strategy, STRATEGY_VALUES);
  if (strat) {
    delta.strategy = strat;
  }
  var trans = coerceEnum(raw.transport, TRANSPORT_VALUES);
  if (trans) {
    delta.transport = trans;
  }
  var phys = coerceEnum(raw.physical, PHYSICAL_VALUES);
  if (phys) {
    delta.physical = phys;
  }
  var confidence = raw.confidence && typeof raw.confidence === "object" ? raw.confidence : {};
  return { delta: delta, confidence: confidence };
}

function unionByKey(prevList, deltaList, keyFn) {
  var out = (prevList || []).slice();
  var seen = {};
  out.forEach(function (item) {
    seen[keyFn(item)] = true;
  });
  (deltaList || []).forEach(function (item) {
    var k = keyFn(item);
    if (!seen[k]) {
      seen[k] = true;
      out.push(item);
    }
  });
  return out;
}

// 把 delta 增量合并到草稿，返回新草稿（不改入参）。
function mergeConstraints(prev, delta) {
  var base = prev || emptyDraft();
  var d = delta || {};
  var next = {
    destinations: base.destinations ? base.destinations.slice() : [],
    places: base.places ? base.places.slice() : [],
    hotels: base.hotels ? base.hotels.slice() : [],
    totalDays: base.totalDays,
    visitMinutes: base.visitMinutes,
    strategy: base.strategy,
    transport: base.transport,
    physical: base.physical,
    _confidence: Object.assign({}, base._confidence || {}),
    _assumptions: (base._assumptions || []).slice(),
  };
  if (d.destinations) {
    next.destinations = unionByKey(next.destinations, d.destinations, function (x) {
      return normalizeName(x.country) + "|" + normalizeName(x.city);
    });
  }
  if (d.places) {
    next.places = unionByKey(next.places, d.places, function (x) {
      return normalizeName(x.name);
    });
  }
  if (d.hotels) {
    next.hotels = unionByKey(next.hotels, d.hotels, function (x) {
      return normalizeName(x.name) + "|" + normalizeName(x.address);
    });
  }
  ["totalDays", "visitMinutes", "strategy", "transport", "physical"].forEach(function (key) {
    if (d[key] !== undefined && d[key] !== null) {
      next[key] = d[key];
    }
  });
  if (d.confidence && typeof d.confidence === "object") {
    Object.assign(next._confidence, d.confidence);
  }
  return next;
}

function hasDestination(draft) {
  var dests = (draft && draft.destinations) || [];
  var hasDest = dests.some(function (x) {
    return (x.country && x.country.length) || (x.city && x.city.length);
  });
  if (hasDest) {
    return true;
  }
  // 兜底：景点自带城市也算有目的地信息。
  return ((draft && draft.places) || []).some(function (p) {
    return p.city && p.city.length;
  });
}

function missingRequired(draft) {
  var d = draft || {};
  var missing = [];
  if (!hasDestination(d)) {
    missing.push("destinations");
  }
  if (!((d.places || []).length)) {
    missing.push("places");
  }
  if (!(coerceDays(d.totalDays) !== null)) {
    missing.push("totalDays");
  }
  return missing;
}

function isRequiredComplete(draft) {
  return missingRequired(draft).length === 0;
}

var CLARIFY_QUESTIONS = {
  destinations: "你想去哪个国家/城市呢？可以多个。",
  places: "有哪些想去的景点？（可以只说名字，我来定位）",
  totalDays: "这趟大概玩几天？",
};

// 澄清决策：仅当必填缺失且未超澄清预算时追问；否则不问（进入确认/规划或用默认继续）。
function decideClarify(draft, turnIndex, budget) {
  var b = Number(budget) || DEFAULT_CLARIFY_BUDGET;
  var missing = missingRequired(draft);
  if (!missing.length) {
    return { shouldAsk: false, question: null, triggeredBy: null, reason: "required_complete" };
  }
  if (Number(turnIndex) >= b) {
    return { shouldAsk: false, question: null, triggeredBy: null, reason: "budget_exhausted", missing: missing };
  }
  var field = missing[0];
  return {
    shouldAsk: true,
    question: CLARIFY_QUESTIONS[field] || ("请补充：" + field),
    triggeredBy: field,
    reason: "missing_required",
    missing: missing,
  };
}

// 为非必填字段补默认值，返回默认后的取值 + 假设说明（供确认语展示）。
function applyDefaults(draft) {
  var d = draft || {};
  var assumptions = [];
  var strategy = d.strategy;
  if (!strategy) {
    strategy = DEFAULTS.strategy;
    assumptions.push("未指定策略，默认「省时优先」");
  }
  var transport = d.transport;
  if (!transport) {
    transport = DEFAULTS.transport;
    assumptions.push("未指定出行方式，默认「驾车」");
  }
  var physical = d.physical;
  if (!physical) {
    physical = DEFAULTS.physical;
    assumptions.push("未指定体力强度，默认「标准」");
  }
  var visitMinutes = d.visitMinutes;
  if (!visitMinutes) {
    visitMinutes = DEFAULTS.visitMinutes;
  }
  return { strategy: strategy, transport: transport, physical: physical, visitMinutes: visitMinutes, assumptions: assumptions };
}

// 把草稿的目的地 + 景点，组装成层级 destinations（按城市分组景点）。
function groupDestinations(draft) {
  var dests = Array.isArray(draft.destinations) ? draft.destinations : [];
  var places = Array.isArray(draft.places) ? draft.places : [];
  var countries = [];
  function ensureCountry(name) {
    var c = countries.filter(function (x) { return x.country === name; })[0];
    if (!c) {
      c = { country: name, cities: [] };
      countries.push(c);
    }
    return c;
  }
  function ensureCity(country, cityName) {
    var ci = country.cities.filter(function (x) { return x.city === cityName; })[0];
    if (!ci) {
      ci = { city: cityName, places: [] };
      country.cities.push(ci);
    }
    return ci;
  }
  dests.forEach(function (dd) {
    var c = ensureCountry(dd.country || "");
    ensureCity(c, dd.city || "");
  });
  function findCityBlock(cityName) {
    for (var i = 0; i < countries.length; i += 1) {
      var found = countries[i].cities.filter(function (x) { return x.city === cityName; })[0];
      if (found) {
        return found;
      }
    }
    return null;
  }
  places.forEach(function (p) {
    var target = null;
    if (p.city) {
      target = findCityBlock(p.city);
      if (!target) {
        target = ensureCity(ensureCountry(""), p.city);
      }
    }
    if (!target) {
      if (!countries.length) {
        target = ensureCity(ensureCountry(""), "");
      } else if (!countries[0].cities.length) {
        target = ensureCity(countries[0], "");
      } else {
        target = countries[0].cities[0];
      }
    }
    target.places.push({ name: p.name, address: p.address || "" });
  });
  return countries;
}

// 草稿 → 现有 plan 端点入参（不含 API key，key 由端点侧另行注入）。
function buildPlanInputFromDraft(draft) {
  var d = draft || {};
  var defaults = applyDefaults(d);
  var destinations = groupDestinations(d);
  var flatPlaces = (d.places || []).map(function (p) {
    return { name: p.name, address: p.address || "" };
  });
  var primary = destinations[0] || { country: "", cities: [] };
  var primaryCity = (primary.cities && primary.cities[0] && primary.cities[0].city) || "";
  var lodging = (Array.isArray(d.hotels) && d.hotels.length)
    ? { hotels: d.hotels.map(function (h) {
      return {
        name: h.name || "",
        address: h.address || "",
        checkInDate: h.checkInDate || "",
        checkOutDate: h.checkOutDate || "",
      };
    }) }
    : null;
  return {
    destinations: destinations,
    places: flatPlaces,
    country: primary.country || "",
    city: primaryCity,
    lodging: lodging,
    totalDays: coerceDays(d.totalDays) || 1,
    visitMinutes: defaults.visitMinutes,
    strategy: defaults.strategy,
    transportPreference: defaults.transport,
    physicalPreference: defaults.physical,
    _assumptions: defaults.assumptions,
  };
}

function buildExtractionSystemPrompt() {
  return [
    "你是旅行需求抽取器。从对话中抽取用户的旅行硬约束，只输出 JSON，不要解释、不要 markdown 包裹。",
    "严禁询问或抽取任何 API Key、密钥、Base URL、模型名等技术配置。",
    "输出字段（只输出你有把握的字段，没提到的省略）：",
    "{",
    '  "destinations": [{"country":"国家","city":"城市"}],',
    '  "places": [{"name":"景点名","address":"可选地址","city":"可选所属城市"}],',
    '  "hotels": [{"name":"酒店名","address":"地址","checkInDate":"YYYY-MM-DD","checkOutDate":"YYYY-MM-DD"}],',
    '  "totalDays": 3,',
    '  "visitMinutes": 90,',
    '  "strategy": "fastest|least-transfer|classic",',
    '  "transport": "driving|transit|walking",',
    '  "physical": "easy|standard|hardcore",',
    '  "confidence": {"字段名": 0.0}',
    "}",
    "映射提示：带娃/老人/慢节奏→physical=easy；特种兵/暴走→physical=hardcore；",
    "少走冤枉路/不走回头路→strategy=classic；尽量省时→fastest；少换乘/怕折腾→least-transfer；",
    "地铁/公交→transport=transit；走路→walking；开车/自驾→driving。",
  ].join("\n");
}

function buildExtractionMessages(dialogHistory, draft) {
  var history = Array.isArray(dialogHistory) ? dialogHistory : [];
  var convo = history.map(function (m) {
    return (m.role === "user" ? "用户" : "助手") + "：" + String(m.content || "");
  }).join("\n");
  var draftSummary = JSON.stringify({
    destinations: (draft && draft.destinations) || [],
    places: ((draft && draft.places) || []).map(function (p) { return p.name; }),
    totalDays: (draft && draft.totalDays) || null,
  });
  return [
    { role: "system", content: buildExtractionSystemPrompt() },
    {
      role: "user",
      content: [
        "已知草稿（避免重复抽取，但可补充/更正）：",
        draftSummary,
        "",
        "对话记录：",
        convo,
        "",
        "请输出本轮可抽取到的约束 JSON。",
      ].join("\n"),
    },
  ];
}

// 抽取约束：callLlm 为注入的 (messages) => Promise<rawJsonStringOrObject>。
function extractConstraints(dialogHistory, draft, callLlm) {
  if (typeof callLlm !== "function") {
    return Promise.reject(new Error("extractConstraints: 需要注入 callLlm"));
  }
  var messages = buildExtractionMessages(dialogHistory, draft);
  return Promise.resolve()
    .then(function () { return callLlm(messages); })
    .then(function (raw) { return parseExtraction(raw); });
}

module.exports = {
  STRATEGY_VALUES: STRATEGY_VALUES,
  TRANSPORT_VALUES: TRANSPORT_VALUES,
  PHYSICAL_VALUES: PHYSICAL_VALUES,
  REQUIRED_FIELDS: REQUIRED_FIELDS,
  DEFAULTS: DEFAULTS,
  DEFAULT_CLARIFY_BUDGET: DEFAULT_CLARIFY_BUDGET,
  emptyDraft: emptyDraft,
  parseExtraction: parseExtraction,
  mergeConstraints: mergeConstraints,
  missingRequired: missingRequired,
  isRequiredComplete: isRequiredComplete,
  decideClarify: decideClarify,
  applyDefaults: applyDefaults,
  groupDestinations: groupDestinations,
  buildPlanInputFromDraft: buildPlanInputFromDraft,
  buildExtractionMessages: buildExtractionMessages,
  extractConstraints: extractConstraints,
};
