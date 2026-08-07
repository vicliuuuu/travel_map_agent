"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var planner = require("./planner.js");
var llm = require("./llm.js");
var agentPlanner = require("./agent-planner.js");

var HOST = process.env.HOST || "127.0.0.1";
var PORT = Number(process.env.PORT || 8080);
var ROOT_DIR = __dirname;

// v1.2 公网化配置
var ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(function (item) {
    return item.trim();
  })
  .filter(function (item) {
    return !!item;
  });
var RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
var RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
var rateLimitBuckets = new Map();

// 是否把后端 .env 中的密钥下发到前端输入框做预填（仅自测用；正式上线设为 false，让用户自行填写）
var EXPOSE_KEYS_TO_FRONTEND = String(process.env.EXPOSE_KEYS_TO_FRONTEND || "false").toLowerCase() === "true";

var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
    });
    req.on("end", function () {
      var raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", function (err) {
      reject(err);
    });
  });
}

function safePathFromUrl(urlPath) {
  var cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  var normalized = path.normalize(decodeURIComponent(cleanPath)).replace(/^(\.\.[/\\])+/, "");
  return path.join(ROOT_DIR, normalized);
}

function serveStatic(req, res) {
  var filePath = safePathFromUrl(req.url.split("?")[0]);
  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "非法路径" });
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      sendJson(res, 404, { error: "文件不存在" });
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function buildAgentPrompt(input) {
  return llm.buildAgentUserPrompt(input);
}

function createToolContext(input) {
  return {
    input: input,
    geocodeByName: {},
    geocodeByKey: {},
    travelCache: {},
    geocodeEntries: [],
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseAddressComponent(components, wantedType) {
  var list = Array.isArray(components) ? components : [];
  var found = list.find(function (item) {
    return Array.isArray(item.types) && item.types.indexOf(wantedType) >= 0;
  });
  return found ? String(found.long_name || found.short_name || "").trim() : "";
}

function looksAsciiComparable(value) {
  // 仅当两侧都是 ASCII（拉丁文）时才做字符串包含比较；含 CJK/本地字符时不做强制排除
  return /^[\x00-\x7f]*$/.test(String(value || ""));
}

function isSameLoose(declared, resolved) {
  var d = normalizeText(declared);
  var r = normalizeText(resolved);
  if (!d || !r) {
    return true;
  }
  return r.indexOf(d) >= 0 || d.indexOf(r) >= 0;
}

function countryConflicts(declaredCountry, resolvedCountry) {
  var d = normalizeText(declaredCountry);
  var r = normalizeText(resolvedCountry);
  if (!d || !r) {
    return false;
  }
  // 声明或解析含非 ASCII（如中文国名）时无法可靠比较，放行以避免误排除
  if (!looksAsciiComparable(declaredCountry) || !looksAsciiComparable(resolvedCountry)) {
    return false;
  }
  return !isSameLoose(declaredCountry, resolvedCountry);
}

function cityNameDiffers(declaredCity, resolvedCity) {
  var d = normalizeText(declaredCity);
  var r = normalizeText(resolvedCity);
  if (!d || !r) {
    return false;
  }
  return !isSameLoose(declaredCity, resolvedCity);
}

function buildDefaultLodging(lodging) {
  if (!lodging || !lodging.hotel) {
    return null;
  }
  var name = String(lodging.hotel.name || "").trim();
  var address = String(lodging.hotel.address || "").trim();
  if (!name && !address) {
    return null;
  }
  return {
    mode: "single",
    hotel: {
      name: name,
      address: address,
      checkInDate: String(lodging.hotel.checkInDate || "").trim(),
      checkOutDate: String(lodging.hotel.checkOutDate || "").trim(),
    },
  };
}

function splitLodgingFromPlaces(flatPlaces, fallbackLodging) {
  var places = Array.isArray(flatPlaces) ? flatPlaces : [];
  var lodging = fallbackLodging || null;
  var filtered = [];
  places.forEach(function (place) {
    if (place.isHotel) {
      if (!lodging) {
        lodging = {
          mode: "single",
          hotel: {
            name: String(place.name || "酒店").trim(),
            address: String(place.addressExtra || place.address || "").trim(),
            checkInDate: "",
            checkOutDate: "",
          },
        };
      }
      return;
    }
    filtered.push(place);
  });
  return {
    lodging: lodging,
    places: filtered,
  };
}

function normalizeTripInput(body) {
  var hasDestinations = Array.isArray(body.destinations) && body.destinations.length;
  var destinations = hasDestinations
    ? body.destinations
    : planner.normalizeLegacyInputToDestinations(body.country, body.city, body.places);
  var flatPlaces = planner.flattenDestinations(destinations);
  var lodging = buildDefaultLodging(body.lodging);
  var splitResult = splitLodgingFromPlaces(flatPlaces, lodging);
  var manualDays = Number(body.totalDays);
  if (!Number.isFinite(manualDays) || manualDays <= 0) {
    manualDays = 1;
  }
  return {
    destinations: destinations,
    places: splitResult.places,
    lodging: splitResult.lodging,
    totalDays: Math.floor(manualDays),
    country: String(body.country || (destinations[0] && destinations[0].country) || "").trim(),
    city: String(
      body.city ||
      (destinations[0] && destinations[0].cities && destinations[0].cities[0] && destinations[0].cities[0].city) ||
      ""
    ).trim(),
  };
}

function geocodePlace(toolContext, args, mapsApiKey) {
  return new Promise(function (resolve, reject) {
    var placeName = String(args.placeName || "").trim();
    var placeAddress = String(args.placeAddress || "").trim();
    var city = String(args.city || toolContext.input.city || "").trim();
    var country = String(args.country || toolContext.input.country || "").trim();

    if (!placeName && !placeAddress) {
      reject(new Error("geocode_place 参数缺失"));
      return;
    }

    var query = planner.buildGeocodeQuery({
      name: placeName,
      addressExtra: placeAddress,
    }, country, city);
    var key = query.toLowerCase();
    if (toolContext.geocodeByKey[key]) {
      resolve(toolContext.geocodeByKey[key]);
      return;
    }

    var url = "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(query) + "&key=" + encodeURIComponent(mapsApiKey);

    fetch(url)
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data.status !== "OK" || !data.results || !data.results[0]) {
          reject(new Error("地理编码失败: " + query + " (" + data.status + ")"));
          return;
        }
        var first = data.results[0];
        var resolvedCountry = parseAddressComponent(first.address_components, "country");
        var resolvedCity =
          parseAddressComponent(first.address_components, "locality") ||
          parseAddressComponent(first.address_components, "administrative_area_level_2") ||
          parseAddressComponent(first.address_components, "administrative_area_level_1");
        var result = {
          placeName: placeName || first.formatted_address,
          formattedAddress: first.formatted_address,
          lat: first.geometry.location.lat,
          lng: first.geometry.location.lng,
          resolvedCountry: resolvedCountry,
          resolvedCity: resolvedCity,
        };
        toolContext.geocodeByKey[key] = result;
        if (placeName) {
          toolContext.geocodeByName[placeName.toLowerCase()] = result;
        }
        toolContext.geocodeEntries.push({
          placeName: placeName || first.formatted_address,
          declaredCountry: country,
          declaredCity: city,
          formattedAddress: first.formatted_address,
          resolvedCountry: resolvedCountry,
          resolvedCity: resolvedCity,
        });
        resolve(result);
      })
      .catch(function (err) {
        reject(err);
      });
  });
}

async function preGeocodeInput(toolContext, mapsApiKey, onProgress) {
  var places = Array.isArray(toolContext.input.places) ? toolContext.input.places : [];
  var idx;
  for (idx = 0; idx < places.length; idx += 1) {
    var place = places[idx];
    if (typeof onProgress === "function") {
      onProgress({
        stage: "pre_geocode",
        message: "预解析景点位置 " + (idx + 1) + "/" + places.length,
      });
    }
    try {
      await geocodePlace(
        toolContext,
        {
          placeName: place.name,
          placeAddress: place.addressExtra || place.address || "",
          city: place.declaredCity || toolContext.input.city || "",
          country: place.declaredCountry || toolContext.input.country || "",
        },
        mapsApiKey
      );
    } catch (err) {
      // keep going to let LLM/validation handle unresolved places
    }
  }
  var hotel = toolContext.input.lodging && toolContext.input.lodging.hotel
    ? toolContext.input.lodging.hotel
    : null;
  if (hotel && (hotel.name || hotel.address)) {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "pre_geocode",
        message: "预解析酒店位置",
      });
    }
    try {
      var hotelGeo = await geocodePlace(
        toolContext,
        {
          placeName: hotel.name || "酒店",
          placeAddress: hotel.address || "",
          city: toolContext.input.city || "",
          country: toolContext.input.country || "",
        },
        mapsApiKey
      );
      hotel.resolvedAddress = hotelGeo.formattedAddress;
    } catch (err) {
      // no-op
    }
  }
}

function getTravelTime(toolContext, args, mapsApiKey) {
  return new Promise(function (resolve, reject) {
    var fromName = String(args.fromPlaceName || "").trim();
    var toName = String(args.toPlaceName || "").trim();
    var mode = String(args.mode || "driving").trim().toLowerCase();
    var from = toolContext.geocodeByName[fromName.toLowerCase()];
    var to = toolContext.geocodeByName[toName.toLowerCase()];
    if (!from || !to) {
      reject(new Error("请先 geocode 两个景点再查询时长"));
      return;
    }

    var cacheKey = [from.placeName, to.placeName, mode].join("|").toLowerCase();
    if (toolContext.travelCache[cacheKey]) {
      resolve(toolContext.travelCache[cacheKey]);
      return;
    }

    var url = "https://maps.googleapis.com/maps/api/directions/json?origin=" +
      encodeURIComponent(from.lat + "," + from.lng) +
      "&destination=" + encodeURIComponent(to.lat + "," + to.lng) +
      "&mode=" + encodeURIComponent(mode) +
      "&key=" + encodeURIComponent(mapsApiKey);

    fetch(url)
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data.status !== "OK" || !data.routes || !data.routes[0] || !data.routes[0].legs || !data.routes[0].legs[0]) {
          reject(new Error("路线查询失败: " + data.status));
          return;
        }
        var leg = data.routes[0].legs[0];
        var minutes = Math.max(1, Math.round(Number(leg.duration.value || 0) / 60));
        var result = {
          fromPlaceName: from.placeName,
          toPlaceName: to.placeName,
          mode: mode,
          durationMin: minutes,
          distanceText: leg.distance.text,
        };
        toolContext.travelCache[cacheKey] = result;
        resolve(result);
      })
      .catch(function (err) {
        reject(err);
      });
  });
}

function fetchTransitDirections(toolContext, fromName, toName, mapsApiKey) {
  return new Promise(function (resolve, reject) {
    var from = toolContext.geocodeByName[String(fromName || "").trim().toLowerCase()];
    var to = toolContext.geocodeByName[String(toName || "").trim().toLowerCase()];
    if (!from || !to) {
      reject(new Error("跨城 transit 查询前需先 geocode 两个景点"));
      return;
    }
    var cacheKey = ["transit", from.placeName, to.placeName].join("|").toLowerCase();
    if (toolContext.transitCache && toolContext.transitCache[cacheKey]) {
      resolve(toolContext.transitCache[cacheKey]);
      return;
    }
    var url = "https://maps.googleapis.com/maps/api/directions/json?origin=" +
      encodeURIComponent(from.lat + "," + from.lng) +
      "&destination=" + encodeURIComponent(to.lat + "," + to.lng) +
      "&mode=transit&key=" + encodeURIComponent(mapsApiKey);

    fetch(url)
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data.status !== "OK" || !data.routes || !data.routes[0]) {
          reject(new Error("transit 路线查询失败: " + data.status));
          return;
        }
        if (!toolContext.transitCache) {
          toolContext.transitCache = {};
        }
        toolContext.transitCache[cacheKey] = data;
        resolve(data);
      })
      .catch(function (err) {
        reject(err);
      });
  });
}

function buildPlaceMetaMap(places, analysisPlaces, toolContext) {
  var priorityByName = {};
  (Array.isArray(analysisPlaces) ? analysisPlaces : []).forEach(function (item) {
    priorityByName[agentPlanner.normalizeName(item.name)] = String(item.priority || "medium").toLowerCase();
  });
  var map = {};
  (Array.isArray(places) ? places : []).forEach(function (place) {
    var key = agentPlanner.normalizeName(place.name);
    var resolved = toolContext.geocodeByName[String(place.name || "").trim().toLowerCase()] || {};
    map[key] = {
      city: resolved.resolvedCity || place.declaredCity || "",
      country: resolved.resolvedCountry || place.declaredCountry || "",
      priority: priorityByName[key] || place.llmPriority || "medium",
    };
  });
  return map;
}

function makeTravelLookup(toolContext) {
  var cache = (toolContext && toolContext.travelCache) || {};
  var keys = Object.keys(cache);
  return function (fromName, toName) {
    var from = String(fromName || "").toLowerCase();
    var to = String(toName || "").toLowerCase();
    var i;
    for (i = 0; i < keys.length; i += 1) {
      var parts = keys[i].split("|");
      if (parts.length >= 2 && parts[0] === from && parts[1] === to) {
        return Number(cache[keys[i]].durationMin) || null;
      }
    }
    return null;
  };
}

async function buildTransitBreakdowns(order, toolContext, placeMetaMap, mapsApiKey, onProgress) {
  var names = (Array.isArray(order) ? order : []).filter(Boolean);
  var breakdowns = [];
  var index;
  for (index = 1; index < names.length; index += 1) {
    var from = names[index - 1];
    var to = names[index];
    var cityFrom = agentPlanner.normalizeName((placeMetaMap[agentPlanner.normalizeName(from)] || {}).city || "");
    var cityTo = agentPlanner.normalizeName((placeMetaMap[agentPlanner.normalizeName(to)] || {}).city || "");
    if (!cityFrom || !cityTo || cityFrom === cityTo) {
      continue;
    }
    if (typeof onProgress === "function") {
      onProgress({ stage: "transit", message: "解析跨城交通分段：" + from + " → " + to });
    }
    try {
      var directions = await fetchTransitDirections(toolContext, from, to, mapsApiKey);
      var parsed = agentPlanner.parseTransitLegs(directions);
      if (parsed.legs.length) {
        breakdowns.push({
          from: from,
          to: to,
          mode: "transit",
          totalDurationMin: parsed.totalDurationMin,
          legs: parsed.legs,
        });
      }
    } catch (err) {
      // 跨城 transit 数据在部分地区不可用，保留空段由 UI 兜底提示
    }
  }
  return breakdowns;
}

function makeTransitLookup(transitBreakdowns) {
  var list = Array.isArray(transitBreakdowns) ? transitBreakdowns : [];
  return function (fromName, toName) {
    var from = String(fromName || "").toLowerCase();
    var to = String(toName || "").toLowerCase();
    var found = list.find(function (item) {
      return String(item.from || "").toLowerCase() === from && String(item.to || "").toLowerCase() === to;
    });
    return found || null;
  };
}

function buildToolSpecs() {
  return [
    {
      type: "function",
      function: {
        name: "geocode_place",
        description: "将景点解析为经纬度。先用景点名+城市+国家查询；若用户提供了详细地址，可填入 placeAddress。",
        parameters: {
          type: "object",
          properties: {
            placeName: { type: "string" },
            placeAddress: { type: "string" },
            city: { type: "string" },
            country: { type: "string" },
          },
          required: ["placeName"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_travel_time",
        description: "获取两个已 geocode 景点之间的真实驾驶时长（分钟）与距离，用于路书路段规划",
        parameters: {
          type: "object",
          properties: {
            fromPlaceName: { type: "string" },
            toPlaceName: { type: "string" },
            mode: { type: "string", enum: ["driving", "walking", "transit"] },
          },
          required: ["fromPlaceName", "toPlaceName"],
        },
      },
    },
  ];
}

function executeToolCall(toolContext, toolCall, mapsApiKey) {
  var fn = toolCall.function || {};
  var args = {};
  try {
    args = fn.arguments ? JSON.parse(fn.arguments) : {};
  } catch (err) {
    return Promise.reject(new Error("工具参数 JSON 解析失败"));
  }

  if (fn.name === "geocode_place") {
    return geocodePlace(toolContext, args, mapsApiKey);
  }
  if (fn.name === "get_travel_time") {
    return getTravelTime(toolContext, args, mapsApiKey);
  }
  return Promise.reject(new Error("未知工具: " + fn.name));
}

async function runToolCallingAgent(input, onProgress) {
  var llmBaseUrl = String(input.llmBaseUrl || "").replace(/\/$/, "");
  var llmApiKey = String(input.llmApiKey || "");
  var llmModel = String(input.llmModel || "");
  var mapsApiKey = String(input.mapsApiKey || "");
  var toolContext = createToolContext(input);
  await preGeocodeInput(toolContext, mapsApiKey, onProgress);

  var messages = [
    { role: "system", content: llm.buildAgentSystemPrompt() },
    { role: "user", content: buildAgentPrompt(input) },
  ];

  var maxSteps = 14;
  var step;
  for (step = 0; step < maxSteps; step += 1) {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "llm_thinking",
        message: "LLM 推理第 " + (step + 1) + " 轮",
      });
    }
    var response = await fetch(llmBaseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + llmApiKey,
      },
      body: JSON.stringify({
        model: llmModel,
        temperature: 0.2,
        messages: messages,
        tools: buildToolSpecs(),
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      var errorText = await response.text();
      throw new Error("LLM 请求失败(" + response.status + "): " + errorText);
    }

    var payload = await response.json();
    var assistantMessage = (((payload || {}).choices || [])[0] || {}).message;
    if (!assistantMessage) {
      throw new Error("LLM 响应缺失 message");
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      tool_calls: assistantMessage.tool_calls || [],
    });

    var toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    if (!toolCalls.length) {
      var finalText = assistantMessage.content || "";
      return {
        analysis: llm.parseAgentPlanJson(finalText),
        toolContext: toolContext,
      };
    }

    var idx;
    for (idx = 0; idx < toolCalls.length; idx += 1) {
      var toolCall = toolCalls[idx];
      if (typeof onProgress === "function") {
        onProgress({
          stage: "tool_call",
          message: "执行工具 " + (idx + 1) + "/" + toolCalls.length + "（第 " + (step + 1) + " 轮）",
        });
      }
      try {
        var toolResult = await executeToolCall(toolContext, toolCall, mapsApiKey);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      } catch (toolErr) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: toolErr.message }),
        });
      }
    }
  }

  throw new Error("工具调用轮次超限，未得到最终结果");
}

function buildValidationResult(analysis, toolContext, normalizedInput) {
  var placeList = normalizedInput.places || [];
  var excludedPlaces = [];
  var cityNotes = [];
  placeList.forEach(function (place) {
    var resolved = toolContext.geocodeByName[normalizeText(place.name)] ||
      toolContext.geocodeByName[String(place.name || "").trim().toLowerCase()];
    if (!resolved) {
      return;
    }
    // 只有「国家」明确冲突才排除；城市外来名/本地名差异（Copenhagen vs København）不再排除
    if (countryConflicts(place.declaredCountry, resolved.resolvedCountry)) {
      excludedPlaces.push({
        name: place.name,
        declaredCity: place.declaredCity || "",
        declaredCountry: place.declaredCountry || "",
        reason: "解析所在国家与声明国家不一致（" +
          (resolved.resolvedCountry || "未知") + " ≠ " + (place.declaredCountry || "未填") + "）",
        resolvedAddress: resolved.formattedAddress || "",
      });
      return;
    }
    if (cityNameDiffers(place.declaredCity, resolved.resolvedCity)) {
      cityNotes.push(
        place.name + "：声明城市「" + place.declaredCity + "」与解析城市「" +
        (resolved.resolvedCity || "") + "」名称不同（多为本地语言/别称，已保留在行程中）"
      );
    }
  });
  return {
    timeFeasibility: null,
    lodgingWarnings: [],
    warnings: cityNotes,
    excludedPlaces: excludedPlaces,
  };
}

function buildProgressReporter(reportProgress) {
  return function (progress) {
    if (typeof reportProgress !== "function") {
      return;
    }
    reportProgress(progress || {});
  };
}

function resolvePlaceDurationMin(place, fallbackMinutes) {
  var fallback = Number(fallbackMinutes) || 90;
  var candidate = Number(place && (place.suggestedDurationMin || place.durationMin));
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return fallback;
  }
  return Math.max(30, Math.floor(candidate));
}

function calcAverageTravelMinutesFromRoadbook(roadbook) {
  var samples = (Array.isArray(roadbook) ? roadbook : [])
    .map(function (item) {
      var travel = item && item.travelToNext ? item.travelToNext : null;
      return Number(travel && travel.durationMin);
    })
    .filter(function (value) {
      return Number.isFinite(value) && value > 0;
    });
  if (!samples.length) {
    return 35;
  }
  var sum = samples.reduce(function (acc, value) {
    return acc + value;
  }, 0);
  return Math.max(10, Math.round(sum / samples.length));
}

function estimateNaturalDaysAndSubset(orderedPlaces, requestedDays, averageTravelMin) {
  var list = Array.isArray(orderedPlaces) ? orderedPlaces : [];
  var reqDays = Number(requestedDays);
  if (!Number.isFinite(reqDays) || reqDays <= 0) {
    reqDays = 1;
  }
  reqDays = Math.floor(reqDays);
  var dayBudgetMin = 10 * 60;
  var hotelLegMin = 25;

  var visitTotal = list.reduce(function (acc, place) {
    return acc + resolvePlaceDurationMin(place, 90);
  }, 0);
  var fullTotal = visitTotal + Math.max(0, list.length - 1) * averageTravelMin + (list.length ? (2 * hotelLegMin) : 0);
  var naturalDays = Math.max(1, Math.ceil(fullTotal / dayBudgetMin));

  var compactBudget = reqDays * dayBudgetMin;
  var compactUsed = 0;
  var compactPlaces = [];
  var droppedPlaces = [];
  var i;
  for (i = 0; i < list.length; i += 1) {
    var place = list[i];
    var placeMinutes = resolvePlaceDurationMin(place, 90);
    var transitMinutes = compactPlaces.length ? averageTravelMin : hotelLegMin;
    var projected = compactUsed + placeMinutes + transitMinutes;
    if (compactPlaces.length === 0 || projected + hotelLegMin <= compactBudget) {
      compactPlaces.push(place);
      compactUsed = projected;
    } else {
      droppedPlaces.push(place);
    }
  }

  return {
    requestedDays: reqDays,
    naturalDays: naturalDays,
    compactPlaces: compactPlaces,
    droppedPlaces: droppedPlaces,
  };
}

function filterSpotlightsByOrder(placeSpotlights, keptOrderSet) {
  return (Array.isArray(placeSpotlights) ? placeSpotlights : []).filter(function (item) {
    return keptOrderSet.has(normalizeText(item && item.name));
  });
}

function filterRoadbookByOrder(roadbook, keptOrderSet) {
  var filtered = [];
  (Array.isArray(roadbook) ? roadbook : []).forEach(function (step, index) {
    var placeName = String(step && step.placeName || "");
    if (!keptOrderSet.has(normalizeText(placeName))) {
      return;
    }
    var nextTravel = step.travelToNext || null;
    var safeTravel = null;
    if (nextTravel && keptOrderSet.has(normalizeText(nextTravel.destination || ""))) {
      safeTravel = nextTravel;
    }
    filtered.push(Object.assign({}, step, {
      step: filtered.length + 1,
      travelToNext: safeTravel,
    }));
  });
  if (filtered.length) {
    filtered[filtered.length - 1] = Object.assign({}, filtered[filtered.length - 1], {
      travelToNext: null,
    });
  }
  return filtered;
}

function applyEnvKeyFallback(body) {
  // v1.2 公网化：前端仍可传 key（keep 模式），未传时回退到后端环境变量，便于公网部署
  var merged = Object.assign({}, body);
  if (!merged.llmBaseUrl && process.env.LLM_BASE_URL) {
    merged.llmBaseUrl = process.env.LLM_BASE_URL;
  }
  if (!merged.llmApiKey && process.env.LLM_API_KEY) {
    merged.llmApiKey = process.env.LLM_API_KEY;
  }
  if (!merged.llmModel && process.env.LLM_MODEL) {
    merged.llmModel = process.env.LLM_MODEL;
  }
  if (!merged.mapsApiKey && process.env.MAPS_API_KEY) {
    merged.mapsApiKey = process.env.MAPS_API_KEY;
  }
  return merged;
}

async function buildAgentPlanPayload(rawBody, reportProgress) {
  var pushProgress = buildProgressReporter(reportProgress);
  pushProgress({ percent: 5, stage: "prepare", message: "校验输入参数" });

  var body = applyEnvKeyFallback(rawBody || {});
  var strategyTemplate = agentPlanner.getStrategyTemplate(body.strategy);

  var required = ["llmBaseUrl", "llmApiKey", "llmModel", "mapsApiKey"];
  var missing = required.filter(function (key) {
    return body[key] === undefined || body[key] === null || body[key] === "";
  });
  if (missing.length) {
    var err = new Error("缺少必填字段");
    err.statusCode = 400;
    err.payload = { error: "缺少必填字段", missing: missing };
    throw err;
  }

  var normalized = normalizeTripInput(body);
  if (!normalized.places.length) {
    var placesErr = new Error("places 不能为空");
    placesErr.statusCode = 400;
    placesErr.payload = { error: "places 不能为空" };
    throw placesErr;
  }

  pushProgress({ percent: 12, stage: "prepare", message: "整理目的地与住宿信息" });
  var agentRun = await runToolCallingAgent(
    {
      country: normalized.country,
      city: normalized.city,
      totalDays: normalized.totalDays,
      destinations: normalized.destinations,
      lodging: normalized.lodging,
      places: normalized.places,
      llmBaseUrl: body.llmBaseUrl,
      llmApiKey: body.llmApiKey,
      llmModel: body.llmModel,
      mapsApiKey: body.mapsApiKey,
    },
    function (stepProgress) {
      var stage = stepProgress.stage || "";
      if (stage === "pre_geocode") {
        pushProgress({
          percent: 25,
          stage: "geocode",
          message: stepProgress.message || "正在解析景点和酒店坐标",
        });
      } else if (stage === "llm_thinking") {
        pushProgress({
          percent: 55,
          stage: "llm",
          message: stepProgress.message || "LLM 正在规划行程",
        });
      } else if (stage === "tool_call") {
        pushProgress({
          percent: 70,
          stage: "tools",
          message: stepProgress.message || "正在调用地图工具",
        });
      }
    }
  );
  var analysis = agentRun.analysis;

  pushProgress({ percent: 82, stage: "validate", message: "执行本地可行性与归属校验" });
  var localValidation = buildValidationResult(analysis, agentRun.toolContext, normalized);
  var excludedSet = new Set(
    localValidation.excludedPlaces.map(function (item) {
      return normalizeText(item.name);
    })
  );

  var recommendedOrder = (Array.isArray(analysis.recommendedOrder) ? analysis.recommendedOrder : []).filter(function (name) {
    return !excludedSet.has(normalizeText(name));
  });
  if (!recommendedOrder.length) {
    recommendedOrder = normalized.places
      .map(function (item) {
        return item.name;
      })
      .filter(function (name) {
        return !excludedSet.has(normalizeText(name));
      });
  }

  // v1.2 策略引擎：后端打分器在 LLM 建议顺序与策略贪心候选之间择优
  var placeMetaMap = buildPlaceMetaMap(normalized.places, analysis.places, agentRun.toolContext);
  var travelLookup = makeTravelLookup(agentRun.toolContext);
  var candidateOrders = [{ source: "llm", order: recommendedOrder }];
  var greedyOrder = agentPlanner.buildGreedyOrder(recommendedOrder, placeMetaMap, travelLookup, strategyTemplate.id);
  if (greedyOrder.length) {
    candidateOrders.push({ source: "greedy-" + strategyTemplate.id, order: greedyOrder });
  }
  var chosenRoute = agentPlanner.chooseBestOrder(candidateOrders, placeMetaMap, travelLookup, strategyTemplate.id);
  if (chosenRoute && chosenRoute.order.length) {
    recommendedOrder = chosenRoute.order;
  }

  var enrichedPlaces = agentPlanner.applyAgentInsights(
    normalized.places,
    analysis.places,
    recommendedOrder,
    analysis.placeSpotlights
  ).filter(function (item) {
    return !excludedSet.has(normalizeText(item.name));
  });

  var averageTravelMin = calcAverageTravelMinutesFromRoadbook(analysis.roadbook);
  var estimated = estimateNaturalDaysAndSubset(enrichedPlaces, normalized.totalDays, averageTravelMin);
  var effectivePlaces = estimated.naturalDays > estimated.requestedDays
    ? estimated.compactPlaces
    : enrichedPlaces.slice();
  var effectiveOrder = effectivePlaces.map(function (item) {
    return item.name;
  });
  var effectiveOrderSet = new Set(effectiveOrder.map(function (name) {
    return normalizeText(name);
  }));
  var effectiveDays = estimated.naturalDays <= estimated.requestedDays
    ? estimated.naturalDays
    : estimated.requestedDays;

  var planData = agentPlanner.buildPlanDataFromOrder(
    effectiveOrder,
    effectivePlaces,
    normalized.city,
    effectiveDays
  );

  // v1.2 交通分段：对跨城相邻段调用 Google Directions transit 模式，输出可执行分段时长
  pushProgress({ percent: 88, stage: "transit", message: "解析跨城公共交通分段" });
  var transitBreakdown = await buildTransitBreakdowns(
    effectiveOrder,
    agentRun.toolContext,
    placeMetaMap,
    body.mapsApiKey,
    function (transitProgress) {
      pushProgress({ percent: 88, stage: "transit", message: transitProgress.message || "解析跨城公共交通" });
    }
  );
  var transitLookup = makeTransitLookup(transitBreakdown);

  var dailyPlans = agentPlanner.buildDailyPlansFromPlanData(planData, normalized.lodging, effectiveDays, {
    travelLookup: travelLookup,
    transitLookup: transitLookup,
  });
  var closureResult = agentPlanner.verifyHotelClosure(dailyPlans, normalized.lodging);
  var timeFeasibility = {
    feasible: estimated.naturalDays <= estimated.requestedDays,
    requestedDays: estimated.requestedDays,
    suggestedDays: estimated.naturalDays,
    reason: estimated.naturalDays > estimated.requestedDays
      ? ("按真实时长建议 " + estimated.naturalDays + " 天；已为你压缩到 " + estimated.requestedDays + " 天并删减部分景点")
      : (estimated.naturalDays < estimated.requestedDays
        ? ("按真实时长可压缩为 " + estimated.naturalDays + " 天（少于用户填写的 " + estimated.requestedDays + " 天）")
        : "按真实时长评估，用户填写天数基本合理"),
    overloadedDays: [],
  };

  var lodgingSummary = Object.assign(
    {
      hotelName: normalized.lodging && normalized.lodging.hotel ? normalized.lodging.hotel.name : "",
      formattedAddress: normalized.lodging && normalized.lodging.hotel ? normalized.lodging.hotel.resolvedAddress || normalized.lodging.hotel.address || "" : "",
      checkInDate: normalized.lodging && normalized.lodging.hotel ? normalized.lodging.hotel.checkInDate : "",
      checkOutDate: normalized.lodging && normalized.lodging.hotel ? normalized.lodging.hotel.checkOutDate : "",
      nights: null,
      note: normalized.lodging ? "全程固定酒店，每日往返" : "",
    },
    analysis.lodgingSummary || {}
  );

  var lodgingWarnings = [];
  if (!timeFeasibility.feasible) {
    lodgingWarnings.push("当前天数下已自动精简景点，若想全覆盖建议增加天数");
  }
  if (closureResult.warnings.length) {
    lodgingWarnings = lodgingWarnings.concat(closureResult.warnings);
  }

  var validation = {
    timeFeasibility: timeFeasibility,
    lodgingWarnings: lodgingWarnings,
    warnings: localValidation.warnings || [],
    excludedPlaces: localValidation.excludedPlaces,
    hotelClosure: {
      closed: closureResult.closed,
      openDays: closureResult.openDays,
    },
  };

  var autoAlternativeProposals = [];
  if (estimated.naturalDays > estimated.requestedDays) {
    autoAlternativeProposals.push({
      title: "方案 A：完整游玩",
      days: estimated.naturalDays,
      places: enrichedPlaces.map(function (item) { return item.name; }),
      summary: "保持全部景点，按真实时长建议拉长行程。",
    });
    autoAlternativeProposals.push({
      title: "方案 B：当前天数精简版",
      days: estimated.requestedDays,
      places: effectiveOrder,
      summary: "在用户天数内保留优先级更高且更顺路的景点。",
    });
  } else if (estimated.naturalDays < estimated.requestedDays) {
    autoAlternativeProposals.push({
      title: "效率方案：压缩天数",
      days: estimated.naturalDays,
      places: effectiveOrder,
      summary: "按真实路程和游览时长可在更少天数完成。",
    });
  }

  var effectiveMetrics = agentPlanner.computeRouteMetrics(effectiveOrder, placeMetaMap, travelLookup);
  var strategyExplanation = agentPlanner.buildStrategyExplanation(
    strategyTemplate.id,
    effectiveMetrics,
    chosenRoute ? chosenRoute.source : "llm"
  );
  var combinedRouteStrategy = analysis.routeStrategy
    ? (strategyExplanation + " " + analysis.routeStrategy)
    : strategyExplanation;

  pushProgress({ percent: 95, stage: "finalize", message: "整理路书与地图输出" });
  return {
    summary: analysis.summary || "",
    routeStrategy: combinedRouteStrategy,
    strategy: strategyTemplate.id,
    strategyLabel: strategyTemplate.label,
    routeMetrics: {
      totalTravelMin: effectiveMetrics.totalTravelMin,
      crossCityCount: effectiveMetrics.crossCityCount,
      backtrackCount: effectiveMetrics.backtrackCount,
    },
    transitBreakdown: transitBreakdown,
    placeSpotlights: filterSpotlightsByOrder(analysis.placeSpotlights, effectiveOrderSet),
    roadbook: filterRoadbookByOrder(analysis.roadbook, effectiveOrderSet),
    precautions: analysis.precautions || [],
    recommendedOrder: effectiveOrder,
    enrichedPlaces: effectivePlaces,
    planData: planData,
    destinations: normalized.destinations,
    lodgingSummary: lodgingSummary,
    dailyPlans: dailyPlans,
    validation: validation,
    alternativeProposals: (Array.isArray(analysis.alternativeProposals) ? analysis.alternativeProposals : []).concat(autoAlternativeProposals),
  };
}

async function handleAgentPlan(req, res) {
  try {
    var body = await readRequestBody(req);
    var payload = await buildAgentPlanPayload(body);
    sendJson(res, 200, payload);
  } catch (err) {
    if (err && err.statusCode && err.payload) {
      sendJson(res, err.statusCode, err.payload);
      return;
    }
    sendJson(res, 500, { error: err.message });
  }
}

function writeNdjson(res, payload) {
  res.write(JSON.stringify(payload) + "\n");
}

async function handleAgentPlanStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  try {
    var body = await readRequestBody(req);
    writeNdjson(res, {
      type: "progress",
      stage: "prepare",
      percent: 2,
      message: "已接收请求，准备规划",
    });
    var payload = await buildAgentPlanPayload(body, function (progress) {
      writeNdjson(res, {
        type: "progress",
        stage: progress.stage || "running",
        percent: Number(progress.percent) || null,
        message: progress.message || "",
      });
    });
    writeNdjson(res, {
      type: "progress",
      stage: "done",
      percent: 100,
      message: "路书生成完成",
    });
    writeNdjson(res, {
      type: "result",
      data: payload,
    });
  } catch (err) {
    if (err && err.statusCode && err.payload) {
      writeNdjson(res, {
        type: "error",
        statusCode: err.statusCode,
        error: err.payload.error || "请求失败",
        detail: err.payload,
      });
    } else {
      writeNdjson(res, {
        type: "error",
        statusCode: 500,
        error: err.message || "服务器内部错误",
      });
    }
  } finally {
    res.end();
  }
}

function applyCors(req, res) {
  var origin = req.headers.origin;
  if (!ALLOWED_ORIGINS.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (origin) {
    // 来源不在白名单：拒绝跨域，但不阻断同源静态资源
    sendJson(res, 403, { error: "来源不被允许" });
    return false;
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return false;
  }
  return true;
}

function getClientIp(req) {
  var forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function enforceRateLimit(req, res) {
  if (RATE_LIMIT_MAX <= 0) {
    return true;
  }
  var ip = getClientIp(req);
  var now = Date.now();
  var bucket = rateLimitBuckets.get(ip) || [];
  bucket = bucket.filter(function (timestamp) {
    return now - timestamp < RATE_LIMIT_WINDOW_MS;
  });
  if (bucket.length >= RATE_LIMIT_MAX) {
    res.setHeader("Retry-After", Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    sendJson(res, 429, { error: "请求过于频繁，请稍后再试" });
    return false;
  }
  bucket.push(now);
  rateLimitBuckets.set(ip, bucket);
  return true;
}

var server = http.createServer(function (req, res) {
  if (!applyCors(req, res)) {
    return;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/strategies") {
    sendJson(res, 200, { strategies: agentPlanner.listStrategyTemplates() });
    return;
  }
  if (req.method === "GET" && req.url.split("?")[0] === "/api/public-config") {
    // 非敏感默认值始终下发；密钥仅在 EXPOSE_KEYS_TO_FRONTEND=true 时下发（自测便利）
    sendJson(res, 200, {
      llmBaseUrl: process.env.LLM_BASE_URL || "",
      llmModel: process.env.LLM_MODEL || "",
      exposeKeys: EXPOSE_KEYS_TO_FRONTEND,
      llmApiKey: EXPOSE_KEYS_TO_FRONTEND ? (process.env.LLM_API_KEY || "") : "",
      mapsApiKey: EXPOSE_KEYS_TO_FRONTEND ? (process.env.MAPS_API_KEY || "") : "",
    });
    return;
  }
  if (req.method === "POST" && (req.url === "/api/agent/plan/stream" || req.url === "/api/agent/plan")) {
    if (!enforceRateLimit(req, res)) {
      return;
    }
    if (req.url === "/api/agent/plan/stream") {
      handleAgentPlanStream(req, res);
    } else {
      handleAgentPlan(req, res);
    }
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  sendJson(res, 405, { error: "Method Not Allowed" });
});

server.listen(PORT, HOST, function () {
  console.log("Server running at http://" + HOST + ":" + PORT);
});
