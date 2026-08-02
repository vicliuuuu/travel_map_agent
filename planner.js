(function (globalScope) {
  "use strict";

  function toMinutes(hour, minute) {
    return (hour * 60) + minute;
  }

  function formatTime(totalMinutes) {
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    var hh = h < 10 ? "0" + h : String(h);
    var mm = m < 10 ? "0" + m : String(m);
    return hh + ":" + mm;
  }

  function normalizeDays(totalDays) {
    var parsed = Number(totalDays);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 1;
    }
    return Math.floor(parsed);
  }

  function pickTopPlaces(places, maxPlaces) {
    var safePlaces = Array.isArray(places) ? places.slice() : [];
    safePlaces.sort(function (a, b) {
      var scoreA = Number(a.score || 0);
      var scoreB = Number(b.score || 0);
      return scoreB - scoreA;
    });
    return safePlaces.slice(0, maxPlaces);
  }

  function buildGeocodeQuery(place, country, city) {
    var name = String((place && place.name) || "").trim();
    var addressExtra = String((place && place.addressExtra) || "").trim();
    if (addressExtra) {
      return [addressExtra, city, country].filter(function (part) {
        return !!part;
      }).join(", ");
    }
    return [name, city, country].filter(function (part) {
      return !!part;
    }).join(", ");
  }

  function formatPlaceDisplayAddress(addressExtra, city, country) {
    var parts = [addressExtra, city, country].filter(function (part) {
      return !!part;
    });
    return parts.join(", ");
  }

  function parsePlaceRows(rows, country, city) {
    var safeRows = Array.isArray(rows) ? rows : [];
    var places = [];

    safeRows.forEach(function (row, index) {
      var name = String((row && row.name) || "").trim();
      var addressExtra = String((row && row.address) || "").trim();
      if (!name && !addressExtra) {
        return;
      }

      var displayName = name || ("景点 #" + (index + 1));
      var displayAddress = formatPlaceDisplayAddress(addressExtra, city, country);
      var durationCandidate = Number(row && row.durationMin);
      var durationMin = Number.isFinite(durationCandidate) && durationCandidate > 0
        ? Math.floor(durationCandidate)
        : null;

      places.push({
        placeId: "manual-" + (places.length + 1),
        name: displayName,
        addressExtra: addressExtra,
        address: displayAddress,
        geocodeQuery: buildGeocodeQuery({
          name: displayName,
          addressExtra: addressExtra,
        }, country, city),
        rating: null,
        score: Number(5 - (places.length * 0.01)),
        durationMin: durationMin,
        selected: true,
        location: null,
        resolvedAddress: "",
        resolvedLat: null,
        resolvedLng: null,
      });
    });

    return places;
  }

  function parseManualPlaces(rawInput, country, city) {
    var text = typeof rawInput === "string" ? rawInput : "";
    var lines = text
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });

    return lines.map(function (line, index) {
      var parts = line.split("|").map(function (part) {
        return part.trim();
      });
      var name = parts[0] || ("景点 #" + (index + 1));
      var addressParts = [parts[1], city, country].filter(function (part) {
        return !!part;
      });
      var durationCandidate = Number(parts[2]);
      var durationMin = Number.isFinite(durationCandidate) && durationCandidate > 0
        ? Math.floor(durationCandidate)
        : null;
      return {
        placeId: "manual-" + (index + 1),
        name: name,
        address: addressParts.join(", "),
        rating: null,
        // 手动输入默认按输入顺序给分，越靠前优先级越高
        score: Number(5 - (index * 0.01)),
        durationMin: durationMin,
        selected: true,
        location: null,
      };
    });
  }

  function distributePlacesByDay(places, totalDays) {
    var days = normalizeDays(totalDays);
    var result = [];
    var i;
    for (i = 0; i < days; i += 1) {
      result.push([]);
    }

    places.forEach(function (place, index) {
      result[index % days].push(place);
    });
    return result;
  }

  function resolveVisitDurationMin(place, defaultDurationMin) {
    var durationCandidate = Number(
      place.suggestedDurationMin || place.durationMin || defaultDurationMin
    );
    if (!Number.isFinite(durationCandidate) || durationCandidate <= 0) {
      return Number(defaultDurationMin || 90);
    }
    return Math.floor(durationCandidate);
  }

  function buildDaySchedule(dayPlaces, options) {
    var startHour = Number(options.startHour || 9);
    var endHour = Number(options.endHour || 20);
    var visitDurationMin = Number(options.visitDurationMin || 90);
    var transitBufferMin = Number(options.transitBufferMin || 20);
    var lunchBreakAtHour = Number(options.lunchBreakAtHour || 12);
    var lunchDurationMin = Number(options.lunchDurationMin || 60);

    var nowMinute = toMinutes(startHour, 0);
    var dayEndMinute = toMinutes(endHour, 0);
    var lunchStartMinute = toMinutes(lunchBreakAtHour, 0);
    var lunchEndMinute = lunchStartMinute + lunchDurationMin;

    var items = [];
    dayPlaces.forEach(function (place) {
      var currentVisitDurationMin = resolveVisitDurationMin(place, visitDurationMin);
      var segmentStart = nowMinute;
      var segmentEnd = segmentStart + currentVisitDurationMin;

      if (segmentStart < lunchStartMinute && segmentEnd > lunchStartMinute) {
        items.push({
          type: "meal",
          title: "午餐休息",
          startTime: formatTime(lunchStartMinute),
          endTime: formatTime(lunchEndMinute),
        });
        segmentStart = lunchEndMinute;
        segmentEnd = segmentStart + currentVisitDurationMin;
      }

      if (segmentEnd > dayEndMinute) {
        return;
      }

      items.push({
        type: "visit",
        placeId: place.placeId || null,
        title: place.name,
        address: place.address || "",
        rating: place.rating || null,
        location: place.location || null,
        durationMin: currentVisitDurationMin,
        startTime: formatTime(segmentStart),
        endTime: formatTime(segmentEnd),
      });

      nowMinute = segmentEnd + transitBufferMin;
    });

    return items;
  }

  function buildItinerary(config) {
    var safeConfig = config || {};
    var totalDays = normalizeDays(safeConfig.totalDays);
    var city = safeConfig.city || "";
    var maxPlaces = Number(safeConfig.maxPlaces || (totalDays * 5));
    var topPlaces = pickTopPlaces(safeConfig.places || [], maxPlaces);
    var grouped = distributePlacesByDay(topPlaces, totalDays);

    return grouped.map(function (dayPlaces, index) {
      return {
        day: index + 1,
        city: city,
        items: buildDaySchedule(dayPlaces, safeConfig),
      };
    });
  }

  function buildRouteStops(planData) {
    var safePlan = Array.isArray(planData) ? planData : [];
    var stops = [];
    safePlan.forEach(function (dayPlan) {
      var day = dayPlan.day || 0;
      var items = Array.isArray(dayPlan.items) ? dayPlan.items : [];
      items.forEach(function (item) {
        if (item.type === "visit") {
          stops.push({
            day: day,
            title: item.title || "未命名景点",
            address: item.address || "",
            startTime: item.startTime || "",
          });
        }
      });
    });
    return stops;
  }

  var exportsObj = {
    buildItinerary: buildItinerary,
    buildRouteStops: buildRouteStops,
    distributePlacesByDay: distributePlacesByDay,
    buildDaySchedule: buildDaySchedule,
    formatTime: formatTime,
    parseManualPlaces: parseManualPlaces,
    parsePlaceRows: parsePlaceRows,
    buildGeocodeQuery: buildGeocodeQuery,
    formatPlaceDisplayAddress: formatPlaceDisplayAddress,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof globalScope !== "undefined") {
    globalScope.TravelPlanner = exportsObj;
  }
}(typeof window !== "undefined" ? window : global));
