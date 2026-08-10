"use strict";

// v1.3 结构化校验器。
// 每条结论输出统一 { code, level, message, evidence, pass } 结构，level ∈ {info, warn, error}。
// 校验结果同时产出一个 score（越低越好），供修复决策器与收敛控制消费。

var agentPlanner = require("./agent-planner.js");

var DAY_BUDGET_MIN = 10 * 60; // 单日可用时长预算（分钟），与既有排程口径一致
var CROSS_CITY_CONFLICT_THRESHOLD = 2; // 单日跨城切换 >= 该值判定为「同日反复跨城」

var CODES = {
  TIME_OVERLOAD: "TIME_OVERLOAD",
  CROSS_CITY_CONFLICT: "CROSS_CITY_CONFLICT",
  HOTEL_LOOP_BROKEN: "HOTEL_LOOP_BROKEN",
  TOO_MANY_EMPTY_DAYS: "TOO_MANY_EMPTY_DAYS",
};

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

  var findings = [];
  var score = 0;

  // 1) TIME_OVERLOAD：单日超载（含酒店往返交通）
  var feasibility = agentPlanner.evaluateTimeFeasibility(dailyPlans, requestedDays);
  (feasibility.overloadedDays || []).forEach(function (item) {
    var over = Math.max(0, Number(item.estimatedMinutes) - DAY_BUDGET_MIN);
    score += over;
    findings.push({
      code: CODES.TIME_OVERLOAD,
      level: "error",
      pass: false,
      message: "第 " + item.day + " 天预计约 " + item.estimatedMinutes + " 分钟，超过单日 " + DAY_BUDGET_MIN + " 分钟预算。",
      evidence: {
        day: item.day,
        estimatedMinutes: item.estimatedMinutes,
        budgetMinutes: DAY_BUDGET_MIN,
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
  CROSS_CITY_CONFLICT_THRESHOLD: CROSS_CITY_CONFLICT_THRESHOLD,
  runVerifiers: runVerifiers,
  countCrossCityTransitions: countCrossCityTransitions,
};
