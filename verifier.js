"use strict";

// v1.3 结构化校验器。
// 每条结论输出统一 { code, level, message, evidence, pass } 结构，level ∈ {info, warn, error}。
// 校验结果同时产出一个 score（越低越好），供修复决策器与收敛控制消费。

var agentPlanner = require("./agent-planner.js");
var tools = require("./tools.js");

var DAY_BUDGET_MIN = 10 * 60; // 单日可用时长预算（分钟）默认值，可被体力档位/checks 覆盖
// v1.6：单日只填到预算的该比例，其余留作时间冗余 buffer（用户确认 0.85 → 留 15%）。
var DAY_BUDGET_SLACK = 0.85;
var CROSS_CITY_CONFLICT_THRESHOLD = 2; // 单日跨城切换 >= 该值判定为「同日反复跨城」

// v1.5 新增校验阈值（可由 runVerifiers 的 checks 选项覆盖，便于按偏好/回归调参）
var DEFAULT_DAY_START_MIN = 9 * 60; // 默认每日出发基准时刻 09:00（doc §8.2）
var DEFAULT_PHYSICAL_MAX_VISIT_MIN = 7 * 60; // 单日纯游览（步行/参观）时长上限
var DEFAULT_PHYSICAL_MAX_VISITS = 6; // 单日景点数量上限
var DEFAULT_HOTEL_RETURN_MAX_RATIO = 0.35; // 单日回酒店往返时长占当日总时长的上限占比
// 通勤时长缺失时的保守兜底（分钟），与 evaluateTimeFeasibility 的 transit 口径一致，避免到达时刻被低估。
var DEFAULT_TRANSIT_FALLBACK_MIN = 30;

// v1.5 体力强度偏好档位（用户可在前端自选，映射到单日游览时长/景点数上限）。
// v1.6：新增 dayBudgetMin（单日「游玩+通勤+酒店往返」总时长预算），让体力强度真正影响「该排几天」，
// 不再与写死的 10h 脱钩。maxVisitMinutes 是「纯游玩」上限（不含通勤），二者量纲不同、各司其职。
var PHYSICAL_PRESETS = {
  easy: { maxVisitMinutes: 5 * 60, maxVisits: 4, dayBudgetMin: 8 * 60 },
  standard: { maxVisitMinutes: 7 * 60, maxVisits: 6, dayBudgetMin: 10 * 60 },
  hardcore: { maxVisitMinutes: 9 * 60, maxVisits: 8, dayBudgetMin: 12 * 60 },
};

function getPhysicalPreset(preference) {
  var key = String(preference || "standard").toLowerCase();
  return PHYSICAL_PRESETS[key] || PHYSICAL_PRESETS.standard;
}

var CODES = {
  TIME_OVERLOAD: "TIME_OVERLOAD",
  CROSS_CITY_CONFLICT: "CROSS_CITY_CONFLICT",
  HOTEL_LOOP_BROKEN: "HOTEL_LOOP_BROKEN",
  TOO_MANY_EMPTY_DAYS: "TOO_MANY_EMPTY_DAYS",
  // v1.5 校验层扩展（doc §2.1.3 / §3.2）
  OPENING_RISK: "OPENING_RISK",
  PHYSICAL_OVERLOAD: "PHYSICAL_OVERLOAD",
  HOTEL_RETURN_COST: "HOTEL_RETURN_COST",
};

// 解析营业时间为「当日分钟数」；支持 "HH:MM" 字符串或直接数字（分钟）。
function parseClockToMinutes(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  var text = String(value).trim();
  var match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    var asNum = Number(text);
    return Number.isFinite(asNum) ? asNum : null;
  }
  var hh = Number(match[1]);
  var mm = Number(match[2]);
  if (hh > 24 || mm > 59) {
    return null;
  }
  return hh * 60 + mm;
}

function formatMinutes(min) {
  var m = Math.max(0, Math.round(Number(min) || 0));
  var hh = Math.floor(m / 60);
  var mm = m % 60;
  return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
}

// v1.5 时间轴推算（doc §8.2）：由当日出发基准时刻起，沿 segments 累加游览时长 + 段间通勤，
// 得到每个 visit 的「预计到达时刻」（当日分钟数），供闭馆风险判定使用。
function computeArrivalTimeline(dayPlan, dayStartMin, congestion) {
  var segments = Array.isArray(dayPlan && dayPlan.segments) ? dayPlan.segments : [];
  var cursor = Number.isFinite(Number(dayStartMin)) ? Number(dayStartMin) : DEFAULT_DAY_START_MIN;
  var useCongestion = Boolean(congestion && congestion.enabled);
  var arrivals = [];
  segments.forEach(function (segment) {
    if (!segment) {
      return;
    }
    if (segment.type === "transit") {
      // 通勤时长缺失时用保守兜底（而非 0），避免到达时刻被低估导致闭馆风险漏报。
      var transitMin = Number(segment.durationMin);
      var base = Number.isFinite(transitMin) && transitMin > 0 ? transitMin : DEFAULT_TRANSIT_FALLBACK_MIN;
      // v1.5 拥堵修正：按出发时刻（当前累计分钟）用高峰启发式放大通勤时长。
      if (useCongestion) {
        base = base * tools.peakHourCongestionFactor(cursor, congestion);
      }
      cursor += base;
      return;
    }
    if (segment.type === "visit") {
      var visitMin = Number(segment.visitDurationMin) || 90;
      arrivals.push({
        placeName: segment.placeName || "",
        arrivalMin: cursor,
        visitDurationMin: visitMin,
      });
      cursor += visitMin;
    }
  });
  return arrivals;
}

function normalizeName(name) {
  return agentPlanner.normalizeName(name);
}

function visitItemsOfDay(dayPlan) {
  return (Array.isArray(dayPlan && dayPlan.items) ? dayPlan.items : []).filter(function (item) {
    return item && item.type === "visit";
  });
}

// 统计单日在 planData 上的跨城切换次数（相邻 visit 的城市不同即一次切换）。
function countCrossCityTransitions(dayPlan, cityOf) {
  var items = visitItemsOfDay(dayPlan);
  var lookup = typeof cityOf === "function" ? cityOf : function () { return ""; };
  var transitions = 0;
  var i;
  for (i = 1; i < items.length; i += 1) {
    var prevCity = normalizeName(lookup(items[i - 1].title));
    var curCity = normalizeName(lookup(items[i].title));
    if (prevCity && curCity && prevCity !== curCity) {
      transitions += 1;
    }
  }
  return transitions;
}

function distinctCitiesOfDay(dayPlan, cityOf) {
  var items = visitItemsOfDay(dayPlan);
  var lookup = typeof cityOf === "function" ? cityOf : function () { return ""; };
  var set = {};
  items.forEach(function (item) {
    var city = normalizeName(lookup(item.title));
    if (city) {
      set[city] = true;
    }
  });
  return Object.keys(set);
}

// 主入口：输入 { planData, dailyPlans, lodging, requestedDays, cityOf }，输出 { pass, score, findings }。
function runVerifiers(context) {
  var ctx = context || {};
  var planData = Array.isArray(ctx.planData) ? ctx.planData : [];
  var dailyPlans = Array.isArray(ctx.dailyPlans) ? ctx.dailyPlans : [];
  var lodging = ctx.lodging || null;
  var requestedDays = Number(ctx.requestedDays) || planData.length || dailyPlans.length;
  var cityOf = typeof ctx.cityOf === "function" ? ctx.cityOf : function () { return ""; };
  // v1.5 校验层扩展的输入（均为可选，未提供则对应校验器不激活，保证向后兼容）。
  var checks = ctx.checks || {};

  var findings = [];
  var score = 0;

  // 1) TIME_OVERLOAD：单日超载（含酒店往返交通）。
  // v1.6：单日预算随体力强度而变（checks.dayBudgetMin），并按 checks.dayBudgetSlack 预留时间冗余，
  // 与 estimateNaturalDaysAndSubset / evaluateTimeFeasibility 口径一致。
  var baseBudget = Number.isFinite(Number(checks.dayBudgetMin)) ? Number(checks.dayBudgetMin) : DAY_BUDGET_MIN;
  var budgetSlack = Number.isFinite(Number(checks.dayBudgetSlack)) && Number(checks.dayBudgetSlack) > 0
    ? Number(checks.dayBudgetSlack)
    : 1;
  var usableBudget = Math.max(1, Math.round(baseBudget * budgetSlack));
  var feasibility = agentPlanner.evaluateTimeFeasibility(dailyPlans, requestedDays, {
    dayBudgetMin: baseBudget,
    slack: budgetSlack,
  });
  (feasibility.overloadedDays || []).forEach(function (item) {
    var over = Math.max(0, Number(item.estimatedMinutes) - usableBudget);
    score += over;
    findings.push({
      code: CODES.TIME_OVERLOAD,
      level: "error",
      pass: false,
      message: "第 " + item.day + " 天预计约 " + item.estimatedMinutes + " 分钟，超过单日 " + usableBudget + " 分钟可用预算。",
      evidence: {
        day: item.day,
        estimatedMinutes: item.estimatedMinutes,
        budgetMinutes: usableBudget,
        overMinutes: over,
      },
    });
  });

  // 2) HOTEL_LOOP_BROKEN：设置酒店但某日未闭环
  var closure = agentPlanner.verifyHotelClosure(dailyPlans, lodging);
  (closure.openDays || []).forEach(function (day) {
    score += 120;
    findings.push({
      code: CODES.HOTEL_LOOP_BROKEN,
      level: "error",
      pass: false,
      message: "第 " + day + " 天未能形成酒店闭环（首段应从酒店出发、末段应回到酒店）。",
      evidence: { day: day },
    });
  });

  // 3) CROSS_CITY_CONFLICT：同一日反复跨城
  planData.forEach(function (dayPlan) {
    var transitions = countCrossCityTransitions(dayPlan, cityOf);
    if (transitions >= CROSS_CITY_CONFLICT_THRESHOLD) {
      score += transitions * 60;
      findings.push({
        code: CODES.CROSS_CITY_CONFLICT,
        level: "error",
        pass: false,
        message: "第 " + (dayPlan.day || "?") + " 天存在 " + transitions + " 次同日跨城切换，行程折返明显。",
        evidence: {
          day: dayPlan.day,
          transitions: transitions,
          cities: distinctCitiesOfDay(dayPlan, cityOf),
        },
      });
    }
  });

  // 4) TOO_MANY_EMPTY_DAYS：存在空天（无景点）
  var emptyDays = [];
  planData.forEach(function (dayPlan) {
    if (visitItemsOfDay(dayPlan).length === 0) {
      emptyDays.push(dayPlan.day);
    }
  });
  var nonEmptyCount = planData.length - emptyDays.length;
  if (emptyDays.length > 0 && nonEmptyCount > 0) {
    score += emptyDays.length * 45;
    findings.push({
      code: CODES.TOO_MANY_EMPTY_DAYS,
      level: "warn",
      pass: false,
      message: "存在 " + emptyDays.length + " 个空天（第 " + emptyDays.join("、") + " 天无景点），可考虑并天。",
      evidence: { emptyDays: emptyDays, totalDays: planData.length },
    });
  }

  // 5) OPENING_RISK：按时间轴推算的预计到达晚于闭馆（doc §2.1.3 / §8.2）
  //    仅当调用方提供 openingHoursByPlace 时激活；数据缺失/未核实降级为 warn，不当作 pass。
  var openingByPlace = checks.openingHoursByPlace || null;
  if (openingByPlace && Object.keys(openingByPlace).length) {
    var dayStartMin = Number.isFinite(Number(checks.dayStartMin)) ? Number(checks.dayStartMin) : DEFAULT_DAY_START_MIN;
    dailyPlans.forEach(function (dayPlan) {
      var arrivals = computeArrivalTimeline(dayPlan, dayStartMin, checks.congestion);
      arrivals.forEach(function (arrival) {
        var record = openingByPlace[normalizeName(arrival.placeName)];
        if (!record) {
          return;
        }
        var openMin = parseClockToMinutes(record.open);
        var closeMin = parseClockToMinutes(record.close);
        var unverified = record.verifyState === "unverified";
        if (closeMin === null) {
          return;
        }
        var finding = null;
        if (arrival.arrivalMin >= closeMin) {
          // 到达即已闭馆：数据可信时判 error，未核实时降级 warn。
          finding = {
            code: CODES.OPENING_RISK,
            level: unverified ? "warn" : "error",
            pass: false,
            message: "第 " + (dayPlan.day || "?") + " 天预计 " + formatMinutes(arrival.arrivalMin) +
              " 到达「" + arrival.placeName + "」，晚于闭馆 " + formatMinutes(closeMin) +
              (unverified ? "（营业时间未核实）" : "") + "。",
            evidence: {
              day: dayPlan.day,
              place: arrival.placeName,
              arrival: formatMinutes(arrival.arrivalMin),
              close: formatMinutes(closeMin),
              gapMin: arrival.arrivalMin - closeMin,
              verifyState: record.verifyState || "verified",
            },
          };
          score += unverified ? 30 : 90;
        } else if (closeMin - arrival.arrivalMin < arrival.visitDurationMin) {
          // 到点但剩余时间不足以完成游览：warn。
          finding = {
            code: CODES.OPENING_RISK,
            level: "warn",
            pass: false,
            message: "第 " + (dayPlan.day || "?") + " 天到达「" + arrival.placeName + "」后距闭馆仅剩 " +
              (closeMin - arrival.arrivalMin) + " 分钟，不足建议游览 " + arrival.visitDurationMin + " 分钟。",
            evidence: {
              day: dayPlan.day,
              place: arrival.placeName,
              arrival: formatMinutes(arrival.arrivalMin),
              close: formatMinutes(closeMin),
              remainMin: closeMin - arrival.arrivalMin,
              needMin: arrival.visitDurationMin,
              verifyState: record.verifyState || "verified",
            },
          };
          score += 25;
        }
        if (finding) {
          findings.push(finding);
        }
      });
    });
  }

  // 6) PHYSICAL_OVERLOAD：单日累计游览时长/景点数超阈值 → warn（doc §2.1.3）
  var physical = checks.physicalLoad || null;
  if (physical && physical.enabled) {
    var maxVisitMin = Number(physical.maxVisitMinutes) || DEFAULT_PHYSICAL_MAX_VISIT_MIN;
    var maxVisits = Number(physical.maxVisits) || DEFAULT_PHYSICAL_MAX_VISITS;
    dailyPlans.forEach(function (dayPlan) {
      var segments = Array.isArray(dayPlan.segments) ? dayPlan.segments : [];
      var visitMinutes = 0;
      var visitCount = 0;
      segments.forEach(function (segment) {
        if (segment && segment.type === "visit") {
          visitMinutes += Number(segment.visitDurationMin) || 90;
          visitCount += 1;
        }
      });
      if (visitMinutes > maxVisitMin || visitCount > maxVisits) {
        score += 40;
        findings.push({
          code: CODES.PHYSICAL_OVERLOAD,
          level: "warn",
          pass: false,
          message: "第 " + (dayPlan.day || "?") + " 天累计游览约 " + visitMinutes + " 分钟 / " + visitCount +
            " 个景点，体力强度偏高，建议拆天或降密度。",
          evidence: {
            day: dayPlan.day,
            visitMinutes: visitMinutes,
            visitCount: visitCount,
            maxVisitMinutes: maxVisitMin,
            maxVisits: maxVisits,
          },
        });
      }
    });
  }

  // 7) HOTEL_RETURN_COST：单日回酒店往返成本占比过高 → warn（doc §2.1.3 / §3.2）
  var hotelReturn = checks.hotelReturnCost || null;
  var hotelName = lodging && lodging.hotel && lodging.hotel.name ? String(lodging.hotel.name).trim() : "";
  if (hotelReturn && hotelReturn.enabled && hotelName) {
    var maxRatio = Number.isFinite(Number(hotelReturn.maxRatio)) ? Number(hotelReturn.maxRatio) : DEFAULT_HOTEL_RETURN_MAX_RATIO;
    dailyPlans.forEach(function (dayPlan) {
      var segments = Array.isArray(dayPlan.segments) ? dayPlan.segments : [];
      if (!segments.length) {
        return;
      }
      var totalMin = 0;
      segments.forEach(function (segment) {
        if (segment && segment.type === "visit") {
          totalMin += Number(segment.visitDurationMin) || 90;
        } else if (segment && segment.type === "transit") {
          totalMin += Number(segment.durationMin) || 0;
        }
      });
      var first = segments[0];
      var last = segments[segments.length - 1];
      var returnMin = 0;
      if (first && first.type === "transit" && first.from === hotelName) {
        returnMin += Number(first.durationMin) || 0;
      }
      if (last && last.type === "transit" && last.to === hotelName) {
        returnMin += Number(last.durationMin) || 0;
      }
      if (returnMin <= 0 || totalMin <= 0) {
        return;
      }
      var ratio = returnMin / totalMin;
      if (ratio > maxRatio) {
        score += 30;
        findings.push({
          code: CODES.HOTEL_RETURN_COST,
          level: "warn",
          pass: false,
          message: "第 " + (dayPlan.day || "?") + " 天回酒店往返约 " + returnMin + " 分钟，占当日 " +
            Math.round(ratio * 100) + "%，往返成本偏高，建议换序或就近换酒店。",
          evidence: {
            day: dayPlan.day,
            returnMin: returnMin,
            totalMin: totalMin,
            ratio: Math.round(ratio * 100) / 100,
            maxRatio: maxRatio,
          },
        });
      }
    });
  }

  var hasError = findings.some(function (f) {
    return f.level === "error";
  });

  return {
    pass: !hasError,
    score: score,
    findings: findings,
  };
}

module.exports = {
  CODES: CODES,
  DAY_BUDGET_MIN: DAY_BUDGET_MIN,
  DAY_BUDGET_SLACK: DAY_BUDGET_SLACK,
  CROSS_CITY_CONFLICT_THRESHOLD: CROSS_CITY_CONFLICT_THRESHOLD,
  DEFAULT_DAY_START_MIN: DEFAULT_DAY_START_MIN,
  DEFAULT_PHYSICAL_MAX_VISIT_MIN: DEFAULT_PHYSICAL_MAX_VISIT_MIN,
  DEFAULT_PHYSICAL_MAX_VISITS: DEFAULT_PHYSICAL_MAX_VISITS,
  DEFAULT_HOTEL_RETURN_MAX_RATIO: DEFAULT_HOTEL_RETURN_MAX_RATIO,
  DEFAULT_TRANSIT_FALLBACK_MIN: DEFAULT_TRANSIT_FALLBACK_MIN,
  PHYSICAL_PRESETS: PHYSICAL_PRESETS,
  getPhysicalPreset: getPhysicalPreset,
  runVerifiers: runVerifiers,
  countCrossCityTransitions: countCrossCityTransitions,
  computeArrivalTimeline: computeArrivalTimeline,
  parseClockToMinutes: parseClockToMinutes,
};
