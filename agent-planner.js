"use strict";

var scoring = require("./scoring.js");

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function priorityToScore(priority) {
  if (priority === "high") {
    return 4.9;
  }
  if (priority === "low") {
    return 3.9;
  }
  return 4.4;
}

function applySpotlightInsights(place, spotlight) {
  if (!spotlight) {
    return place;
  }
  var merged = Object.assign({}, place);
  merged.introduction = spotlight.introduction || merged.introduction || "";
  merged.highlights = spotlight.highlights || merged.highlights || "";
  merged.visitTimeRange = spotlight.suggestedVisitRange || merged.visitTimeRange || "";
  merged.spotlightTips = spotlight.tips || merged.spotlightTips || "";
  if (!merged.durationMin && Number.isFinite(spotlight.suggestedDurationMin)) {
    merged.suggestedDurationMin = Math.max(30, Math.min(480, Math.floor(spotlight.suggestedDurationMin)));
  }
  if (spotlight.priority) {
    merged.llmPriority = spotlight.priority;
    merged.score = priorityToScore(spotlight.priority);
  }
  if (spotlight.introduction && !merged.llmReason) {
    merged.llmReason = spotlight.introduction;
  }
  return merged;
}

function applyAgentInsights(places, analysisPlaces, recommendedOrder, placeSpotlights) {
  var placeList = Array.isArray(places) ? places.slice() : [];
  var insightMap = {};
  var spotlightMap = {};

  (Array.isArray(analysisPlaces) ? analysisPlaces : []).forEach(function (item) {
    var key = normalizeName(item.name);
    if (!key) {
      return;
    }
    insightMap[key] = {
      suggestedDurationMin: Number(item.suggestedDurationMin) || null,
      priority: String(item.priority || "medium").toLowerCase(),
      reason: String(item.reason || ""),
    };
  });

  (Array.isArray(placeSpotlights) ? placeSpotlights : []).forEach(function (item) {
    var key = normalizeName(item.name);
    if (!key) {
      return;
    }
    spotlightMap[key] = item;
  });

  var enriched = placeList.map(function (place) {
    var key = normalizeName(place.name);
    var insight = insightMap[key];
    var spotlight = spotlightMap[key];
    var merged = applySpotlightInsights(place, spotlight);
    if (!insight) {
      return merged;
    }
    if (!merged.durationMin && Number.isFinite(insight.suggestedDurationMin)) {
      merged.suggestedDurationMin = Math.max(30, Math.min(480, Math.floor(insight.suggestedDurationMin)));
    }
    merged.llmPriority = insight.priority;
    merged.llmReason = insight.reason || merged.llmReason || "";
    merged.score = priorityToScore(insight.priority);
    return merged;
  });

  return sortByRecommendedOrder(enriched, recommendedOrder);
}

function buildPlanDataFromOrder(recommendedOrder, places, city, totalDays) {
  var orderedPlaces = sortByRecommendedOrder(
    Array.isArray(places) ? places.slice() : [],
    Array.isArray(recommendedOrder) ? recommendedOrder : []
  );
  if (!orderedPlaces.length) {
    return [];
  }

  var days = Number(totalDays);
  if (!Number.isFinite(days) || days <= 0) {
    days = 1;
  }

  var buckets = [];
  var dayIndex;
  for (dayIndex = 0; dayIndex < days; dayIndex += 1) {
    buckets.push([]);
  }

  // 连续分块（contiguous chunk）而非轮询分桶：保留按城市/邻近聚类的顺序，
  // 让相邻（常为同城）的景点落在同一天，避免每日无谓跨城往返（见 OI-1）。
  // 余数前置：前 remainder 天各多分 1 个点。
  var base = Math.floor(orderedPlaces.length / days);
  var remainder = orderedPlaces.length % days;
  var cursor = 0;
  for (dayIndex = 0; dayIndex < days; dayIndex += 1) {
    var take = base + (dayIndex < remainder ? 1 : 0);
    buckets[dayIndex] = orderedPlaces.slice(cursor, cursor + take);
    cursor += take;
  }

  return buckets.map(function (dayPlaces, index) {
    return {
      day: index + 1,
      city: city || "",
      items: dayPlaces.map(function (place) {
        return {
          type: "visit",
          placeId: place.placeId || null,
          title: place.name,
          address: place.address || "",
          durationMin: place.suggestedDurationMin || place.durationMin || null,
        };
      }),
    };
  });
}

function parseDurationMinFromText(rangeText) {
  var text = String(rangeText || "");
  var hourRange = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*小/);
  if (hourRange) {
    var avgHour = (Number(hourRange[1]) + Number(hourRange[2])) / 2;
    return Math.max(1, Math.round(avgHour * 60));
  }
  var hourSingle = text.match(/(\d+(?:\.\d+)?)\s*小/);
  if (hourSingle) {
    return Math.max(1, Math.round(Number(hourSingle[1]) * 60));
  }
  var minuteRange = text.match(/(\d+)\s*-\s*(\d+)\s*分/);
  if (minuteRange) {
    return Math.max(1, Math.round((Number(minuteRange[1]) + Number(minuteRange[2])) / 2));
  }
  var minuteSingle = text.match(/(\d+)\s*分/);
  if (minuteSingle) {
    return Math.max(1, Number(minuteSingle[1]));
  }
  return null;
}

function buildDailyPlansFromRoadbook(roadbook, lodging, totalDays) {
  var rows = Array.isArray(roadbook) ? roadbook : [];
  if (!rows.length) {
    return [];
  }

  var dayCount = Number(totalDays);
  if (!Number.isFinite(dayCount) || dayCount <= 0) {
    dayCount = 1;
  }
  dayCount = Math.floor(dayCount);

  var buckets = [];
  var i;
  for (i = 0; i < dayCount; i += 1) {
    buckets.push([]);
  }

  rows.forEach(function (step, index) {
    buckets[index % dayCount].push(step);
  });

  var hotelName = lodging && lodging.hotel && lodging.hotel.name
    ? String(lodging.hotel.name).trim()
    : "";
  var hasHotel = Boolean(hotelName);
  var checkInDateText = lodging && lodging.hotel && lodging.hotel.checkInDate
    ? String(lodging.hotel.checkInDate).trim()
    : "";
  var checkInDate = checkInDateText ? new Date(checkInDateText + "T00:00:00Z") : null;

  return buckets.map(function (daySteps, index) {
    var segments = [];
    daySteps.forEach(function (step, stepIndex) {
      var stayMin = Number(step.visitDurationMin) || parseDurationMinFromText(step.visitTimeRange) || 90;
      if (stepIndex === 0 && hasHotel) {
        segments.push({
          type: "transit",
          from: hotelName,
          to: step.placeName,
          durationRange: "请以实时导航为准",
          durationMin: null,
        });
      }
      segments.push({
        type: "visit",
        placeName: step.placeName,
        visitTimeRange: step.visitTimeRange || "",
        visitDurationMin: stayMin,
      });
      if (step.travelToNext && step.travelToNext.destination) {
        segments.push({
          type: "transit",
          from: step.placeName,
          to: step.travelToNext.destination,
          durationRange: step.travelToNext.durationRange || "",
          durationMin: Number(step.travelToNext.durationMin) || null,
          distanceText: step.travelToNext.distanceText || "",
          note: step.travelToNext.note || "",
        });
      } else if (stepIndex === daySteps.length - 1 && hasHotel) {
        segments.push({
          type: "transit",
          from: step.placeName,
          to: hotelName,
          durationRange: "请以实时导航为准",
          durationMin: null,
        });
      }
    });

    var dateText = "";
    if (checkInDate && !Number.isNaN(checkInDate.getTime())) {
      var dateObj = new Date(checkInDate.getTime() + (index * 24 * 60 * 60 * 1000));
      dateText = dateObj.toISOString().slice(0, 10);
    }

    return {
      day: index + 1,
      date: dateText,
      hotelName: hotelName,
      segments: segments,
    };
  });
}

function buildTransitSegment(fromTitle, toTitle, options) {
  var opts = options || {};
  var travelLookup = typeof opts.travelLookup === "function" ? opts.travelLookup : null;
  var transitLookup = typeof opts.transitLookup === "function" ? opts.transitLookup : null;

  var segment = {
    type: "transit",
    from: fromTitle,
    to: toTitle,
    durationRange: "请以实时导航为准",
    durationMin: null,
  };

  if (transitLookup) {
    var breakdown = transitLookup(fromTitle, toTitle);
    if (breakdown && Number.isFinite(Number(breakdown.totalDurationMin))) {
      segment.mode = "transit";
      segment.durationMin = Math.max(1, Math.floor(Number(breakdown.totalDurationMin)));
      segment.durationRange = "公共交通约 " + segment.durationMin + " 分钟";
      segment.legs = Array.isArray(breakdown.legs) ? breakdown.legs : [];
      return segment;
    }
  }

  if (travelLookup) {
    var travelMin = travelLookup(fromTitle, toTitle);
    if (Number.isFinite(Number(travelMin)) && Number(travelMin) > 0) {
      segment.durationMin = Math.max(1, Math.floor(Number(travelMin)));
      segment.durationRange = "驾车约 " + segment.durationMin + " 分钟";
    }
  }

  return segment;
}

function buildDailyPlansFromPlanData(planData, lodging, totalDays, options) {
  var safePlan = Array.isArray(planData) ? planData : [];
  if (!safePlan.length) {
    return [];
  }
  var hotelName = lodging && lodging.hotel && lodging.hotel.name
    ? String(lodging.hotel.name).trim()
    : "";
  var hasHotel = Boolean(hotelName);
  var checkInDateText = lodging && lodging.hotel && lodging.hotel.checkInDate
    ? String(lodging.hotel.checkInDate).trim()
    : "";
  var checkInDate = checkInDateText ? new Date(checkInDateText + "T00:00:00Z") : null;
  var opts = options || {};

  return safePlan.map(function (dayPlan, index) {
    var items = (Array.isArray(dayPlan.items) ? dayPlan.items : []).filter(function (item) {
      return item && item.type === "visit";
    });
    var segments = [];
    items.forEach(function (item, itemIndex) {
      // v1.2 酒店闭环硬约束：有酒店时每日首段必须从酒店出发
      if (itemIndex === 0 && hasHotel) {
        segments.push(buildTransitSegment(hotelName, item.title, opts));
      }
      segments.push({
        type: "visit",
        placeName: item.title,
        visitTimeRange: item.durationMin ? ("建议" + (Math.max(0.5, Number(item.durationMin) / 60).toFixed(1)) + "小时") : "",
        visitDurationMin: Number(item.durationMin) || 90,
      });
      var nextItem = items[itemIndex + 1];
      if (nextItem) {
        segments.push(buildTransitSegment(item.title, nextItem.title, opts));
      } else if (hasHotel) {
        // v1.2 酒店闭环硬约束：末段必须返回酒店
        segments.push(buildTransitSegment(item.title, hotelName, opts));
      }
    });

    var dateText = "";
    if (checkInDate && !Number.isNaN(checkInDate.getTime())) {
      var dateObj = new Date(checkInDate.getTime() + (index * 24 * 60 * 60 * 1000));
      dateText = dateObj.toISOString().slice(0, 10);
    }

    var closedLoop = true;
    if (hasHotel && items.length) {
      var firstSeg = segments[0];
      var lastSeg = segments[segments.length - 1];
      closedLoop = Boolean(
        firstSeg && firstSeg.type === "transit" && firstSeg.from === hotelName &&
        lastSeg && lastSeg.type === "transit" && lastSeg.to === hotelName
      );
    }

    return {
      day: Number(dayPlan.day) || (index + 1),
      date: dateText,
      hotelName: hotelName,
      closedLoop: closedLoop,
      segments: segments,
    };
  });
}

function verifyHotelClosure(dailyPlans, lodging) {
  var hotelName = lodging && lodging.hotel && lodging.hotel.name
    ? String(lodging.hotel.name).trim()
    : "";
  if (!hotelName) {
    return { closed: true, warnings: [], openDays: [] };
  }
  var openDays = [];
  (Array.isArray(dailyPlans) ? dailyPlans : []).forEach(function (dayPlan) {
    var segments = Array.isArray(dayPlan.segments) ? dayPlan.segments : [];
    if (!segments.length) {
      return;
    }
    var first = segments[0];
    var last = segments[segments.length - 1];
    var closed = Boolean(
      first && first.type === "transit" && first.from === hotelName &&
      last && last.type === "transit" && last.to === hotelName
    );
    if (!closed) {
      openDays.push(dayPlan.day);
    }
  });
  var warnings = openDays.length
    ? ["第 " + openDays.join("、") + " 天未能形成酒店闭环，请核对酒店锚点或景点归属。"]
    : [];
  return {
    closed: openDays.length === 0,
    warnings: warnings,
    openDays: openDays,
  };
}

var STRATEGY_TEMPLATES = {
  fastest: {
    id: "fastest",
    label: "省时优先",
    weights: { travel: 1.0, crossCity: 0.15, backtrack: 0.2, priority: 0.1 },
    description: "以最短总通勤时长为核心目标，尽量压缩在途时间。",
  },
  "least-transfer": {
    id: "least-transfer",
    label: "少换乘优先",
    weights: { travel: 0.3, crossCity: 1.0, backtrack: 0.4, priority: 0.1 },
    description: "优先减少跨城/换乘次数，适合不想频繁奔波的行程。",
  },
  classic: {
    id: "classic",
    label: "经典打卡优先",
    weights: { travel: 0.35, crossCity: 0.3, backtrack: 0.6, priority: 0.6 },
    description: "兼顾不走回头路与高优先级景点，贴近经典打卡节奏。",
  },
};

function getStrategyTemplate(strategy) {
  var key = String(strategy || "").trim().toLowerCase();
  return STRATEGY_TEMPLATES[key] || STRATEGY_TEMPLATES.fastest;
}

function listStrategyTemplates() {
  return Object.keys(STRATEGY_TEMPLATES).map(function (key) {
    var tmpl = STRATEGY_TEMPLATES[key];
    return { id: tmpl.id, label: tmpl.label, description: tmpl.description };
  });
}

function metaCity(placeMetaMap, name) {
  var meta = placeMetaMap && placeMetaMap[normalizeName(name)] ? placeMetaMap[normalizeName(name)] : {};
  return normalizeName(meta.city || "");
}

function computeRouteMetrics(order, placeMetaMap, getTravelMin) {
  var names = (Array.isArray(order) ? order : []).filter(Boolean);
  var meta = placeMetaMap || {};
  var lookup = typeof getTravelMin === "function" ? getTravelMin : function () { return null; };
  var totalTravelMin = 0;
  var crossCityCount = 0;
  var backtrackCount = 0;
  var visitedCities = [];
  var legs = [];
  var i;

  for (i = 0; i < names.length; i += 1) {
    var name = names[i];
    var city = metaCity(meta, name);
    if (city) {
      var lastCity = visitedCities.length ? visitedCities[visitedCities.length - 1] : "";
      if (city !== lastCity) {
        if (visitedCities.indexOf(city) >= 0) {
          backtrackCount += 1;
        }
        visitedCities.push(city);
      }
    }
    if (i > 0) {
      var prev = names[i - 1];
      var prevCity = metaCity(meta, prev);
      var travel = lookup(prev, name);
      var travelMin = Number.isFinite(Number(travel)) && Number(travel) > 0 ? Number(travel) : null;
      var sameCity = Boolean(city) && prevCity === city;
      if (travelMin === null) {
        travelMin = sameCity ? 30 : 120;
      }
      if (prevCity !== city) {
        crossCityCount += 1;
      }
      totalTravelMin += travelMin;
      legs.push({ from: prev, to: name, durationMin: travelMin, crossCity: prevCity !== city });
    }
  }

  var priorityScore = 0;
  names.forEach(function (name, idx) {
    var m = meta[normalizeName(name)] || {};
    var pr = String(m.priority || "medium").toLowerCase();
    var base = pr === "high" ? 3 : (pr === "low" ? 1 : 2);
    var positionWeight = names.length > 1 ? (names.length - idx) / names.length : 1;
    priorityScore += base * positionWeight;
  });

  return {
    totalTravelMin: totalTravelMin,
    crossCityCount: crossCityCount,
    backtrackCount: backtrackCount,
    priorityScore: priorityScore,
    placeCount: names.length,
    legs: legs,
  };
}

// v1.4 P2：交通模式偏好 → 权重乘子。默认 driving（不改动，回归零 diff）；
// walking 更在意距离与跨城，transit 更在意换乘/跨城。乘子作用于归一化后的加权项。
var TRANSPORT_WEIGHT_MODIFIERS = {
  driving: {},
  transit: { crossCity: 1.3 },
  walking: { travel: 1.4, crossCity: 1.2 },
};

function applyTransportPreference(weights, transportPreference) {
  var w = weights || {};
  var pref = String(transportPreference || "driving").trim().toLowerCase();
  var mod = TRANSPORT_WEIGHT_MODIFIERS[pref];
  if (!mod) {
    return Object.assign({}, w);
  }
  return {
    travel: (Number(w.travel) || 0) * (mod.travel || 1),
    crossCity: (Number(w.crossCity) || 0) * (mod.crossCity || 1),
    backtrack: (Number(w.backtrack) || 0) * (mod.backtrack || 1),
    priority: (Number(w.priority) || 0) * (mod.priority || 1),
  };
}

// v1.4：统一评分器口径。scoreRouteDetailed 返回 { score, breakdown, normalized }，
// scoreRoute 保留返回数值的向后兼容签名（内部委托，避免双份评分公式漂移）。
// transportPreference 为可选（P2）：默认 driving 时权重不变。
function scoreRouteDetailed(metrics, strategy, transportPreference) {
  var tmpl = getStrategyTemplate(strategy);
  var weights = applyTransportPreference(tmpl.weights, transportPreference);
  return scoring.scoreMetrics(metrics, weights);
}

function scoreRoute(metrics, strategy, transportPreference) {
  return scoreRouteDetailed(metrics, strategy, transportPreference).score;
}

function chooseBestOrder(candidates, placeMetaMap, getTravelMin, strategy, transportPreference) {
  var list = (Array.isArray(candidates) ? candidates : []).filter(function (candidate) {
    return candidate && Array.isArray(candidate.order) && candidate.order.length;
  });
  if (!list.length) {
    return null;
  }
  var scored = list.map(function (candidate) {
    var metrics = computeRouteMetrics(candidate.order, placeMetaMap, getTravelMin);
    var detail = scoreRouteDetailed(metrics, strategy, transportPreference);
    return {
      source: candidate.source || "unknown",
      order: candidate.order.slice(),
      metrics: metrics,
      cost: detail.score,
      breakdown: detail.breakdown,
      normalized: detail.normalized,
    };
  });
  // 稳定排序：分数相同时保留输入先后（LLM 候选优先），便于可解释与回归稳定。
  scored.sort(function (a, b) {
    if (a.cost === b.cost) {
      return 0;
    }
    return a.cost - b.cost;
  });
  var best = Object.assign({}, scored[0]);
  best.secondBest = scored[1] || null;
  best.candidates = scored;
  return best;
}

function buildGreedyOrder(placeNames, placeMetaMap, getTravelMin, strategy) {
  var names = (Array.isArray(placeNames) ? placeNames : []).filter(Boolean);
  if (names.length <= 2) {
    return names.slice();
  }
  var meta = placeMetaMap || {};
  var lookup = typeof getTravelMin === "function" ? getTravelMin : function () { return null; };
  var tmpl = getStrategyTemplate(strategy);
  var clusterByCity = tmpl.id === "least-transfer" || tmpl.id === "classic";

  function travelCost(a, b) {
    var t = lookup(a, b);
    if (Number.isFinite(Number(t)) && Number(t) > 0) {
      return Number(t);
    }
    var ca = metaCity(meta, a);
    var cb = metaCity(meta, b);
    return (ca && cb && ca === cb) ? 30 : 120;
  }

  var remaining = names.slice();
  var result = [remaining.shift()];
  while (remaining.length) {
    var last = result[result.length - 1];
    var lastCity = metaCity(meta, last);
    var bestIdx = 0;
    var bestCost = Infinity;
    remaining.forEach(function (candidate, idx) {
      var cost = travelCost(last, candidate);
      if (clusterByCity) {
        var candCity = metaCity(meta, candidate);
        if (lastCity && candCity && candCity !== lastCity) {
          cost += 90;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = idx;
      }
    });
    result.push(remaining.splice(bestIdx, 1)[0]);
  }
  return result;
}

// v1.4 OI-1 根治（方向B，cluster-then-assign 的 cluster 步）：
// 把顺序按城市稳定聚类（首次出现的城市顺序、城内保留相对次序），
// 让「先聚类、再连续分块」后同城景点落在同一天，从源头消除每日无谓跨城往返。
// 无城市信息时（全部 __unknown__）退化为原顺序，行为与旧连续分块一致。
function clusterOrderByCity(order, placeMetaMap) {
  var names = (Array.isArray(order) ? order : []).filter(Boolean);
  var meta = placeMetaMap || {};
  var cityOrder = [];
  var grouped = {};
  names.forEach(function (name) {
    var city = metaCity(meta, name) || "__unknown__";
    if (!grouped[city]) {
      grouped[city] = [];
      cityOrder.push(city);
    }
    grouped[city].push(name);
  });
  var out = [];
  cityOrder.forEach(function (city) {
    out = out.concat(grouped[city]);
  });
  return out;
}

// v1.4 OI-1 根治（方向C，按日打分口径）：以「按日分组 + 每日回酒店」为口径统计跨城，
// 只计入同一日内相邻 visit 的跨城切换（天与天之间会回酒店，不产生真实跨城）。
// 仅用于结果上报/埋点，不改变 verifier 判定阈值。
function computeDailyMetrics(planData, placeMetaMap, getTravelMin) {
  var plan = Array.isArray(planData) ? planData : [];
  var meta = placeMetaMap || {};
  var lookup = typeof getTravelMin === "function" ? getTravelMin : function () { return null; };
  var crossCityByDay = [];
  var totalCrossCityWithinDay = 0;
  var totalTravelMin = 0;

  plan.forEach(function (dayPlan) {
    var items = (Array.isArray(dayPlan.items) ? dayPlan.items : []).filter(function (item) {
      return item && item.type === "visit";
    });
    var dayCross = 0;
    var i;
    for (i = 1; i < items.length; i += 1) {
      var prevName = items[i - 1].title;
      var curName = items[i].title;
      var prevCity = metaCity(meta, prevName);
      var curCity = metaCity(meta, curName);
      if (prevCity && curCity && prevCity !== curCity) {
        dayCross += 1;
      }
      var travel = lookup(prevName, curName);
      var travelMin = Number.isFinite(Number(travel)) && Number(travel) > 0
        ? Number(travel)
        : (prevCity && curCity && prevCity === curCity ? 30 : 120);
      totalTravelMin += travelMin;
    }
    crossCityByDay.push({ day: Number(dayPlan.day) || (crossCityByDay.length + 1), crossCity: dayCross });
    totalCrossCityWithinDay += dayCross;
  });

  return {
    crossCityByDay: crossCityByDay,
    totalCrossCityWithinDay: totalCrossCityWithinDay,
    totalTravelMin: totalTravelMin,
  };
}

// v1.4 候选生成：按优先级（high→low）稳定排序的候选顺序。
function buildPriorityOrder(placeNames, placeMetaMap) {
  var names = (Array.isArray(placeNames) ? placeNames : []).filter(Boolean);
  var meta = placeMetaMap || {};
  function rank(name) {
    var m = meta[normalizeName(name)] || {};
    var p = String(m.priority || "medium").toLowerCase();
    return p === "high" ? 3 : (p === "low" ? 1 : 2);
  }
  // 稳定排序：优先级相同者保留原始先后（decorate-sort-undecorate）。
  return names
    .map(function (name, idx) { return { name: name, idx: idx, rank: rank(name) }; })
    .sort(function (a, b) {
      if (a.rank !== b.rank) {
        return b.rank - a.rank;
      }
      return a.idx - b.idx;
    })
    .map(function (item) { return item.name; });
}

function orderSignature(order) {
  return (Array.isArray(order) ? order : []).map(normalizeName).join(">");
}

// v1.4 候选生成 + 剪枝（doc §8.1）：多路候选 → 去重 → 上限 K 截断，防组合爆炸。
// 候选来源：① 基准顺序（通常为 LLM 输出）；② 各策略贪心；③ 按优先级；④ 调用方注入的额外候选。
// 段间时长通过 getTravelMin（内部走工具缓存）计算，不重复调用外部工具。
function generateCandidateOrders(baseOrder, placeMetaMap, getTravelMin, strategy, options) {
  var opts = options || {};
  var K = Number.isFinite(Number(opts.K)) ? Number(opts.K) : 20;
  var names = (Array.isArray(baseOrder) ? baseOrder : []).filter(Boolean);
  var meta = placeMetaMap || {};
  var candidates = [];

  function add(source, order) {
    var arr = (Array.isArray(order) ? order : []).filter(Boolean);
    if (arr.length !== names.length || !arr.length) {
      // 候选必须覆盖全部景点（同集合不同序），否则丢弃，避免误删点。
      return;
    }
    candidates.push({ source: source, order: arr });
  }

  add("llm", names);
  Object.keys(STRATEGY_TEMPLATES).forEach(function (sid) {
    add("greedy-" + sid, buildGreedyOrder(names, meta, getTravelMin, sid));
  });
  add("priority", buildPriorityOrder(names, meta));
  (Array.isArray(opts.extra) ? opts.extra : []).forEach(function (c) {
    add((c && c.source) || "extra", c && c.order);
  });

  // 去重（顺序等价只保留一个，保留最先出现者）。
  var seen = {};
  var deduped = [];
  candidates.forEach(function (c) {
    var sig = orderSignature(c.order);
    if (!seen[sig]) {
      seen[sig] = true;
      deduped.push(c);
    }
  });

  return deduped.slice(0, Math.max(1, K));
}

function buildStrategyExplanation(strategy, metrics, source) {
  var tmpl = getStrategyTemplate(strategy);
  var m = metrics || {};
  var parts = [];
  parts.push("采用「" + tmpl.label + "」策略：" + tmpl.description);
  parts.push(
    "本路线预计总通勤约 " + Math.round(Number(m.totalTravelMin) || 0) + " 分钟，" +
    "跨城 " + (Number(m.crossCityCount) || 0) + " 次，" +
    "折返 " + (Number(m.backtrackCount) || 0) + " 次。"
  );
  if (source && String(source).indexOf("greedy") === 0) {
    parts.push("后端打分器已在模型建议顺序与策略候选顺序中择优。");
  }
  return parts.join("");
}

// v1.4 结构化策略解释：所选策略 + 得分构成 + 与次优方案的对比（为什么更优）。
// 依赖 chooseBestOrder 返回的 chosenRoute（含 breakdown 与 secondBest）。
var EXPLAIN_DIM_LABEL = {
  travel: "总通勤更短",
  crossCity: "跨城更少",
  backtrack: "折返更少",
  priority: "高优先级景点更靠前",
};

function buildStrategyExplanationDetail(strategy, chosenRoute) {
  var tmpl = getStrategyTemplate(strategy);
  var chosen = chosenRoute || {};
  var second = chosen.secondBest || null;
  var chosenScore = Number.isFinite(Number(chosen.cost)) ? Number(chosen.cost) : null;
  var scoreGap = null;
  if (second && Number.isFinite(Number(second.cost)) && chosenScore !== null) {
    scoreGap = Number(second.cost) - chosenScore; // >=0：所选方案领先次优的分差（分越低越好）
  }

  var reason = "";
  if (second && chosen.breakdown && second.breakdown) {
    // 找出所选方案相对次优「改善最大」的维度（second - chosen > 0 表示所选更优，对四维统一成立）。
    var dims = ["travel", "crossCity", "backtrack", "priority"];
    var bestDim = null;
    var bestDiff = -Infinity;
    dims.forEach(function (dim) {
      var diff = (Number(second.breakdown[dim]) || 0) - (Number(chosen.breakdown[dim]) || 0);
      if (diff > bestDiff) {
        bestDiff = diff;
        bestDim = dim;
      }
    });
    if (bestDim && bestDiff > 1e-9) {
      reason = "相比次优候选（" + (second.source || "候选") + "），本方案在「" + EXPLAIN_DIM_LABEL[bestDim] + "」上更优" +
        (scoreGap !== null ? "，综合得分领先 " + scoreGap.toFixed(3) : "") + "。";
    } else if (scoreGap !== null) {
      reason = "本方案综合得分领先次优候选 " + scoreGap.toFixed(3) + "。";
    }
  } else {
    reason = "仅有单一候选方案，已直接采用。";
  }

  return {
    strategy: tmpl.id,
    strategyLabel: tmpl.label,
    description: tmpl.description,
    chosenSource: chosen.source || null,
    chosenScore: chosenScore,
    chosenBreakdown: chosen.breakdown || null,
    secondBest: second
      ? { source: second.source || null, score: Number(second.cost), order: (second.order || []).slice() }
      : null,
    scoreGap: scoreGap,
    reason: reason,
  };
}

// v1.4 A/B 多方案对比：主方案 = 用户所选策略；对比方案 = 「次优策略」，
// 定义为在同一候选集上、其最优顺序与主方案不同、且与主方案对比度最高的其他策略。
// 对比度 = |跨城差| + |总通勤差|/60，deterministic 便于回归。
function buildTradeoffNote(primaryMetrics, altMetrics) {
  var p = primaryMetrics || {};
  var a = altMetrics || {};
  var bits = [];
  var crossDelta = (Number(a.crossCityCount) || 0) - (Number(p.crossCityCount) || 0);
  var travelDelta = Math.round((Number(a.totalTravelMin) || 0) - (Number(p.totalTravelMin) || 0));
  if (crossDelta !== 0) {
    bits.push("跨城 " + (crossDelta < 0 ? "减少 " + (-crossDelta) : "增加 " + crossDelta) + " 次");
  }
  if (travelDelta !== 0) {
    bits.push("总通勤 " + (travelDelta < 0 ? "减少 " + (-travelDelta) : "增加 " + travelDelta) + " 分钟");
  }
  if (!bits.length) {
    return "与主方案在关键指标上接近，主要差异在景点次序。";
  }
  return "相较主方案：" + bits.join("、") + "。";
}

function compareStrategies(candidateOrders, placeMetaMap, getTravelMin, userStrategy, transportPreference) {
  var primary = chooseBestOrder(candidateOrders, placeMetaMap, getTravelMin, userStrategy, transportPreference);
  if (!primary) {
    return null;
  }
  var userId = getStrategyTemplate(userStrategy).id;
  var primarySig = orderSignature(primary.order);
  var others = Object.keys(STRATEGY_TEMPLATES).filter(function (id) {
    return id !== userId;
  });
  var alt = null;
  others.forEach(function (sid) {
    var best = chooseBestOrder(candidateOrders, placeMetaMap, getTravelMin, sid, transportPreference);
    if (!best || orderSignature(best.order) === primarySig) {
      return;
    }
    var contrast = Math.abs((best.metrics.crossCityCount || 0) - (primary.metrics.crossCityCount || 0)) +
      Math.abs((best.metrics.totalTravelMin || 0) - (primary.metrics.totalTravelMin || 0)) / 60;
    if (!alt || contrast > alt.contrast) {
      alt = {
        strategy: sid,
        strategyLabel: getStrategyTemplate(sid).label,
        description: getStrategyTemplate(sid).description,
        order: best.order.slice(),
        metrics: best.metrics,
        score: best.cost,
        contrast: contrast,
      };
    }
  });

  var result = {
    primary: {
      strategy: userId,
      strategyLabel: getStrategyTemplate(userId).label,
      order: primary.order.slice(),
      metrics: {
        totalTravelMin: primary.metrics.totalTravelMin,
        crossCityCount: primary.metrics.crossCityCount,
        backtrackCount: primary.metrics.backtrackCount,
      },
      score: primary.cost,
    },
    runnerUp: null,
  };
  if (alt) {
    result.runnerUp = {
      strategy: alt.strategy,
      strategyLabel: alt.strategyLabel,
      description: alt.description,
      order: alt.order,
      metrics: {
        totalTravelMin: alt.metrics.totalTravelMin,
        crossCityCount: alt.metrics.crossCityCount,
        backtrackCount: alt.metrics.backtrackCount,
      },
      score: alt.score,
      tradeoff: buildTradeoffNote(primary.metrics, alt.metrics),
    };
  }
  return result;
}

function parseTransitLegs(directionsResponse) {
  var data = directionsResponse && typeof directionsResponse === "object" ? directionsResponse : {};
  var route = Array.isArray(data.routes) ? data.routes[0] : null;
  var leg = route && Array.isArray(route.legs) ? route.legs[0] : null;
  if (!leg) {
    return { totalDurationMin: null, legs: [] };
  }
  var steps = Array.isArray(leg.steps) ? leg.steps : [];
  var legs = [];
  steps.forEach(function (step) {
    var mode = String((step && step.travel_mode) || "").toUpperCase();
    var durMin = Number.isFinite(Number(step && step.duration && step.duration.value))
      ? Math.max(1, Math.round(Number(step.duration.value) / 60))
      : null;
    if (mode === "TRANSIT") {
      var td = step.transit_details || {};
      var line = td.line || {};
      var vehicle = line.vehicle || {};
      legs.push({
        type: String(vehicle.type || "TRANSIT").toLowerCase(),
        line: String(line.short_name || line.name || "").trim(),
        from: String((td.departure_stop || {}).name || "").trim(),
        to: String((td.arrival_stop || {}).name || "").trim(),
        durationMin: durMin,
      });
    } else if (mode === "WALKING") {
      legs.push({
        type: "walk",
        line: "",
        from: "",
        to: "",
        durationMin: durMin,
      });
    }
  });
  var totalMin = Number.isFinite(Number(leg.duration && leg.duration.value))
    ? Math.max(1, Math.round(Number(leg.duration.value) / 60))
    : legs.reduce(function (acc, item) { return acc + (Number(item.durationMin) || 0); }, 0);
  return {
    totalDurationMin: totalMin || null,
    legs: legs,
  };
}

function evaluateTimeFeasibility(dailyPlans, requestedDays) {
  var safePlans = Array.isArray(dailyPlans) ? dailyPlans : [];
  var overloadedDays = [];
  var totalMinutes = 0;
  var dailyBudgetMin = 10 * 60;

  safePlans.forEach(function (dayPlan) {
    var segments = Array.isArray(dayPlan.segments) ? dayPlan.segments : [];
    var dayTotal = 0;
    segments.forEach(function (segment) {
      if (segment.type === "visit") {
        dayTotal += Number(segment.visitDurationMin) || 90;
      } else if (segment.type === "transit") {
        dayTotal += Number(segment.durationMin) || 30;
      }
    });
    totalMinutes += dayTotal;
    if (dayTotal > dailyBudgetMin) {
      overloadedDays.push({
        day: dayPlan.day,
        estimatedMinutes: dayTotal,
      });
    }
  });

  return {
    feasible: overloadedDays.length === 0,
    requestedDays: Number(requestedDays) || safePlans.length,
    suggestedDays: Math.max(
      Number(requestedDays) || safePlans.length,
      Math.ceil(totalMinutes / dailyBudgetMin)
    ),
    reason: overloadedDays.length
      ? ("第 " + overloadedDays.map(function (item) {
          return item.day;
        }).join("、") + " 天时长超载（含酒店往返交通）")
      : "行程时长在可接受范围内",
    overloadedDays: overloadedDays,
  };
}

function sortByRecommendedOrder(places, recommendedOrder) {
  var placeList = Array.isArray(places) ? places.slice() : [];
  var order = Array.isArray(recommendedOrder) ? recommendedOrder : [];
  if (!order.length) {
    return placeList;
  }

  var rank = {};
  order.forEach(function (name, idx) {
    rank[normalizeName(name)] = idx;
  });

  return placeList.slice().sort(function (a, b) {
    var rankA = rank[normalizeName(a.name)];
    var rankB = rank[normalizeName(b.name)];

    if (Number.isFinite(rankA) && Number.isFinite(rankB)) {
      return rankA - rankB;
    }
    if (Number.isFinite(rankA)) {
      return -1;
    }
    if (Number.isFinite(rankB)) {
      return 1;
    }
    return 0;
  });
}

module.exports = {
  normalizeName: normalizeName,
  priorityToScore: priorityToScore,
  applyAgentInsights: applyAgentInsights,
  sortByRecommendedOrder: sortByRecommendedOrder,
  buildPlanDataFromOrder: buildPlanDataFromOrder,
  buildDailyPlansFromRoadbook: buildDailyPlansFromRoadbook,
  buildDailyPlansFromPlanData: buildDailyPlansFromPlanData,
  evaluateTimeFeasibility: evaluateTimeFeasibility,
  verifyHotelClosure: verifyHotelClosure,
  getStrategyTemplate: getStrategyTemplate,
  listStrategyTemplates: listStrategyTemplates,
  computeRouteMetrics: computeRouteMetrics,
  scoreRoute: scoreRoute,
  scoreRouteDetailed: scoreRouteDetailed,
  applyTransportPreference: applyTransportPreference,
  chooseBestOrder: chooseBestOrder,
  buildGreedyOrder: buildGreedyOrder,
  buildPriorityOrder: buildPriorityOrder,
  clusterOrderByCity: clusterOrderByCity,
  computeDailyMetrics: computeDailyMetrics,
  generateCandidateOrders: generateCandidateOrders,
  orderSignature: orderSignature,
  buildStrategyExplanation: buildStrategyExplanation,
  buildStrategyExplanationDetail: buildStrategyExplanationDetail,
  compareStrategies: compareStrategies,
  parseTransitLegs: parseTransitLegs,
};
