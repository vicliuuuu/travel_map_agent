"use strict";

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

  orderedPlaces.forEach(function (place, index) {
    buckets[index % days].push(place);
  });

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

function buildDailyPlansFromPlanData(planData, lodging, totalDays) {
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

  return safePlan.map(function (dayPlan, index) {
    var items = Array.isArray(dayPlan.items) ? dayPlan.items : [];
    var segments = [];
    items.forEach(function (item, itemIndex) {
      if (!item || item.type !== "visit") {
        return;
      }
      if (itemIndex === 0 && hasHotel) {
        segments.push({
          type: "transit",
          from: hotelName,
          to: item.title,
          durationRange: "请以实时导航为准",
          durationMin: null,
        });
      }
      segments.push({
        type: "visit",
        placeName: item.title,
        visitTimeRange: item.durationMin ? ("建议" + (Math.max(0.5, Number(item.durationMin) / 60).toFixed(1)) + "小时") : "",
        visitDurationMin: Number(item.durationMin) || 90,
      });
      var nextItem = items[itemIndex + 1];
      if (nextItem && nextItem.type === "visit") {
        segments.push({
          type: "transit",
          from: item.title,
          to: nextItem.title,
          durationRange: "请以实时导航为准",
          durationMin: null,
        });
      } else if (hasHotel) {
        segments.push({
          type: "transit",
          from: item.title,
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
      day: Number(dayPlan.day) || (index + 1),
      date: dateText,
      hotelName: hotelName,
      segments: segments,
    };
  });
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
};
