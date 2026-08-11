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

// v1.6 体力衰减：同一天内第 k 个景点（0 基）的有效游玩耗时 = 时长 ×(1 + rate×k)。
// 越往后越累，单日堆点会被放大，自然倾向把点分到更多天。rate 默认 0.1（用户确认）。
var FATIGUE_RATE = 0.1;
function fatigueAdjustedVisitMin(visitDurationsInOrder, rate) {
  var r = Number.isFinite(Number(rate)) ? Number(rate) : FATIGUE_RATE;
  var list = Array.isArray(visitDurationsInOrder) ? visitDurationsInOrder : [];
  return list.reduce(function (acc, dur, idx) {
    return acc + (Number(dur) || 0) * (1 + r * idx);
  }, 0);
}

// 把一组 places 连续切成 n 块（base+余数前置），保持顺序不打散。
function chunkContiguousPlaces(places, n) {
  var out = [];
  var count = Math.max(1, Number(n) || 1);
  var base = Math.floor(places.length / count);
  var remainder = places.length % count;
  var cursor = 0;
  var k;
  for (k = 0; k < count; k += 1) {
    var take = base + (k < remainder ? 1 : 0);
    out.push(places.slice(cursor, cursor + take));
    cursor += take;
  }
  return out;
}

// v1.6：天数 < 城市段数时，把相邻城市段合并成 days 组。
// 策略：反复合并「相邻两段点数之和最小」的一对，直到组数=days——
// 让大城市段尽量独占一天、把小段并到一起，跨城日不可避免时也控制在最少。
function mergeCityRunsIntoGroups(runs, days) {
  var work = runs.map(function (r) { return r.places.slice(); });
  while (work.length > days) {
    var bestI = 0;
    var bestSum = Infinity;
    var j;
    for (j = 0; j + 1 < work.length; j += 1) {
      var sum = work[j].length + work[j + 1].length;
      if (sum < bestSum) {
        bestSum = sum;
        bestI = j;
      }
    }
    work[bestI] = work[bestI].concat(work[bestI + 1]);
    work.splice(bestI + 1, 1);
  }
  return work;
}

// v1.6：按城市软对齐分天。orderedPlaces 已按城市聚类，据此切「连续同城段」runs：
//  - days >= runs 数：每段至少 1 天，多出的天迭代分给「点数/已分配天数」最拥挤的段，段内再连续均分；
//  - days <  runs 数：把相邻段合并成 days 组（见 mergeCityRunsIntoGroups），允许跨城日（软对齐、不强制一天一城）。
// 无城市信息（cityOf 全空）时退化为单段 → 等价旧的「连续均分」，保持向后兼容。
function splitPlacesIntoCityAlignedDays(orderedPlaces, days, cityOf) {
  var lookup = typeof cityOf === "function" ? cityOf : function () { return ""; };
  var runs = [];
  orderedPlaces.forEach(function (place) {
    var c = normalizeName(lookup(place.name));
    var last = runs[runs.length - 1];
    if (last && last.city === c) {
      last.places.push(place);
    } else {
      runs.push({ city: c, places: [place] });
    }
  });

  if (days >= runs.length) {
    var alloc = runs.map(function (r) { return { places: r.places, dayCount: 1 }; });
    var extra = days - runs.length;
    while (extra > 0) {
      var idxMax = 0;
      var loadMax = -1;
      alloc.forEach(function (a, i) {
        var load = a.places.length / a.dayCount;
        if (load > loadMax) {
          loadMax = load;
          idxMax = i;
        }
      });
      alloc[idxMax].dayCount += 1;
      extra -= 1;
    }
    var groups = [];
    alloc.forEach(function (a) {
      groups = groups.concat(chunkContiguousPlaces(a.places, a.dayCount));
    });
    return groups;
  }

  return mergeCityRunsIntoGroups(runs, days);
}

function buildPlanDataFromOrder(recommendedOrder, places, city, totalDays, options) {
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

  // v1.6：按城市软对齐分天（cityOf 由调用方注入；缺省退化为旧的连续均分，向后兼容）。
  var opts = options || {};
  var buckets = splitPlacesIntoCityAlignedDays(orderedPlaces, days, opts.cityOf);

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

// v1.6 多酒店：日期解析工具（统一走 UTC 零点，避免时区漂移）。
function parseDateUTC(text) {
  var t = String(text || "").trim();
  if (!t) {
    return null;
  }
  var d = new Date(t + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateStr(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

// v1.6 多酒店：把 lodging 归一化为酒店数组（兼容 mode:single 的 lodging.hotel 与 mode:multi 的 lodging.hotels）。
function extractHotels(lodging) {
  if (!lodging) {
    return [];
  }
  var raw = [];
  if (Array.isArray(lodging.hotels) && lodging.hotels.length) {
    raw = lodging.hotels.slice();
  } else if (lodging.hotel) {
    raw = [lodging.hotel];
  }
  return raw.filter(function (h) {
    return h && (String(h.name || "").trim() || String(h.address || "").trim());
  });
}

// v1.6 多酒店：构建「第 N 天 → 当天酒店」映射。
// 规则（见 内测-v1.6-前瞻规划.md §11）：
//   - 无酒店：全程 hotel=null（无酒店闭环）；
//   - 单酒店：全程该酒店（兼容旧行为），日期从 checkInDate 起算；
//   - 多酒店（2+ 且带日期）：按 checkIn<=date<checkOut 判定当天酒店；
//     换酒店日（旧酒店 checkOut==当天 且 新酒店 checkIn==当天）记 changeFrom；
//     无覆盖日记入 gapDays（退化无酒店闭环 + 提醒）。
function buildDayHotelMap(lodging, totalDays) {
  var count = Math.max(1, Math.floor(Number(totalDays) || 1));
  var hotels = extractHotels(lodging);
  var days = [];
  var gapDays = [];
  var i;

  if (!hotels.length) {
    for (i = 0; i < count; i += 1) {
      days.push({ day: i + 1, date: "", hotel: null, changeFrom: null });
    }
    return { days: days, gapDays: [], hasDates: false, hotels: [] };
  }

  if (hotels.length === 1) {
    // 单酒店：全程覆盖（兼容旧「全程固定酒店」行为），日期从 checkInDate 起算。
    var only = hotels[0];
    var ci1 = parseDateUTC(only.checkInDate);
    for (i = 0; i < count; i += 1) {
      var dstr = ci1 ? toDateStr(new Date(ci1.getTime() + i * 86400000)) : "";
      days.push({ day: i + 1, date: dstr, hotel: only, changeFrom: null });
    }
    return { days: days, gapDays: [], hasDates: Boolean(ci1), hotels: hotels };
  }

  // 多酒店：仅带合法日期区间的酒店参与按日覆盖判定。
  var dated = hotels.filter(function (h) {
    var ci = parseDateUTC(h.checkInDate);
    var co = parseDateUTC(h.checkOutDate);
    return ci && co && co.getTime() > ci.getTime();
  });
  if (!dated.length) {
    // 多家但都没填日期 → 无法按日安排，退化为「全程第一家」。
    var primary = hotels[0];
    for (i = 0; i < count; i += 1) {
      days.push({ day: i + 1, date: "", hotel: primary, changeFrom: null });
    }
    return { days: days, gapDays: [], hasDates: false, hotels: hotels };
  }

  var starts = dated.map(function (h) { return parseDateUTC(h.checkInDate).getTime(); });
  var tripStart = new Date(Math.min.apply(null, starts));
  for (i = 0; i < count; i += 1) {
    var dayDate = new Date(tripStart.getTime() + i * 86400000);
    var t = dayDate.getTime();
    var covering = null;
    var leaving = null;
    dated.forEach(function (h) {
      var ci = parseDateUTC(h.checkInDate);
      var co = parseDateUTC(h.checkOutDate);
      if (ci.getTime() <= t && t < co.getTime()) {
        covering = h;
      }
      if (co.getTime() === t) {
        leaving = h;
      }
    });
    var changeFrom = null;
    if (covering && leaving && leaving !== covering &&
      parseDateUTC(covering.checkInDate).getTime() === t) {
      // 换酒店日：旧酒店今日离店、新酒店今日入住 → 当天算新酒店，早上从旧酒店转移行李。
      changeFrom = leaving;
    }
    if (!covering) {
      gapDays.push(i + 1);
    }
    days.push({ day: i + 1, date: toDateStr(dayDate), hotel: covering, changeFrom: changeFrom });
  }
  return { days: days, gapDays: gapDays, hasDates: true, hotels: hotels };
}

// v1.6 多酒店：酒店日期合法性校验（离店早于/等于入住、区间重叠、空档日）。
// 返回 { errors, warnings }；errors 为硬问题（阻断），warnings 为软提醒。
function validateLodging(lodging, totalDays) {
  var errors = [];
  var warnings = [];
  var hotels = extractHotels(lodging);
  if (hotels.length <= 1) {
    // 单酒店/无酒店无需区间校验；仍检查单酒店日期方向。
    if (hotels.length === 1) {
      var ci0 = parseDateUTC(hotels[0].checkInDate);
      var co0 = parseDateUTC(hotels[0].checkOutDate);
      if (ci0 && co0 && co0.getTime() <= ci0.getTime()) {
        errors.push("酒店「" + (hotels[0].name || "未命名") + "」离店日期须晚于入住日期。");
      }
    }
    return { errors: errors, warnings: warnings };
  }

  var intervals = [];
  hotels.forEach(function (h) {
    var ci = parseDateUTC(h.checkInDate);
    var co = parseDateUTC(h.checkOutDate);
    var label = h.name || "未命名酒店";
    if (!ci || !co) {
      warnings.push("酒店「" + label + "」未填写完整的入住/离店日期，多酒店安排下该酒店不会被排入任何一天。");
      return;
    }
    if (co.getTime() <= ci.getTime()) {
      errors.push("酒店「" + label + "」离店日期须晚于入住日期。");
      return;
    }
    intervals.push({ label: label, start: ci.getTime(), end: co.getTime() });
  });

  // 区间重叠检测：允许「离店日 == 下一家入住日」的衔接（半开区间 [start,end)），仅当真正重叠才提醒。
  intervals.sort(function (a, b) { return a.start - b.start; });
  var j;
  for (j = 1; j < intervals.length; j += 1) {
    if (intervals[j].start < intervals[j - 1].end) {
      warnings.push("酒店「" + intervals[j - 1].label + "」与「" + intervals[j].label + "」的入住区间重叠，请核对日期（同一晚不应住两家）。");
    }
  }

  var map = buildDayHotelMap(lodging, totalDays);
  if (map.gapDays.length) {
    warnings.push("第 " + map.gapDays.join("、") + " 天没有酒店覆盖，将按「无酒店闭环」处理，请确认是否需要补充住宿。");
  }
  return { errors: errors, warnings: warnings };
}

// v1.6 多酒店：找出一组 segments 里第一段「非行李转移」的 transit（用于闭环起点判定）。
function firstTouringTransit(segments) {
  var list = Array.isArray(segments) ? segments : [];
  var i;
  for (i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].type === "transit" && !list[i].luggageTransfer) {
      return list[i];
    }
  }
  return null;
}

function buildDailyPlansFromPlanData(planData, lodging, totalDays, options) {
  var safePlan = Array.isArray(planData) ? planData : [];
  if (!safePlan.length) {
    return [];
  }
  var opts = options || {};
  // v1.5.2 #1：把营业时间（Google Places）透出到每个景点，供前端展示与自证数据来源。
  var openingHoursByPlace = opts.openingHoursByPlace || null;
  // v1.6 多酒店：按天解析当日酒店（单酒店/无酒店场景兼容旧行为）。
  var effectiveDays = Math.max(safePlan.length, Math.floor(Number(totalDays) || safePlan.length));
  var hotelMap = buildDayHotelMap(lodging, effectiveDays);

  return safePlan.map(function (dayPlan, index) {
    var dayInfo = hotelMap.days[index] || { hotel: null, changeFrom: null, date: "" };
    var dayHotel = dayInfo.hotel;
    var hotelName = dayHotel ? String(dayHotel.name || "").trim() : "";
    var hasHotel = Boolean(hotelName);
    var changeFromName = dayInfo.changeFrom ? String(dayInfo.changeFrom.name || "").trim() : "";

    var items = (Array.isArray(dayPlan.items) ? dayPlan.items : []).filter(function (item) {
      return item && item.type === "visit";
    });
    var segments = [];

    // v1.6 换酒店日：早上从旧酒店出发，先把行李转移到新酒店（独立标记的 transit 段）。
    if (hasHotel && changeFromName && changeFromName !== hotelName) {
      var luggage = buildTransitSegment(changeFromName, hotelName, opts);
      luggage.luggageTransfer = true;
      luggage.note = "换酒店：行李从「" + changeFromName + "」转移至「" + hotelName + "」";
      segments.push(luggage);
    }

    items.forEach(function (item, itemIndex) {
      // v1.2 酒店闭环硬约束：有酒店时每日首段必须从（当日）酒店出发
      if (itemIndex === 0 && hasHotel) {
        segments.push(buildTransitSegment(hotelName, item.title, opts));
      }
      var oh = openingHoursByPlace ? (openingHoursByPlace[normalizeName(item.title)] || null) : null;
      segments.push({
        type: "visit",
        placeName: item.title,
        visitTimeRange: item.durationMin ? ("建议" + (Math.max(0.5, Number(item.durationMin) / 60).toFixed(1)) + "小时") : "",
        visitDurationMin: Number(item.durationMin) || 90,
        openingHours: oh
          ? { open: oh.open || null, close: oh.close || null, verifyState: oh.verifyState || "verified", source: oh.source || null }
          : null,
      });
      var nextItem = items[itemIndex + 1];
      if (nextItem) {
        segments.push(buildTransitSegment(item.title, nextItem.title, opts));
      } else if (hasHotel) {
        // v1.2 酒店闭环硬约束：末段必须返回（当日）酒店
        segments.push(buildTransitSegment(item.title, hotelName, opts));
      }
    });

    var dateText = dayInfo.date || "";

    var closedLoop = true;
    if (hasHotel && items.length) {
      var firstSeg = firstTouringTransit(segments);
      var lastSeg = segments[segments.length - 1];
      closedLoop = Boolean(
        firstSeg && firstSeg.from === hotelName &&
        lastSeg && lastSeg.type === "transit" && lastSeg.to === hotelName
      );
    }

    return {
      day: Number(dayPlan.day) || (index + 1),
      date: dateText,
      hotelName: hotelName,
      changeFromHotel: changeFromName || "",
      closedLoop: closedLoop,
      segments: segments,
    };
  });
}

function verifyHotelClosure(dailyPlans, lodging) {
  var hotels = extractHotels(lodging);
  if (!hotels.length) {
    return { closed: true, warnings: [], openDays: [] };
  }
  // 主酒店：用于未标注每日 hotelName 的旧结构 dailyPlans（单酒店行为）。
  var fallbackName = String(hotels[0].name || "").trim();
  var openDays = [];
  (Array.isArray(dailyPlans) ? dailyPlans : []).forEach(function (dayPlan) {
    var segments = Array.isArray(dayPlan.segments) ? dayPlan.segments : [];
    if (!segments.length) {
      return;
    }
    // v1.6：优先按「当日酒店」判定闭环；
    //   - 显式标注 hotelName="" → 多酒店空档日，不要求闭环（由 validateLodging 提醒）；
    //   - 未标注 hotelName（旧结构）→ 回退到主酒店，保持单酒店旧行为。
    var dayHotelName;
    if (Object.prototype.hasOwnProperty.call(dayPlan, "hotelName")) {
      dayHotelName = String(dayPlan.hotelName || "").trim();
      if (!dayHotelName) {
        return;
      }
    } else {
      dayHotelName = fallbackName;
    }
    if (!dayHotelName) {
      return;
    }
    var first = firstTouringTransit(segments);
    var last = segments[segments.length - 1];
    var closed = Boolean(
      first && first.from === dayHotelName &&
      last && last.type === "transit" && last.to === dayHotelName
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
      // #5：仅当相邻两点城市均已知且不同才计跨城，避免「缺城市元数据」被误判为跨城而虚增计数。
      var isCrossCity = Boolean(prevCity) && Boolean(city) && prevCity !== city;
      if (isCrossCity) {
        crossCityCount += 1;
      }
      totalTravelMin += travelMin;
      legs.push({ from: prev, to: name, durationMin: travelMin, crossCity: isCrossCity });
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

// v1.5.2（#3/#4）交付前重打分：clusterOrderByCity（OI-1）与修复阶段会改变最终顺序，
// 若结构化解释仍用「选择时」的 chosenRoute，会出现「解释的得分构成 ≠ 页面展示的 routeMetrics」。
// 本函数以 finalOrder（= 展示口径）重算得分构成，并用同一 lookup 对次优候选顺序重打分，
// 使 buildStrategyExplanationDetail 的 chosenBreakdown/scoreGap 与展示同源、口径一致。
function rescoreChosenForDelivery(finalOrder, chosenRoute, placeMetaMap, getTravelMin, strategy, transportPreference) {
  var order = (Array.isArray(finalOrder) ? finalOrder : []).filter(Boolean);
  var metrics = computeRouteMetrics(order, placeMetaMap, getTravelMin);
  var detail = scoreRouteDetailed(metrics, strategy, transportPreference);
  var prev = chosenRoute || {};
  var second = null;
  var prevSecond = prev.secondBest || null;
  if (prevSecond && Array.isArray(prevSecond.order) && prevSecond.order.length) {
    var secMetrics = computeRouteMetrics(prevSecond.order, placeMetaMap, getTravelMin);
    var secDetail = scoreRouteDetailed(secMetrics, strategy, transportPreference);
    second = {
      source: prevSecond.source || null,
      order: prevSecond.order.slice(),
      metrics: secMetrics,
      cost: secDetail.score,
      breakdown: secDetail.breakdown,
      normalized: secDetail.normalized,
    };
  }
  return {
    source: prev.source || "llm",
    order: order,
    metrics: metrics,
    cost: detail.score,
    breakdown: detail.breakdown,
    normalized: detail.normalized,
    secondBest: second,
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

function evaluateTimeFeasibility(dailyPlans, requestedDays, options) {
  var safePlans = Array.isArray(dailyPlans) ? dailyPlans : [];
  var overloadedDays = [];
  var totalMinutes = 0;
  // v1.6：单日预算可由调用方按体力强度注入，并按 slack 预留时间冗余；缺省保持 10h、无 buffer（向后兼容）。
  var opts = options || {};
  var baseBudget = Number.isFinite(Number(opts.dayBudgetMin)) ? Number(opts.dayBudgetMin) : 10 * 60;
  var slack = Number.isFinite(Number(opts.slack)) && Number(opts.slack) > 0 ? Number(opts.slack) : 1;
  var dailyBudgetMin = Math.max(1, Math.round(baseBudget * slack));

  safePlans.forEach(function (dayPlan) {
    var segments = Array.isArray(dayPlan.segments) ? dayPlan.segments : [];
    // v1.6：单日游览耗时按出现顺序计入体力衰减；通勤时长照原样累加。
    var visitDurations = [];
    var transitTotal = 0;
    segments.forEach(function (segment) {
      if (segment.type === "visit") {
        visitDurations.push(Number(segment.visitDurationMin) || 90);
      } else if (segment.type === "transit") {
        transitTotal += Number(segment.durationMin) || 30;
      }
    });
    var dayTotal = Math.round(fatigueAdjustedVisitMin(visitDurations, FATIGUE_RATE)) + transitTotal;
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
  splitPlacesIntoCityAlignedDays: splitPlacesIntoCityAlignedDays,
  fatigueAdjustedVisitMin: fatigueAdjustedVisitMin,
  FATIGUE_RATE: FATIGUE_RATE,
  buildDailyPlansFromRoadbook: buildDailyPlansFromRoadbook,
  buildDailyPlansFromPlanData: buildDailyPlansFromPlanData,
  evaluateTimeFeasibility: evaluateTimeFeasibility,
  verifyHotelClosure: verifyHotelClosure,
  extractHotels: extractHotels,
  buildDayHotelMap: buildDayHotelMap,
  validateLodging: validateLodging,
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
  rescoreChosenForDelivery: rescoreChosenForDelivery,
  compareStrategies: compareStrategies,
  parseTransitLegs: parseTransitLegs,
};
