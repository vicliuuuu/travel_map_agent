"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var planner = require("./planner.js");
var llm = require("./llm.js");
var agentPlanner = require("./agent-planner.js");
var tracer = require("./tracer.js");
var verifier = require("./verifier.js");
var repair = require("./repair.js");
var stateMachine = require("./state-machine.js");

// v1.3 收敛控制参数（可用环境变量覆盖，便于回归调参）
var MAX_REPAIR_ROUNDS = Number(process.env.MAX_REPAIR_ROUNDS || repair.MAX_REPAIR_ROUNDS);
var NO_IMPROVE_LIMIT = Number(process.env.NO_IMPROVE_LIMIT || repair.NO_IMPROVE_LIMIT);
// 状态机可视化调试端点开关：内测默认开启，正式上线可设 ENABLE_DEBUG_TRACE=false
var ENABLE_DEBUG_TRACE = String(process.env.ENABLE_DEBUG_TRACE || "true").toLowerCase() !== "false";

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

// v1.3.1 天数冲突决策树（用户期望天数 r vs 系统估算天数 d）：
//   gap == 0      → 单一方案（r 天），无冲突；
//   gap  > 1      → 以 LLM 为主，单一方案（d 天），不再静默删点；
//   gap == 1      → 差 1 天视为不明显冲突，给两套完整方案让用户自选，不替用户拍板。
function decideDayPlan(estimated, enrichedPlaces) {
  var d = Number(estimated.naturalDays) || 1;
  var r = Number(estimated.requestedDays) || 1;
  var gap = Math.abs(d - r);
  var fullPlaces = Array.isArray(enrichedPlaces) ? enrichedPlaces.slice() : [];
  var nameOf = function (place) { return place.name; };
  var normName = agentPlanner.normalizeName;

  function variant(days, places, label) {
    return { days: days, places: places.slice(), order: places.map(nameOf), label: label || "" };
  }

  if (gap === 0) {
    return {
      dayConflict: { type: "none", d: d, r: r, message: "" },
      primary: Object.assign(variant(r, fullPlaces, ""), { dropped: [] }),
      secondary: null,
    };
  }

  if (gap > 1) {
    var msg = d > r
      ? ("按真实时长与路程，这些景点更适合安排 " + d + " 天（你填的 " + r + " 天会很赶）；已按 " + d + " 天规划，未删减景点。")
      : ("按真实时长与路程，" + d + " 天即可从容完成（少于你填的 " + r + " 天）；已按 " + d + " 天规划。");
    return {
      dayConflict: { type: "llm_primary", d: d, r: r, message: msg },
      primary: Object.assign(variant(d, fullPlaces, ""), { dropped: [] }),
      secondary: null,
    };
  }

  // gap === 1：两套完整方案
  var aPlaces;
  var aDropped;
  if (d > r) {
    // 需要更多天：方案A（用户 r 天）必然要删点
    aPlaces = Array.isArray(estimated.compactPlaces) ? estimated.compactPlaces.slice() : fullPlaces.slice();
    var keptSet = {};
    aPlaces.forEach(function (place) { keptSet[normName(place.name)] = true; });
    aDropped = fullPlaces
      .filter(function (place) { return !keptSet[normName(place.name)]; })
      .map(nameOf);
  } else {
    // 需要更少天：方案A（用户 r 天）保留全部景点，摊得更从容
    aPlaces = fullPlaces.slice();
    aDropped = [];
  }
  return {
    dayConflict: {
      type: "dual",
      d: d,
      r: r,
      message: "你填 " + r + " 天、系统估算约 " + d + " 天，仅差 1 天，已给出两套方案供你选择。",
    },
    primary: Object.assign(variant(r, aPlaces, "方案A · 你的 " + r + " 天"), { dropped: aDropped }),
    secondary: variant(d, fullPlaces, "方案B · 建议 " + d + " 天"),
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

// v1.3 修复上下文：为决策器/修复动作提供当前 planData 的城市、优先级与单日景点数查询
function buildRepairContext(ctx) {
  return {
    cityOf: function (name) {
      var meta = ctx.placeMetaMap[agentPlanner.normalizeName(name)] || {};
      return meta.city || "";
    },
    priorityOf: function (name) {
      var meta = ctx.placeMetaMap[agentPlanner.normalizeName(name)] || {};
      return meta.priority || "medium";
    },
    dayItemsCount: function (dayNumber) {
      var dayPlan = (Array.isArray(ctx.planData) ? ctx.planData : []).find(function (d) {
        return Number(d.day) === Number(dayNumber);
      });
      if (!dayPlan) {
        return null;
      }
      return (Array.isArray(dayPlan.items) ? dayPlan.items : []).filter(function (item) {
        return item && item.type === "visit";
      }).length;
    },
  };
}

function orderFromPlanData(planData) {
  var order = [];
  (Array.isArray(planData) ? planData : []).forEach(function (dayPlan) {
    (Array.isArray(dayPlan.items) ? dayPlan.items : []).forEach(function (item) {
      if (item && item.type === "visit" && item.title) {
        order.push(item.title);
      }
    });
  });
  return order;
}

// finalize / fallback 共用的输出组装：从最终 planData 重建顺序、指标与校验结论，保证一致性。
function assembleResult(ctx, options) {
  var opts = options || {};
  var isFallback = Boolean(opts.fallback);
  var analysis = ctx.analysis || {};
  var normalized = ctx.normalized;
  var strategyTemplate = ctx.strategyTemplate;
  var estimated = ctx.estimated;

  var finalOrder = orderFromPlanData(ctx.planData);
  var finalOrderSet = new Set(finalOrder.map(function (n) { return normalizeText(n); }));
  var finalPlaces = agentPlanner.sortByRecommendedOrder(
    (ctx.enrichedPlaces || []).filter(function (p) { return finalOrderSet.has(normalizeText(p.name)); }),
    finalOrder
  );

  var dailyPlans = ctx.dailyPlans && ctx.dailyPlans.length
    ? ctx.dailyPlans
    : agentPlanner.buildDailyPlansFromPlanData(ctx.planData, normalized.lodging, ctx.planData.length, {
        travelLookup: ctx.travelLookup,
        transitLookup: ctx.transitLookup,
      });
  var closureResult = agentPlanner.verifyHotelClosure(dailyPlans, normalized.lodging);

  var findings = (ctx.verifyResult && ctx.verifyResult.findings) || [];
  var overloadedDays = findings
    .filter(function (f) { return f.code === verifier.CODES.TIME_OVERLOAD; })
    .map(function (f) { return { day: f.evidence.day, estimatedMinutes: f.evidence.estimatedMinutes }; });

  var dayConflict = ctx.dayConflict || { type: "none", d: estimated.naturalDays, r: estimated.requestedDays, message: "" };
  var reasonBase = dayConflict.type !== "none" && dayConflict.message
    ? dayConflict.message
    : "按真实时长评估，天数安排合理。";
  var timeFeasibility = {
    feasible: overloadedDays.length === 0,
    requestedDays: estimated.requestedDays,
    suggestedDays: estimated.naturalDays,
    reason: ctx.repairRounds > 0 ? (reasonBase + " 已执行 " + ctx.repairRounds + " 轮自动修复。") : reasonBase,
    overloadedDays: overloadedDays,
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
    lodgingWarnings.push("当前天数下仍有单日超载，若想更从容建议增加天数");
  }
  if (closureResult.warnings.length) {
    lodgingWarnings = lodgingWarnings.concat(closureResult.warnings);
  }
  if (isFallback) {
    lodgingWarnings.push("已输出保底可执行方案，但仍有未完全满足项，详见校验结论。");
  }

  var excludedPlaces = ((ctx.localValidation && ctx.localValidation.excludedPlaces) || []).slice();
  (ctx.droppedByRepair || []).forEach(function (name) {
    excludedPlaces.push({
      name: name,
      declaredCity: "",
      declaredCountry: "",
      reason: "自动修复：为满足单日时长/可行性已删减该景点",
      resolvedAddress: "",
    });
  });
  (ctx.droppedByDayFit || []).forEach(function (name) {
    excludedPlaces.push({
      name: name,
      declaredCity: "",
      declaredCountry: "",
      reason: "为放进你的 " + dayConflict.r + " 天（方案A）已删减；方案B（" + dayConflict.d + " 天）保留此景点",
      resolvedAddress: "",
    });
  });

  var validation = {
    timeFeasibility: timeFeasibility,
    lodgingWarnings: lodgingWarnings,
    warnings: (ctx.localValidation && ctx.localValidation.warnings) || [],
    excludedPlaces: excludedPlaces,
    hotelClosure: {
      closed: closureResult.closed,
      openDays: closureResult.openDays,
    },
    findings: findings,
    repairSummary: {
      status: isFallback ? "fallback" : "converged",
      rounds: ctx.repairRounds,
      changeLogs: ctx.repairChangeLogs,
      unresolved: isFallback ? findings.map(function (f) { return f.code; }) : [],
      reason: isFallback ? ctx.fallbackReason : null,
    },
    traceId: ctx.tracer.traceId,
  };

  var effectiveMetrics = agentPlanner.computeRouteMetrics(finalOrder, ctx.placeMetaMap, ctx.travelLookup);
  var strategyExplanation = agentPlanner.buildStrategyExplanation(
    strategyTemplate.id,
    effectiveMetrics,
    ctx.chosenRoute ? ctx.chosenRoute.source : "llm"
  );
  var combinedRouteStrategy = analysis.routeStrategy
    ? (strategyExplanation + " " + analysis.routeStrategy)
    : strategyExplanation;

  // v1.3.1 第二方案（仅 gap==1 时构建）：结构完整、可与主方案上下堆叠展示
  var alternativePlan = null;
  if (ctx.secondarySpec) {
    var sec = ctx.secondarySpec;
    var secPlanData = agentPlanner.buildPlanDataFromOrder(sec.order, sec.places, normalized.city, sec.days);
    var secDaily = agentPlanner.buildDailyPlansFromPlanData(secPlanData, normalized.lodging, sec.days, {
      travelLookup: ctx.travelLookup,
      transitLookup: ctx.transitLookup,
    });
    var secMetrics = agentPlanner.computeRouteMetrics(sec.order, ctx.placeMetaMap, ctx.travelLookup);
    var secVerify = verifier.runVerifiers({
      planData: secPlanData,
      dailyPlans: secDaily,
      lodging: normalized.lodging,
      requestedDays: sec.days,
      cityOf: ctx.repairContext.cityOf,
    });
    alternativePlan = {
      label: sec.label,
      days: sec.days,
      recommendedOrder: sec.order,
      routeMetrics: {
        totalTravelMin: secMetrics.totalTravelMin,
        crossCityCount: secMetrics.crossCityCount,
        backtrackCount: secMetrics.backtrackCount,
      },
      dailyPlans: secDaily,
      findings: secVerify.findings,
    };
  }

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
    transitBreakdown: ctx.transitBreakdown,
    placeSpotlights: filterSpotlightsByOrder(analysis.placeSpotlights, finalOrderSet),
    roadbook: filterRoadbookByOrder(analysis.roadbook, finalOrderSet),
    precautions: analysis.precautions || [],
    recommendedOrder: finalOrder,
    enrichedPlaces: finalPlaces,
    planData: ctx.planData,
    destinations: normalized.destinations,
    lodgingSummary: lodgingSummary,
    dailyPlans: dailyPlans,
    validation: validation,
    planLabel: ctx.planLabel || "",
    dayConflict: dayConflict,
    alternativePlan: alternativePlan,
    alternativeProposals: [],
    traceId: ctx.tracer.traceId,
  };
}

// v1.3 显式状态机：collect_input（前置校验）→ build_context → plan_initial → verify → repair → finalize / fallback。
// 各态 action 只操作单一 context（ctx），状态流转由统一调度器 runStateMachine 驱动。
function buildPlanStates(ctx, pushProgress) {
  var body = ctx.body;
  var normalized = ctx.normalized;
  var strategyTemplate = ctx.strategyTemplate;

  return {
    build_context: {
      action: async function (context) {
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
              pushProgress({ percent: 25, stage: "geocode", message: stepProgress.message || "正在解析景点和酒店坐标" });
            } else if (stage === "llm_thinking") {
              pushProgress({ percent: 55, stage: "llm", message: stepProgress.message || "LLM 正在规划行程" });
            } else if (stage === "tool_call") {
              pushProgress({ percent: 70, stage: "tools", message: stepProgress.message || "正在调用地图工具" });
            }
          }
        );
        context.analysis = agentRun.analysis;
        context.toolContext = agentRun.toolContext;
        context.tracer.emit({
          stage: "build_context",
          eventType: "tool_call",
          status: "ok",
          payload: {
            tool: "geocode+directions",
            geocodeCount: (agentRun.toolContext.geocodeEntries || []).length,
            travelCacheCount: Object.keys(agentRun.toolContext.travelCache || {}).length,
          },
        });
        return { next: "plan_initial", status: "ok" };
      },
    },

    plan_initial: {
      action: async function (context) {
        var analysis = context.analysis;
        pushProgress({ percent: 82, stage: "validate", message: "执行本地可行性与归属校验" });
        var localValidation = buildValidationResult(analysis, context.toolContext, normalized);
        context.localValidation = localValidation;
        var excludedSet = new Set(localValidation.excludedPlaces.map(function (item) {
          return normalizeText(item.name);
        }));

        var recommendedOrder = (Array.isArray(analysis.recommendedOrder) ? analysis.recommendedOrder : []).filter(function (name) {
          return !excludedSet.has(normalizeText(name));
        });
        if (!recommendedOrder.length) {
          recommendedOrder = normalized.places
            .map(function (item) { return item.name; })
            .filter(function (name) { return !excludedSet.has(normalizeText(name)); });
        }

        // v1.2 策略引擎：后端打分器在 LLM 建议顺序与策略贪心候选之间择优
        var placeMetaMap = buildPlaceMetaMap(normalized.places, analysis.places, context.toolContext);
        var travelLookup = makeTravelLookup(context.toolContext);
        context.placeMetaMap = placeMetaMap;
        context.travelLookup = travelLookup;

        var candidateOrders = [{ source: "llm", order: recommendedOrder }];
        var greedyOrder = agentPlanner.buildGreedyOrder(recommendedOrder, placeMetaMap, travelLookup, strategyTemplate.id);
        if (greedyOrder.length) {
          candidateOrders.push({ source: "greedy-" + strategyTemplate.id, order: greedyOrder });
        }
        var chosenRoute = agentPlanner.chooseBestOrder(candidateOrders, placeMetaMap, travelLookup, strategyTemplate.id);
        if (chosenRoute && chosenRoute.order.length) {
          recommendedOrder = chosenRoute.order;
        }
        context.chosenRoute = chosenRoute;

        var enrichedPlaces = agentPlanner.applyAgentInsights(
          normalized.places,
          analysis.places,
          recommendedOrder,
          analysis.placeSpotlights
        ).filter(function (item) {
          return !excludedSet.has(normalizeText(item.name));
        });
        context.enrichedPlaces = enrichedPlaces;

        var averageTravelMin = calcAverageTravelMinutesFromRoadbook(analysis.roadbook);
        var estimated = estimateNaturalDaysAndSubset(enrichedPlaces, normalized.totalDays, averageTravelMin);
        context.estimated = estimated;

        // v1.3.1 天数冲突决策：决定主方案（进状态机做校验/修复）与可选的第二方案
        var dayPlan = decideDayPlan(estimated, enrichedPlaces);
        context.dayConflict = dayPlan.dayConflict;
        context.planLabel = dayPlan.primary.label;
        context.secondarySpec = dayPlan.secondary;
        context.droppedByDayFit = dayPlan.primary.dropped;

        var effectiveOrder = dayPlan.primary.order;
        context.planData = agentPlanner.buildPlanDataFromOrder(
          dayPlan.primary.order,
          dayPlan.primary.places,
          normalized.city,
          dayPlan.primary.days
        );

        // v1.2 交通分段：对跨城相邻段调用 Google Directions transit 模式，输出可执行分段时长
        pushProgress({ percent: 88, stage: "transit", message: "解析跨城公共交通分段" });
        context.transitBreakdown = await buildTransitBreakdowns(
          effectiveOrder,
          context.toolContext,
          placeMetaMap,
          body.mapsApiKey,
          function (transitProgress) {
            pushProgress({ percent: 88, stage: "transit", message: transitProgress.message || "解析跨城公共交通" });
          }
        );
        context.transitLookup = makeTransitLookup(context.transitBreakdown);

        return { next: "verify", status: "ok" };
      },
    },

    verify: {
      action: function (context) {
        context.dailyPlans = agentPlanner.buildDailyPlansFromPlanData(
          context.planData,
          normalized.lodging,
          context.planData.length,
          { travelLookup: context.travelLookup, transitLookup: context.transitLookup }
        );
        var vr = verifier.runVerifiers({
          planData: context.planData,
          dailyPlans: context.dailyPlans,
          lodging: normalized.lodging,
          requestedDays: context.estimated.requestedDays,
          cityOf: context.repairContext.cityOf,
        });
        context.verifyResult = vr;
        context.scoreHistory.push(vr.score);
        vr.findings.forEach(function (finding) {
          context.tracer.validation(finding);
        });

        if (vr.pass) {
          return { next: "finalize", status: "ok" };
        }
        var stop = repair.shouldStopRepair({
          round: context.repairRounds,
          maxRounds: MAX_REPAIR_ROUNDS,
          scoreHistory: context.scoreHistory,
          noImproveLimit: NO_IMPROVE_LIMIT,
        });
        if (stop.stop) {
          context.fallbackReason = stop.reason;
          return { next: "fallback", status: "warn" };
        }
        var choice = repair.chooseRepairAction(vr.findings, context.repairContext);
        if (!choice) {
          context.fallbackReason = "no_action";
          return { next: "fallback", status: "warn" };
        }
        context.pendingRepair = choice;
        return { next: "repair", status: "warn" };
      },
    },

    repair: {
      action: function (context) {
        var beforeScore = context.verifyResult.score;
        var applied = repair.applyRepair(
          context.planData,
          context.pendingRepair.action,
          context.pendingRepair.failure,
          context.repairContext
        );
        context.planData = applied.planData;
        context.repairChangeLogs.push(applied.changeLog);
        if (Array.isArray(applied.changeLog.removed)) {
          applied.changeLog.removed.forEach(function (name) {
            context.droppedByRepair.push(name);
          });
        }
        context.repairRounds += 1;
        context.tracer.repairAction({
          action: applied.changeLog.action,
          reason: context.pendingRepair.failure.code,
          beforeScore: beforeScore,
          afterScore: null,
          diff: applied.changeLog,
        });
        pushProgress({
          percent: 90,
          stage: "repair",
          message: "自动修复第 " + context.repairRounds + " 轮：" + (applied.changeLog.note || applied.changeLog.action),
        });
        return { next: "verify", status: "ok" };
      },
    },

    finalize: {
      action: function (context) {
        pushProgress({ percent: 95, stage: "finalize", message: "整理路书与地图输出" });
        context.result = assembleResult(context, { fallback: false });
        return { status: "ok" };
      },
    },

    fallback: {
      action: function (context) {
        context.tracer.fallback({
          reason: context.fallbackReason,
          unresolved: ((context.verifyResult && context.verifyResult.findings) || []).map(function (f) { return f.code; }),
        });
        pushProgress({ percent: 95, stage: "finalize", message: "输出保底可执行方案" });
        context.result = assembleResult(context, { fallback: true });
        return { status: "ok" };
      },
    },
  };
}

async function buildAgentPlanPayload(rawBody, reportProgress) {
  var pushProgress = buildProgressReporter(reportProgress);
  pushProgress({ percent: 5, stage: "prepare", message: "校验输入参数" });

  var body = applyEnvKeyFallback(rawBody || {});
  var strategyTemplate = agentPlanner.getStrategyTemplate(body.strategy);

  // collect_input（前置请求校验）：缺参/空景点仍返回 400，属 API 契约，不进入状态机兜底
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

  var requestTracer = tracer.createTracer();
  var ctx = {
    body: body,
    normalized: normalized,
    strategyTemplate: strategyTemplate,
    tracer: requestTracer,
    scoreHistory: [],
    repairRounds: 0,
    repairChangeLogs: [],
    droppedByRepair: [],
    planData: [],
    dailyPlans: [],
    verifyResult: null,
    fallbackReason: null,
    result: null,
  };
  ctx.repairContext = buildRepairContext(ctx);

  var states = buildPlanStates(ctx, pushProgress);
  try {
    await stateMachine.runStateMachine({
      states: states,
      context: ctx,
      start: "build_context",
      terminals: ["finalize", "fallback"],
      tracer: requestTracer,
      maxTransitions: 40,
    });
  } finally {
    // 无论收敛/兜底/异常，都记录 trace 供 /api/debug/last-trace 复盘
    tracer.recordTrace(requestTracer);
  }

  return ctx.result;
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
  // v1.3 状态机可视化调试端点：返回最近一次规划的完整 trace（仅内测环境开启）
  if (req.method === "GET" && req.url.split("?")[0] === "/api/debug/last-trace") {
    if (!ENABLE_DEBUG_TRACE) {
      sendJson(res, 404, { error: "调试端点未启用" });
      return;
    }
    var lastTrace = tracer.getLastTrace();
    if (!lastTrace) {
      sendJson(res, 404, { error: "暂无 trace 记录" });
      return;
    }
    sendJson(res, 200, lastTrace);
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

if (require.main === module) {
  server.listen(PORT, HOST, function () {
    console.log("Server running at http://" + HOST + ":" + PORT);
  });
}

module.exports = {
  decideDayPlan: decideDayPlan,
  buildAgentPlanPayload: buildAgentPlanPayload,
};
