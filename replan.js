"use strict";

// v1.6 局部重算（Incremental Replan）。
// 目标：用户改动一个点（删除/移动）时，只重算受影响的天，其余天原样冻结复用。
// 设计约束：
//   - 纯本地计算：不重新调用地图/LLM（复用当前行程已知的通勤时长，新相邻段走 computeRouteMetrics 的兜底口径）；
//   - 影响域「宁可多算一日也不能漏」：删=所在天；移=源天 + 目标天；
//   - 复用已有打分器/候选生成，受影响天内部重排序，未受影响天顺序逐字节保留。

var agentPlanner = require("./agent-planner.js");
var normalizeName = agentPlanner.normalizeName;

function dayNumberAt(planData, index) {
  var d = planData[index];
  return (d && Number(d.day)) || (index + 1);
}

function findDayIndexOfPlace(planData, placeName) {
  var key = normalizeName(placeName);
  var i;
  var j;
  for (i = 0; i < planData.length; i += 1) {
    var items = Array.isArray(planData[i].items) ? planData[i].items : [];
    for (j = 0; j < items.length; j += 1) {
      if (items[j] && items[j].type === "visit" && normalizeName(items[j].title) === key) {
        return i;
      }
    }
  }
  return -1;
}

// 影响域分析：返回受影响的「天编号」数组（去重、升序）。
function analyzeImpact(changeEvent, planData) {
  var plan = Array.isArray(planData) ? planData : [];
  var event = changeEvent || {};
  var affected = {};
  if (event.type === "remove_place") {
    var idx = findDayIndexOfPlace(plan, event.placeName);
    if (idx >= 0) {
      affected[dayNumberAt(plan, idx)] = true;
    }
  } else if (event.type === "move_place") {
    var srcIdx = findDayIndexOfPlace(plan, event.placeName);
    if (srcIdx >= 0) {
      affected[dayNumberAt(plan, srcIdx)] = true;
    }
    var toDay = Number(event.toDay);
    if (Number.isFinite(toDay)) {
      affected[toDay] = true;
    }
  }
  return Object.keys(affected)
    .map(function (k) { return Number(k); })
    .sort(function (a, b) { return a - b; });
}

// 应用变更，返回新的 planData（深拷贝 items 数组，不修改入参）。
function applyChange(planData, changeEvent) {
  var event = changeEvent || {};
  var key = normalizeName(event.placeName);
  var plan = (Array.isArray(planData) ? planData : []).map(function (d, i) {
    return {
      day: (Number(d.day) || (i + 1)),
      city: d.city || "",
      items: (Array.isArray(d.items) ? d.items : []).slice(),
    };
  });

  if (event.type === "remove_place") {
    plan.forEach(function (d) {
      d.items = d.items.filter(function (it) {
        return !(it && it.type === "visit" && normalizeName(it.title) === key);
      });
    });
    return plan;
  }

  if (event.type === "move_place") {
    var moved = null;
    plan.forEach(function (d) {
      d.items = d.items.filter(function (it) {
        if (it && it.type === "visit" && normalizeName(it.title) === key) {
          moved = it;
          return false;
        }
        return true;
      });
    });
    if (moved) {
      var target = null;
      plan.forEach(function (d) {
        if (d.day === Number(event.toDay)) {
          target = d;
        }
      });
      if (target) {
        target.items.push(moved);
      }
    }
    return plan;
  }

  return plan;
}

// 从当前 dailyPlans 的 transit 段构建通勤时长查表（复用已知相邻，未知返回 null 交由打分器兜底）。
function buildTravelLookupFromDailyPlans(dailyPlans) {
  var map = {};
  (Array.isArray(dailyPlans) ? dailyPlans : []).forEach(function (d) {
    (Array.isArray(d.segments) ? d.segments : []).forEach(function (s) {
      if (s && s.type === "transit" && s.from && s.to && Number.isFinite(Number(s.durationMin)) && Number(s.durationMin) > 0) {
        map[normalizeName(s.from) + ">" + normalizeName(s.to)] = Number(s.durationMin);
      }
    });
  });
  return function (fromName, toName) {
    var k = normalizeName(fromName) + ">" + normalizeName(toName);
    if (map[k] != null) {
      return map[k];
    }
    var rk = normalizeName(toName) + ">" + normalizeName(fromName);
    if (map[rk] != null) {
      return map[rk];
    }
    return null;
  };
}

// 仅对受影响天做内部重排序（打分择优），未受影响天原样返回。
function reoptimizeAffectedDays(plan, affectedDays, placeMetaMap, travelLookup, strategy, transportPreference) {
  var affectedSet = {};
  (affectedDays || []).forEach(function (d) { affectedSet[Number(d)] = true; });

  return plan.map(function (d) {
    if (!affectedSet[d.day]) {
      return d;
    }
    var visits = (Array.isArray(d.items) ? d.items : []).filter(function (it) {
      return it && it.type === "visit";
    });
    if (visits.length <= 1) {
      return d;
    }
    var names = visits.map(function (it) { return it.title; });
    var candidates = agentPlanner.generateCandidateOrders(names, placeMetaMap, travelLookup, strategy, { K: 20 });
    var best = agentPlanner.chooseBestOrder(candidates, placeMetaMap, travelLookup, strategy, transportPreference);
    var order = best && Array.isArray(best.order) && best.order.length ? best.order : names;
    var byName = {};
    visits.forEach(function (it) { byName[normalizeName(it.title)] = it; });
    var newItems = order
      .map(function (n) { return byName[normalizeName(n)]; })
      .filter(Boolean);
    return { day: d.day, city: d.city, items: newItems };
  });
}

// 编排：应用变更 → 影响域 → 受影响天重排序 → 复用率。
// 返回 { planData, affectedDays, reusedRatio, changeType, dayCount }。
function incrementalReplan(input) {
  var opts = input || {};
  var planData = Array.isArray(opts.planData) ? opts.planData : [];
  var changeEvent = opts.changeEvent || {};
  var placeMetaMap = opts.placeMetaMap || {};
  var travelLookup = typeof opts.travelLookup === "function" ? opts.travelLookup : function () { return null; };
  var strategy = opts.strategy || "fastest";
  var transportPreference = opts.transportPreference || "driving";

  var affectedDays = analyzeImpact(changeEvent, planData);
  var changed = applyChange(planData, changeEvent);
  var reoptimized = reoptimizeAffectedDays(changed, affectedDays, placeMetaMap, travelLookup, strategy, transportPreference);

  var dayCount = reoptimized.length;
  var reusedRatio = dayCount > 0 ? (dayCount - affectedDays.length) / dayCount : 0;

  return {
    planData: reoptimized,
    affectedDays: affectedDays,
    reusedRatio: reusedRatio,
    changeType: changeEvent.type || "",
    dayCount: dayCount,
  };
}

module.exports = {
  analyzeImpact: analyzeImpact,
  applyChange: applyChange,
  findDayIndexOfPlace: findDayIndexOfPlace,
  buildTravelLookupFromDailyPlans: buildTravelLookupFromDailyPlans,
  reoptimizeAffectedDays: reoptimizeAffectedDays,
  incrementalReplan: incrementalReplan,
};
