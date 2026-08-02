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
};
