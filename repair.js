"use strict";

// v1.3 修复动作库 + 决策器 + 收敛控制。
// 通用契约：repair(planData, failure, context) -> { planData: newPlan, changeLog }
// 所有动作为纯函数（深拷贝输入，不修改原对象），可单测、可复盘。

var agentPlanner = require("./agent-planner.js");
var verifier = require("./verifier.js");

var CODES = verifier.CODES;

var MAX_REPAIR_ROUNDS = 3;
var NO_IMPROVE_LIMIT = 2;

function normalizeName(name) {
  return agentPlanner.normalizeName(name);
}

function clonePlan(planData) {
  return JSON.parse(JSON.stringify(Array.isArray(planData) ? planData : []));
}

function renumberDays(planData) {
  planData.forEach(function (dayPlan, index) {
    dayPlan.day = index + 1;
  });
  return planData;
}

function visitItems(dayPlan) {
  return (Array.isArray(dayPlan && dayPlan.items) ? dayPlan.items : []).filter(function (item) {
    return item && item.type === "visit";
  });
}

function priorityRank(priority) {
  var p = String(priority || "medium").toLowerCase();
  if (p === "high") {
    return 3;
  }
  if (p === "low") {
    return 1;
  }
  return 2;
}

function findDayIndexByNumber(planData, dayNumber) {
  var target = Number(dayNumber);
  var idx = planData.findIndex(function (dayPlan) {
    return Number(dayPlan.day) === target;
  });
  return idx;
}

// split_day（拆天）：把超载日的后半段景点拆到紧随其后的新的一天。
function splitDay(planData, failure, context) {
  var plan = clonePlan(planData);
  var evidence = (failure && failure.evidence) || {};
  var idx = findDayIndexByNumber(plan, evidence.day);
  if (idx < 0) {
    // 无法定位则退化为拆分景点最多的一天
    idx = plan.reduce(function (bestIdx, dayPlan, i) {
      return visitItems(dayPlan).length > visitItems(plan[bestIdx]).length ? i : bestIdx;
    }, 0);
  }
  var dayPlan = plan[idx];
  var items = visitItems(dayPlan);
  if (items.length <= 1) {
    return {
      planData: plan,
      changeLog: {
        action: "split_day",
        dayAffected: dayPlan.day,
        moved: [],
        note: "该日仅 1 个景点，无法再拆分",
        noop: true,
      },
    };
  }
  var half = Math.ceil(items.length / 2);
  var keep = items.slice(0, half);
  var moved = items.slice(half);
  dayPlan.items = keep.slice();
  var newDay = {
    day: dayPlan.day + 1,
    city: dayPlan.city || "",
    items: moved.slice(),
  };
  plan.splice(idx + 1, 0, newDay);
  renumberDays(plan);
  return {
    planData: plan,
    changeLog: {
      action: "split_day",
      dayAffected: idx + 1,
      moved: moved.map(function (item) { return item.title; }),
      note: "第 " + (idx + 1) + " 天超载，已拆出 " + moved.length + " 个景点到新的一天",
    },
  };
}

// drop_lowest_priority（降优先级删点）：删除优先级最低（并列时时长最长）的景点，记录到替代方案。
function dropLowestPriority(planData, failure, context) {
  var plan = clonePlan(planData);
  var ctx = context || {};
  var priorityOf = typeof ctx.priorityOf === "function" ? ctx.priorityOf : function () { return "medium"; };
  var candidates = [];
  plan.forEach(function (dayPlan, dayIdx) {
    visitItems(dayPlan).forEach(function (item, itemIdx) {
      candidates.push({
        dayIdx: dayIdx,
        title: item.title,
        rank: priorityRank(priorityOf(item.title)),
        durationMin: Number(item.durationMin) || 90,
      });
    });
  });
  if (!candidates.length) {
    return {
      planData: plan,
      changeLog: { action: "drop_lowest_priority", removed: [], note: "无可删景点", noop: true },
    };
  }
  candidates.sort(function (a, b) {
    if (a.rank !== b.rank) {
      return a.rank - b.rank; // 优先级低者在前
    }
    return b.durationMin - a.durationMin; // 同优先级删更耗时者
  });
  var victim = candidates[0];
  var dayPlan = plan[victim.dayIdx];
  dayPlan.items = (dayPlan.items || []).filter(function (item) {
    return !(item && item.type === "visit" && normalizeName(item.title) === normalizeName(victim.title));
  });
  return {
    planData: plan,
    changeLog: {
      action: "drop_lowest_priority",
      dayAffected: dayPlan.day,
      removed: [victim.title],
      note: "删除优先级最低的景点「" + victim.title + "」以缓解超载，已列入替代方案",
    },
  };
}

// swap_neighbor（就近换序）：对指定日内景点按城市聚类稳定重排，减少同日跨城折返。
function swapNeighbor(planData, failure, context) {
  var plan = clonePlan(planData);
  var ctx = context || {};
  var cityOf = typeof ctx.cityOf === "function" ? ctx.cityOf : function () { return ""; };
  var evidence = (failure && failure.evidence) || {};
  var idx = findDayIndexByNumber(plan, evidence.day);
  if (idx < 0) {
    idx = 0;
  }
  var dayPlan = plan[idx];
  var items = Array.isArray(dayPlan.items) ? dayPlan.items.slice() : [];
  var before = visitItems(dayPlan).map(function (item) { return item.title; });

  // 按首次出现的城市顺序做稳定聚类，保证同城连续，减少跨城切换
  var cityOrder = [];
  var grouped = {};
  items.forEach(function (item) {
    if (!item || item.type !== "visit") {
      return;
    }
    var city = normalizeName(cityOf(item.title)) || "__unknown__";
    if (!grouped[city]) {
      grouped[city] = [];
      cityOrder.push(city);
    }
    grouped[city].push(item);
  });
  var reordered = [];
  cityOrder.forEach(function (city) {
    reordered = reordered.concat(grouped[city]);
  });
  dayPlan.items = reordered;
  var after = reordered.map(function (item) { return item.title; });

  return {
    planData: plan,
    changeLog: {
      action: "swap_neighbor",
      dayAffected: dayPlan.day,
      before: before,
      after: after,
      note: "第 " + dayPlan.day + " 天按城市聚类重排，减少同日跨城折返",
      noop: before.join("|") === after.join("|"),
    },
  };
}

// merge_day（并天）：把空天/最轻载天合并到相邻日，压缩天数。
function mergeDay(planData, failure, context) {
  var plan = clonePlan(planData);
  if (plan.length <= 1) {
    return {
      planData: plan,
      changeLog: { action: "merge_day", note: "仅 1 天，无法并天", noop: true },
    };
  }
  var evidence = (failure && failure.evidence) || {};
  var emptyDays = Array.isArray(evidence.emptyDays) ? evidence.emptyDays : [];
  var sourceIdx = -1;
  if (emptyDays.length) {
    sourceIdx = findDayIndexByNumber(plan, emptyDays[0]);
  }
  if (sourceIdx < 0) {
    // 选择景点最少的一天作为被并入源
    sourceIdx = plan.reduce(function (bestIdx, dayPlan, i) {
      return visitItems(dayPlan).length < visitItems(plan[bestIdx]).length ? i : bestIdx;
    }, 0);
  }
  var targetIdx = sourceIdx > 0 ? sourceIdx - 1 : sourceIdx + 1;
  var sourceDay = plan[sourceIdx];
  var targetDay = plan[targetIdx];
  var movedItems = Array.isArray(sourceDay.items) ? sourceDay.items.slice() : [];
  targetDay.items = (Array.isArray(targetDay.items) ? targetDay.items : []).concat(movedItems);
  plan.splice(sourceIdx, 1);
  renumberDays(plan);
  return {
    planData: plan,
    changeLog: {
      action: "merge_day",
      dayAffected: sourceDay.day,
      mergedInto: targetDay.day,
      moved: visitItems(sourceDay).map(function (item) { return item.title; }),
      note: "将第 " + sourceDay.day + " 天并入相邻日，压缩空天",
    },
  };
}

var REPAIR_ACTIONS = {
  split_day: splitDay,
  drop_lowest_priority: dropLowestPriority,
  swap_neighbor: swapNeighbor,
  merge_day: mergeDay,
};

function applyRepair(planData, actionName, failure, context) {
  var fn = REPAIR_ACTIONS[actionName];
  if (typeof fn !== "function") {
    // 无静默失败：未知修复动作必须显式报错
    throw new Error("未知修复动作: " + actionName);
  }
  return fn(planData, failure, context);
}

// 决策器：按失败类型映射到候选修复动作，每轮只选「预期收益最高」的一个。
// 优先级顺序（严重度从高到低）：超载 > 闭环断裂 > 跨城冲突 > 空天过多。
var ROUTER_PRIORITY = [
  CODES.TIME_OVERLOAD,
  CODES.HOTEL_LOOP_BROKEN,
  CODES.CROSS_CITY_CONFLICT,
  CODES.TOO_MANY_EMPTY_DAYS,
];

function routeCodeToAction(code, failure, context) {
  var ctx = context || {};
  if (code === CODES.TIME_OVERLOAD) {
    // 单日仅 1 个景点无法拆分，则改为删点
    var evidence = (failure && failure.evidence) || {};
    var dayItemsCount = typeof ctx.dayItemsCount === "function" ? ctx.dayItemsCount(evidence.day) : null;
    if (dayItemsCount !== null && dayItemsCount <= 1) {
      return "drop_lowest_priority";
    }
    return "split_day";
  }
  if (code === CODES.HOTEL_LOOP_BROKEN) {
    return "merge_day";
  }
  if (code === CODES.CROSS_CITY_CONFLICT) {
    return "swap_neighbor";
  }
  if (code === CODES.TOO_MANY_EMPTY_DAYS) {
    return "merge_day";
  }
  return null;
}

function chooseRepairAction(findings, context) {
  var list = Array.isArray(findings) ? findings : [];
  var i;
  for (i = 0; i < ROUTER_PRIORITY.length; i += 1) {
    var code = ROUTER_PRIORITY[i];
    var failure = list.find(function (f) {
      return f && f.code === code;
    });
    if (failure) {
      var action = routeCodeToAction(code, failure, context);
      if (action) {
        return { action: action, failure: failure };
      }
    }
  }
  return null;
}

// 收敛控制：判断是否应停止修复并进入 fallback。
// scoreHistory 为按轮次记录的 verify 分数（越低越好）。
function noImprovement(scoreHistory, limit) {
  var history = Array.isArray(scoreHistory) ? scoreHistory : [];
  var threshold = Number(limit) || NO_IMPROVE_LIMIT;
  if (history.length <= threshold) {
    return false;
  }
  var best = history[0];
  var stale = 0;
  var i;
  for (i = 1; i < history.length; i += 1) {
    if (history[i] < best - 1e-9) {
      best = history[i];
      stale = 0;
    } else {
      stale += 1;
    }
  }
  return stale >= threshold;
}

// v1.4 策略×修复联动：用「当前策略权重」对修复后的方案重打分（越低越符合策略取向）。
// 通过 context.scoreOrder（由调用方注入，内部走统一评分器）实现，repair.js 不直接依赖打分器，
// 保持解耦；未注入 scoreOrder 时返回 null（无静默失败：调用方据此判断是否可用）。
function rescorePlanWithStrategy(planData, context) {
  var ctx = context || {};
  if (typeof ctx.scoreOrder !== "function") {
    return null;
  }
  var order = [];
  (Array.isArray(planData) ? planData : []).forEach(function (dayPlan) {
    (Array.isArray(dayPlan.items) ? dayPlan.items : []).forEach(function (item) {
      if (item && item.type === "visit" && item.title) {
        order.push(item.title);
      }
    });
  });
  return ctx.scoreOrder(order);
}

function shouldStopRepair(state) {
  var s = state || {};
  var round = Number(s.round) || 0;
  var maxRounds = Number.isFinite(Number(s.maxRounds)) ? Number(s.maxRounds) : MAX_REPAIR_ROUNDS;
  var noImproveLimit = Number.isFinite(Number(s.noImproveLimit)) ? Number(s.noImproveLimit) : NO_IMPROVE_LIMIT;
  if (round >= maxRounds) {
    return { stop: true, reason: "max_rounds" };
  }
  if (noImprovement(s.scoreHistory, noImproveLimit)) {
    return { stop: true, reason: "no_improvement" };
  }
  return { stop: false, reason: null };
}

module.exports = {
  MAX_REPAIR_ROUNDS: MAX_REPAIR_ROUNDS,
  NO_IMPROVE_LIMIT: NO_IMPROVE_LIMIT,
  REPAIR_ACTIONS: REPAIR_ACTIONS,
  splitDay: splitDay,
  dropLowestPriority: dropLowestPriority,
  swapNeighbor: swapNeighbor,
  mergeDay: mergeDay,
  applyRepair: applyRepair,
  chooseRepairAction: chooseRepairAction,
  routeCodeToAction: routeCodeToAction,
  shouldStopRepair: shouldStopRepair,
  noImprovement: noImprovement,
  rescorePlanWithStrategy: rescorePlanWithStrategy,
};
