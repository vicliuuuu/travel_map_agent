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
var tools = require("./tools.js");
var replan = require("./replan.js");

// v1.3 收敛控制参数（可用环境变量覆盖，便于回归调参）
var MAX_REPAIR_ROUNDS = Number(process.env.MAX_REPAIR_ROUNDS || repair.MAX_REPAIR_ROUNDS);
var NO_IMPROVE_LIMIT = Number(process.env.NO_IMPROVE_LIMIT || repair.NO_IMPROVE_LIMIT);
// v1.4 候选集合上限（防组合爆炸，可用环境变量覆盖便于调参）
var CANDIDATE_LIMIT = Number(process.env.CANDIDATE_LIMIT || 20);
// v1.5 可插拔工具开关（默认开启；opening_hours/weather 需 Google API 权限，缺失/失败时自动降级标注 unverified，不中断主流程）
var OPENING_HOURS_ENABLED = String(process.env.OPENING_HOURS_ENABLED || "true").toLowerCase() !== "false";
// 天气默认关闭：当前流程未采集实际出行日期，预报只能取"最近一天"，对未来行程无意义（鸡肋）。
// 需要时设 WEATHER_ENABLED=true，且仅当填写了入住日期（据此推导每天日期）才会真正查询。
var WEATHER_ENABLED = String(process.env.WEATHER_ENABLED || "false").toLowerCase() === "true";
// 拥堵默认采用内置高峰时段启发式（无需额外 API），也可后续接入 Directions 实时路况 provider
var CONGESTION_ENABLED = String(process.env.CONGESTION_ENABLED || "true").toLowerCase() !== "false";
// v1.5.2 外部事实工具（opening_hours/weather）并发拉取上限：串行改并发以压缩延迟，同时限流防撞配额（默认 5）
var TOOL_FETCH_CONCURRENCY = Math.max(1, Number(process.env.TOOL_FETCH_CONCURRENCY) || 5);
// v1.5.2 营业时间查询范围：all=全部景点；high=仅高优先级景点（省调用/省钱，代价是低优景点闭馆仅靠常识兜底）。默认 all。
var OPENING_HOURS_SCOPE = String(process.env.OPENING_HOURS_SCOPE || "all").toLowerCase() === "high" ? "high" : "all";
// v1.5 新增校验开关与阈值（体力/往返为纯计算，默认开启且为 warn 级，不阻断收敛）
var PHYSICAL_CHECK_ENABLED = String(process.env.PHYSICAL_CHECK_ENABLED || "true").toLowerCase() !== "false";
var HOTEL_RETURN_CHECK_ENABLED = String(process.env.HOTEL_RETURN_CHECK_ENABLED || "true").toLowerCase() !== "false";
var DAY_START_MIN = Number(process.env.DAY_START_MIN || verifier.DEFAULT_DAY_START_MIN);
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
    // v1.5 工具层缓存：注册表共享幂等缓存 + 外部事实结果
    toolCache: {},
    openingHoursByPlace: {},
    weatherByCity: {},
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

function normalizeHotelEntry(hotel) {
  if (!hotel) {
    return null;
  }
  var name = String(hotel.name || "").trim();
  var address = String(hotel.address || "").trim();
  if (!name && !address) {
    return null;
  }
  return {
    name: name,
    address: address,
    checkInDate: String(hotel.checkInDate || "").trim(),
    checkOutDate: String(hotel.checkOutDate || "").trim(),
  };
}

// v1.6 多酒店：优先解析 lodging.hotels 数组（mode:multi），兼容旧的单 lodging.hotel（mode:single）。
// 保留 lodging.hotel 作为「主酒店」指针，兼容仍读取 lodging.hotel 的存量代码。
function buildDefaultLodging(lodging) {
  if (!lodging) {
    return null;
  }
  var rawHotels = [];
  if (Array.isArray(lodging.hotels) && lodging.hotels.length) {
    rawHotels = lodging.hotels;
  } else if (lodging.hotel) {
    rawHotels = [lodging.hotel];
  }
  var hotels = rawHotels.map(normalizeHotelEntry).filter(Boolean);
  if (!hotels.length) {
    return null;
  }
  return {
    mode: hotels.length > 1 ? "multi" : "single",
    hotel: hotels[0],
    hotels: hotels,
  };
}

function splitLodgingFromPlaces(flatPlaces, fallbackLodging) {
  var places = Array.isArray(flatPlaces) ? flatPlaces : [];
  var lodging = fallbackLodging || null;
  var filtered = [];
  places.forEach(function (place) {
    if (place.isHotel) {
      // v1.6：酒店已改为独立区块传入（lodging.hotels）。此处仅为兼容旧的「景点行标记为酒店」输入，
      // 当 lodging 尚未由酒店区块构建时，才把该行降级为单酒店锚点。
      if (!lodging) {
        var legacyHotel = {
          name: String(place.name || "酒店").trim(),
          address: String(place.addressExtra || place.address || "").trim(),
          checkInDate: "",
          checkOutDate: "",
        };
        lodging = {
          mode: "single",
          hotel: legacyHotel,
          hotels: [legacyHotel],
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
  // #2：用户级「每个景点游玩时长」，作为无显式时长景点的兜底（clamp 30~480，非法则不启用兜底）。
  var visitMinutesRaw = Number(body.visitMinutes);
  var visitMinutes = Number.isFinite(visitMinutesRaw) && visitMinutesRaw > 0
    ? Math.max(30, Math.min(480, Math.floor(visitMinutesRaw)))
    : null;
  return {
    destinations: destinations,
    places: splitResult.places,
    lodging: splitResult.lodging,
    totalDays: Math.floor(manualDays),
    visitMinutes: visitMinutes,
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
  // v1.6 多酒店：逐个预解析酒店坐标（兼容单酒店）。
  var lodgingInput = toolContext.input.lodging || null;
  var hotels = lodgingInput && Array.isArray(lodgingInput.hotels) && lodgingInput.hotels.length
    ? lodgingInput.hotels
    : (lodgingInput && lodgingInput.hotel ? [lodgingInput.hotel] : []);
  var hi;
  for (hi = 0; hi < hotels.length; hi += 1) {
    var hotel = hotels[hi];
    if (!hotel || (!hotel.name && !hotel.address)) {
      continue;
    }
    if (typeof onProgress === "function") {
      onProgress({
        stage: "pre_geocode",
        message: hotels.length > 1 ? ("预解析酒店位置（" + (hi + 1) + "/" + hotels.length + "）") : "预解析酒店位置",
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
      // 保持与景点预解析一致的容错：单个酒店解析失败不阻断主流程，交由后续校验/展示处理。
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

// v1.5 opening_hours provider（doc §3.1 provider: google_places）：Find Place → Place Details 取 opening_hours。
// 默认关闭（OPENING_HOURS_ENABLED=false），开启后需 Places API 权限；解析失败/无数据时抛出标准错误交由注册表降级。
function buildGooglePlacesOpeningHoursProvider(mapsApiKey, toolContext) {
  return async function fetchOpeningHours(args) {
    var placeName = String(args && args.placeName || "").trim();
    if (!placeName) {
      var argErr = new Error("opening_hours 缺少 placeName");
      argErr.code = "INVALID_ARGS";
      throw argErr;
    }
    var geo = toolContext.geocodeByName[placeName.toLowerCase()] || null;

    // findplacefromtext 对「中文泛称/无上下文」的输入极易 ZERO_RESULTS（如"市政厅""利姆港"）。
    // 策略：① 名称 + 已解析城市/国家消歧 + circle locationbias；② 若仍未命中，用地理编码规范地址兜底。
    async function findPlaceId(inputText) {
      var text = String(inputText || "").trim();
      if (!text) {
        return null;
      }
      var url = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=" +
        encodeURIComponent(text) + "&inputtype=textquery&fields=place_id" +
        (geo ? "&locationbias=" + encodeURIComponent("circle:5000@" + geo.lat + "," + geo.lng) : "") +
        "&key=" + encodeURIComponent(mapsApiKey);
      var r = await fetch(url);
      var d = await r.json();
      if (d.status === "OK" && Array.isArray(d.candidates) && d.candidates[0]) {
        return d.candidates[0].place_id;
      }
      if (d.status === "ZERO_RESULTS") {
        return null;
      }
      // 非 ZERO_RESULTS（如 REQUEST_DENIED/OVER_QUERY_LIMIT）属真错误，不吞：抛给注册表按 PROVIDER_ERROR 降级。
      var err = new Error("opening_hours findplace 失败: " + placeName + " (" + d.status + ")");
      err.code = "PROVIDER_ERROR";
      throw err;
    }

    var primaryQuery = [placeName, geo && geo.resolvedCity, geo && geo.resolvedCountry]
      .filter(Boolean)
      .join(" ");
    var placeId = await findPlaceId(primaryQuery);
    if (!placeId && geo && geo.formattedAddress) {
      placeId = await findPlaceId(geo.formattedAddress);
    }
    if (!placeId) {
      var notFound = new Error("opening_hours 未找到地点: " + placeName);
      notFound.code = "NOT_FOUND";
      throw notFound;
    }
    var detailUrl = "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
      encodeURIComponent(placeId) + "&fields=opening_hours&key=" + encodeURIComponent(mapsApiKey);
    var detailRes = await fetch(detailUrl);
    var detailData = await detailRes.json();
    if (detailData.status !== "OK" || !detailData.result || !detailData.result.opening_hours) {
      var noHours = new Error("opening_hours 无营业时间数据: " + placeName);
      noHours.code = "NOT_FOUND";
      throw noHours;
    }
    // periods[].close.time 形如 "1800"；取当日日期对应星期几。若缺失则由注册表降级。
    var date = args && args.date ? new Date(args.date + "T00:00:00Z") : new Date();
    var weekday = date.getUTCDay();
    var periods = Array.isArray(detailData.result.opening_hours.periods) ? detailData.result.opening_hours.periods : [];
    var todays = periods.find(function (p) { return p && p.open && Number(p.open.day) === weekday; });
    if (!todays || !todays.open || !todays.close) {
      var noToday = new Error("opening_hours 当日无开放时段: " + placeName);
      noToday.code = "NOT_FOUND";
      throw noToday;
    }
    function toClock(hhmm) {
      var s = String(hhmm || "").padStart(4, "0");
      return s.slice(0, 2) + ":" + s.slice(2, 4);
    }
    return {
      placeName: placeName,
      open: toClock(todays.open.time),
      close: toClock(todays.close.time),
    };
  };
}

// v1.5 weather provider（Google Maps Platform Weather API）：按经纬度取每日预报，抽取降水/温度风险。
// 默认开启；地区不覆盖/无权限/解析失败时抛出标准错误，交由注册表降级标注 unverified（不进 precautions）。
function buildGoogleWeatherProvider(mapsApiKey) {
  return async function fetchWeather(args) {
    var lat = Number(args && args.lat);
    var lng = Number(args && args.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      var argErr = new Error("weather 缺少经纬度");
      argErr.code = "INVALID_ARGS";
      throw argErr;
    }
    var url = "https://weather.googleapis.com/v1/forecast/days:lookup?key=" + encodeURIComponent(mapsApiKey) +
      "&location.latitude=" + encodeURIComponent(lat) +
      "&location.longitude=" + encodeURIComponent(lng) + "&days=10";
    var res = await fetch(url);
    var data = await res.json();
    if (!res.ok || !data || !Array.isArray(data.forecastDays) || !data.forecastDays.length) {
      var notFound = new Error("weather 无预报数据（可能地区不覆盖）: " + JSON.stringify((data && data.error) || {}));
      notFound.code = res.status === 403 ? "PROVIDER_ERROR" : "NOT_FOUND";
      throw notFound;
    }
    function ymd(disp) {
      if (!disp) { return ""; }
      var mm = String(disp.month || "").padStart(2, "0");
      var dd = String(disp.day || "").padStart(2, "0");
      return disp.year + "-" + mm + "-" + dd;
    }
    var target = String(args && args.date || "");
    var day = data.forecastDays.find(function (d) { return ymd(d.displayDate) === target; }) || data.forecastDays[0];
    var daytime = day.daytimeForecast || {};
    var condText = (((daytime.weatherCondition || {}).description || {}).text) || "";
    var precipPct = Number(((daytime.precipitation || {}).probability || {}).percent);
    var maxTempC = Number((day.maxTemperature || {}).degrees);
    var minTempC = Number((day.minTemperature || {}).degrees);
    var risk = "";
    if (Number.isFinite(precipPct) && precipPct >= 60) {
      risk = "降水概率高";
    }
    if (Number.isFinite(maxTempC) && maxTempC >= 35) {
      risk = risk ? (risk + "、高温") : "高温";
    }
    if (Number.isFinite(minTempC) && minTempC <= -5) {
      risk = risk ? (risk + "、严寒") : "严寒";
    }
    var parts = [];
    if (condText) { parts.push(condText); }
    if (Number.isFinite(maxTempC)) { parts.push("最高约 " + Math.round(maxTempC) + "℃"); }
    if (Number.isFinite(precipPct)) { parts.push("降水概率 " + Math.round(precipPct) + "%"); }
    return {
      date: target,
      condition: condText,
      maxTempC: Number.isFinite(maxTempC) ? Math.round(maxTempC) : null,
      precipPct: Number.isFinite(precipPct) ? Math.round(precipPct) : null,
      risk: risk,
      summary: parts.join("，"),
    };
  };
}

// v1.5 构建工具注册表：注册可插拔外部事实工具（opening_hours/weather/congestion），默认全部启用。
// opening_hours/weather 走 Google API（失败自动降级）；congestion 默认走内置高峰启发式（无需额外 API）。
// tracer 注入后自动埋点 tool_call/fact_source/tool_degrade。
function buildToolRegistry(toolContext, tracerRef, mapsApiKey) {
  var registry = tools.createToolRegistry({
    tracer: tracerRef || null,
    cache: toolContext.toolCache,
  });
  registry.register(tools.buildOpeningHoursTool({
    enabled: OPENING_HOURS_ENABLED && Boolean(mapsApiKey),
    source: "google_places",
    // opening_hours 单次 invoke 内含 findplace + details 两跳，4s 对两跳偏紧易误判超时降级，放宽到 9s。
    timeoutMs: Number(process.env.OPENING_HOURS_TIMEOUT_MS) || 9000,
    fetch: buildGooglePlacesOpeningHoursProvider(mapsApiKey, toolContext),
  }));
  registry.register(tools.buildWeatherTool({
    enabled: WEATHER_ENABLED && Boolean(mapsApiKey),
    source: "google_weather",
    timeoutMs: Number(process.env.WEATHER_TIMEOUT_MS) || 6000,
    fetch: buildGoogleWeatherProvider(mapsApiKey),
  }));
  registry.register(tools.buildCongestionTool({
    enabled: CONGESTION_ENABLED,
    source: "peak_hour_heuristic",
    // 不传 fetch：使用内置高峰时段启发式（拥堵修正在到达时刻推算中直接应用，见 v15Checks.congestion）
  }));
  return registry;
}

// v1.5 景点 → 实际游玩日期映射（供 opening_hours/weather 按当天查询，修复"按今天查"的问题）。
// 有界并发映射：保序返回 fn(item, index) 的结果，最多同时 limit 个在飞（压延迟 + 限流防撞配额）。
// fn 抛出的异常不吞：直接拒绝整个 Promise，交由调用方处理（遵循「无静默失败」）。
async function mapWithConcurrency(items, limit, fn) {
  var list = Array.isArray(items) ? items : [];
  var max = Math.max(1, Number(limit) || 1);
  var results = new Array(list.length);
  var cursor = 0;
  async function worker() {
    while (true) {
      var index = cursor;
      cursor += 1;
      if (index >= list.length) {
        return;
      }
      results[index] = await fn(list[index], index);
    }
  }
  var workers = [];
  var w;
  for (w = 0; w < Math.min(max, list.length); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// #2 修复：用户级「每个景点游玩时长」(visitMinutes) 作为缺省时长兜底生效。
// 仅对没有显式时长（LLM suggestedDurationMin / 既有 durationMin）的景点回填，避免覆盖模型给出的更精确建议。
function applyDefaultVisitDuration(places, fallbackMinutes) {
  var fallback = Number(fallbackMinutes);
  if (!Number.isFinite(fallback) || fallback <= 0) {
    return;
  }
  (Array.isArray(places) ? places : []).forEach(function (place) {
    if (!place) {
      return;
    }
    var explicit = Number(place.suggestedDurationMin || place.durationMin);
    if (!Number.isFinite(explicit) || explicit <= 0) {
      place.durationMin = Math.max(30, Math.min(480, Math.floor(fallback)));
    }
  });
}

function buildPlaceDateMap(planData, lodging) {
  var map = {};
  var plan = Array.isArray(planData) ? planData : [];
  // v1.6 多酒店：日期改由 buildDayHotelMap 统一推算（多酒店取最早入住日为行程起点），
  // 保证营业时间/天气按真实游玩日期查询。
  var dayMap = agentPlanner.buildDayHotelMap(lodging, plan.length || 1);
  plan.forEach(function (dayPlan, index) {
    var date = (dayMap.days[index] && dayMap.days[index].date) || "";
    (Array.isArray(dayPlan.items) ? dayPlan.items : []).forEach(function (item) {
      if (item && item.type === "visit" && item.title) {
        map[agentPlanner.normalizeName(item.title)] = { date: date, day: Number(dayPlan.day) || (index + 1) };
      }
    });
  });
  return map;
}

// v1.5 按天拉取天气，产出可读的注意事项（接入 precautions）。每个（城市/首景点, 日期）一次，命中缓存。
async function fetchWeatherNotes(planData, placeDateMap, registry, toolContext, onProgress, concurrency) {
  if (!registry || !registry.isEnabled("weather")) {
    return [];
  }
  var plan = Array.isArray(planData) ? planData : [];
  // 每天取首个可定位景点作为查询锚点，跳过空天或无地理编码的天。
  var targets = [];
  plan.forEach(function (dayPlan, i) {
    var visits = (Array.isArray(dayPlan.items) ? dayPlan.items : []).filter(function (it) {
      return it && it.type === "visit" && it.title;
    });
    if (!visits.length) {
      return;
    }
    var firstName = visits[0].title;
    var geo = toolContext.geocodeByName[String(firstName).trim().toLowerCase()];
    if (!geo) {
      return;
    }
    var meta = placeDateMap[agentPlanner.normalizeName(firstName)] || {};
    // 无实际出行日期（未填入住日期）时，天气预报只会取"最近一天"，对未来行程无意义 → 跳过，避免误导。
    if (!meta.date) {
      return;
    }
    targets.push({ dayLabel: dayPlan.day || i + 1, firstName: firstName, geo: geo, date: meta.date });
  });

  var total = targets.length;
  var done = 0;
  // 并发拉取（保序），压缩「按天串行」带来的累计延迟。
  var results = await mapWithConcurrency(targets, concurrency, async function (t) {
    var res = await registry.invoke("weather", {
      placeName: t.firstName,
      city: t.geo.resolvedCity || "",
      date: t.date,
      lat: t.geo.lat,
      lng: t.geo.lng,
    });
    done += 1;
    if (typeof onProgress === "function") {
      onProgress({ stage: "weather", message: "查询天气 " + done + "/" + total });
    }
    // 无论有无风险都展示当天天气（好天气也要能看到"用了 Weather API"）；有风险则追加"，注意X"。
    if (res.ok && res.data && res.data.summary) {
      var head = "第 " + t.dayLabel + " 天（" + t.date + "）" +
        (t.geo.resolvedCity ? ("・" + t.geo.resolvedCity) : "") + "：" + res.data.summary;
      return res.data.risk ? (head + "，注意" + res.data.risk + "。") : (head + "。");
    }
    return null;
  });
  return results.filter(Boolean);
}

// v1.5 拉取当前顺序下各景点营业时间，构建 openingHoursByPlace（含 verifyState），供闭馆风险校验消费。
// 工具未启用/降级时返回空表或标注 unverified，主流程不中断（doc §8.3）。
async function fetchOpeningHoursForOrder(order, registry, toolContext, placeDateMap, onProgress, options) {
  var result = {};
  if (!registry || !registry.isEnabled("opening_hours")) {
    return result;
  }
  var opts = options || {};
  var dateMap = placeDateMap || {};
  var names = (Array.isArray(order) ? order : []).filter(Boolean);

  // #1 可选范围收窄：scope=high 时仅查高优先级景点，省调用/省钱（低优景点闭馆退化为常识兜底）。
  if (opts.scope === "high" && opts.placeMetaMap) {
    var filtered = names.filter(function (name) {
      var meta = opts.placeMetaMap[agentPlanner.normalizeName(name)] || {};
      return String(meta.priority || "").toLowerCase() === "high";
    });
    // 全都不是高优先级时不至于「一个都不查」，回退到全量，避免闭馆校验完全失明。
    if (filtered.length) {
      names = filtered;
    }
  }

  var total = names.length;
  var done = 0;
  var entries = await mapWithConcurrency(names, opts.concurrency, async function (name) {
    var meta = dateMap[agentPlanner.normalizeName(name)] || {};
    var res = await registry.invoke("opening_hours", { placeName: name, date: meta.date || "" });
    done += 1;
    if (typeof onProgress === "function") {
      onProgress({ stage: "opening_hours", message: "查询营业时间 " + done + "/" + total });
    }
    if (res.ok && res.data) {
      return { key: agentPlanner.normalizeName(name), value: {
        open: res.data.open,
        close: res.data.close,
        verifyState: res.data.verifyState || "verified",
        source: res.data.source,
      } };
    }
    if (res.degraded) {
      // 降级：标注 unverified，闭馆校验据此不判硬失败（仅 warn）。
      return { key: agentPlanner.normalizeName(name), value: {
        open: null,
        close: null,
        verifyState: "unverified",
        source: res.tool,
      } };
    }
    return null;
  });
  entries.forEach(function (entry) {
    if (entry) {
      result[entry.key] = entry.value;
    }
  });
  toolContext.openingHoursByPlace = result;
  return result;
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
  placeList.forEach(function (place) {
    var resolved = toolContext.geocodeByName[normalizeText(place.name)] ||
      toolContext.geocodeByName[String(place.name || "").trim().toLowerCase()];
    if (!resolved) {
      return;
    }
    // 只有「国家」明确冲突才排除；城市外来名/本地名差异（Copenhagen vs København）不再排除，
    // 也不再产生「待核实」提醒（多为本地语言/别称，属噪音，已保留在行程中）。
    if (countryConflicts(place.declaredCountry, resolved.resolvedCountry)) {
      excludedPlaces.push({
        name: place.name,
        declaredCity: place.declaredCity || "",
        declaredCountry: place.declaredCountry || "",
        reason: "解析所在国家与声明国家不一致（" +
          (resolved.resolvedCountry || "未知") + " ≠ " + (place.declaredCountry || "未填") + "）",
        resolvedAddress: resolved.formattedAddress || "",
      });
    }
  });
  return {
    timeFeasibility: null,
    lodgingWarnings: [],
    warnings: [],
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

// v1.6 天数估算：坐标查表（来自预 geocode，全量、真实、免费）。
function buildCoordLookup(toolContext) {
  var byName = (toolContext && toolContext.geocodeByName) || {};
  return function (name) {
    var g = byName[String(name || "").trim().toLowerCase()];
    if (g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng))) {
      return { lat: Number(g.lat), lng: Number(g.lng) };
    }
    return null;
  };
}

function haversineKm(a, b) {
  if (!a || !b) {
    return null;
  }
  var R = 6371;
  var toRad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * toRad;
  var dLng = (b.lng - a.lng) * toRad;
  var lat1 = a.lat * toRad;
  var lat2 = b.lat * toRad;
  var sinLat = Math.sin(dLat / 2);
  var sinLng = Math.sin(dLng / 2);
  var h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 直线距离→通勤分钟（仅用于「该排几天」的粗判）：短途按城市道路慢速、长途按快速路/城际提速。
// 由真实地理距离驱动，跨城/跨海自然变长，无需人为「跨城惩罚」。
function haversineTravelMin(a, b) {
  var km = haversineKm(a, b);
  if (km === null) {
    return null;
  }
  var speedKmh = km < 5 ? 18 : (km < 30 ? 35 : 60);
  return Math.max(5, Math.round((km / speedKmh) * 60));
}

// v1.6 混合口径平均通勤：优先用 travelCache 里已有的真实通勤，缺失相邻段用 haversine 兜底。
// 零额外 API 调用，定天数时即时可用；取代此前「取自 LLM 乐观路书」的偏小估计。
function estimateAverageTravelMinHybrid(order, travelLookup, coordOf, fallbackAvg) {
  var names = (Array.isArray(order) ? order : []).filter(Boolean);
  var fallback = Number.isFinite(Number(fallbackAvg)) ? Number(fallbackAvg) : 35;
  if (names.length < 2) {
    return fallback;
  }
  var samples = [];
  var i;
  for (i = 1; i < names.length; i += 1) {
    var real = typeof travelLookup === "function" ? travelLookup(names[i - 1], names[i]) : null;
    if (Number.isFinite(Number(real)) && Number(real) > 0) {
      samples.push(Number(real));
      continue;
    }
    var hv = haversineTravelMin(coordOf(names[i - 1]), coordOf(names[i]));
    if (Number.isFinite(Number(hv)) && Number(hv) > 0) {
      samples.push(Number(hv));
    }
  }
  if (!samples.length) {
    return fallback;
  }
  var sum = samples.reduce(function (acc, v) { return acc + v; }, 0);
  return Math.max(10, Math.round(sum / samples.length));
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

// v1.6：单段混合口径通勤（真实 travelCache 优先 → 坐标 haversine 兜底 → fallback），供逐日装箱估天数用。
function makeHybridLegMin(travelLookup, coordOf, fallbackMin) {
  var lookup = typeof travelLookup === "function" ? travelLookup : function () { return null; };
  var coord = typeof coordOf === "function" ? coordOf : function () { return null; };
  var fb = Number.isFinite(Number(fallbackMin)) ? Number(fallbackMin) : 30;
  return function (fromName, toName) {
    var real = lookup(fromName, toName);
    if (Number.isFinite(Number(real)) && Number(real) > 0) {
      return Number(real);
    }
    var hv = haversineTravelMin(coord(fromName), coord(toName));
    if (Number.isFinite(Number(hv)) && Number(hv) > 0) {
      return Number(hv);
    }
    return fb;
  };
}

// v1.6：逐日「装箱」估该排几天。每天必须同时满足体力档位的三条约束：
//   ① 纯游玩（含疲劳、每天重置）≤ maxVisitMinutes；
//   ② 景点数 ≤ maxVisits；
//   ③ 游玩 + 段间通勤 + 当天酒店往返 ≤ 单日总预算 ×slack（预留时间冗余 buffer）。
// 通勤走混合口径（options.legMin），酒店往返每天各算一次（options.hotelLegMin，用主酒店坐标近似）。
// 取满足约束的最小天数为 naturalDays；compactPlaces 为 reqDays 内按同一约束、按城市软对齐能容纳的子集。
function estimateNaturalDaysAndSubset(orderedPlaces, requestedDays, options) {
  var list = Array.isArray(orderedPlaces) ? orderedPlaces : [];
  var reqDays = Number(requestedDays);
  if (!Number.isFinite(reqDays) || reqDays <= 0) {
    reqDays = 1;
  }
  reqDays = Math.floor(reqDays);

  var opts = options || {};
  var caps = opts.physicalCaps || {};
  var maxVisitMin = Number.isFinite(Number(caps.maxVisitMinutes)) ? Number(caps.maxVisitMinutes) : 7 * 60;
  var maxVisits = Number.isFinite(Number(caps.maxVisits)) ? Number(caps.maxVisits) : 6;
  var baseBudget = Number.isFinite(Number(caps.dayBudgetMin)) ? Number(caps.dayBudgetMin) : 10 * 60;
  var slack = Number.isFinite(Number(opts.slack)) && Number(opts.slack) > 0 ? Number(opts.slack) : 1;
  var usableBudget = Math.max(1, Math.round(baseBudget * slack));
  var fatigueRate = Number.isFinite(Number(opts.fatigueRate)) ? Number(opts.fatigueRate) : agentPlanner.FATIGUE_RATE;
  var cityOf = typeof opts.cityOf === "function" ? opts.cityOf : function () { return ""; };
  var legMin = typeof opts.legMin === "function" ? opts.legMin : function () { return 30; };
  var hotelLegMin = typeof opts.hotelLegMin === "function" ? opts.hotelLegMin : function () { return 0; };

  function dayLoad(dayPlaces) {
    var durations = dayPlaces.map(function (p) { return resolvePlaceDurationMin(p, 90); });
    var visitFatigued = agentPlanner.fatigueAdjustedVisitMin(durations, fatigueRate);
    var intra = 0;
    var k;
    for (k = 1; k < dayPlaces.length; k += 1) {
      intra += Number(legMin(dayPlaces[k - 1].name, dayPlaces[k].name)) || 0;
    }
    var hotelRound = 0;
    if (dayPlaces.length) {
      hotelRound = (Number(hotelLegMin(dayPlaces[0].name)) || 0)
        + (Number(hotelLegMin(dayPlaces[dayPlaces.length - 1].name)) || 0);
    }
    return {
      visitFatigued: visitFatigued,
      count: dayPlaces.length,
      total: Math.round(visitFatigued + intra + hotelRound),
    };
  }
  function dayFeasible(load) {
    return load.visitFatigued <= maxVisitMin && load.count <= maxVisits && load.total <= usableBudget;
  }

  // naturalDays：从 1 天起按城市软对齐切分，找到「每天都可行」的最小天数（最坏一天一点）。
  var naturalDays = Math.max(1, list.length);
  var d;
  for (d = 1; d <= list.length; d += 1) {
    var buckets = agentPlanner.splitPlacesIntoCityAlignedDays(list, d, cityOf);
    var allOk = buckets.length > 0 && buckets.every(function (b) {
      return dayFeasible(dayLoad(b));
    });
    if (allOk) {
      naturalDays = d;
      break;
    }
  }
  if (!list.length) {
    naturalDays = 1;
  }

  // compactPlaces：reqDays 内按城市软对齐分天，逐天顺序装到「刚好可行」为止，溢出的点计入 droppedPlaces。
  var compactPlaces = [];
  var droppedPlaces = [];
  if (list.length) {
    var reqBuckets = agentPlanner.splitPlacesIntoCityAlignedDays(list, reqDays, cityOf);
    reqBuckets.forEach(function (bucket) {
      var kept = [];
      bucket.forEach(function (place) {
        if (dayFeasible(dayLoad(kept.concat([place])))) {
          kept.push(place);
          compactPlaces.push(place);
        } else {
          droppedPlaces.push(place);
        }
      });
    });
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
    strategy: ctx.strategyTemplate.id,
    cityOf: function (name) {
      var meta = ctx.placeMetaMap[agentPlanner.normalizeName(name)] || {};
      return meta.city || "";
    },
    priorityOf: function (name) {
      var meta = ctx.placeMetaMap[agentPlanner.normalizeName(name)] || {};
      return meta.priority || "medium";
    },
    // v1.4 策略×修复联动：用「当前策略权重」对（修复后）顺序重打分，保证修复不破坏策略取向。
    scoreOrder: function (order) {
      var metrics = agentPlanner.computeRouteMetrics(order, ctx.placeMetaMap, ctx.travelLookup);
      return agentPlanner.scoreRouteDetailed(metrics, ctx.strategyTemplate.id, ctx.body.transportPreference).score;
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
        openingHoursByPlace: ctx.openingHoursByPlace || null,
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

  // v1.6 多酒店：概览摘要输出全部酒店（主酒店字段保留兼容旧前端）。
  var lodgingHotels = agentPlanner.extractHotels(normalized.lodging);
  var primaryHotel = lodgingHotels[0] || null;
  var lodgingSummary = Object.assign(
    {
      hotelName: primaryHotel ? primaryHotel.name : "",
      formattedAddress: primaryHotel ? (primaryHotel.resolvedAddress || primaryHotel.address || "") : "",
      checkInDate: primaryHotel ? primaryHotel.checkInDate : "",
      checkOutDate: primaryHotel ? primaryHotel.checkOutDate : "",
      nights: null,
      hotelCount: lodgingHotels.length,
      hotels: lodgingHotels.map(function (h) {
        return {
          name: h.name || "",
          formattedAddress: h.resolvedAddress || h.address || "",
          checkInDate: h.checkInDate || "",
          checkOutDate: h.checkOutDate || "",
        };
      }),
      note: lodgingHotels.length > 1
        ? "多酒店：按入住/离店日期分段闭环，换酒店日含行李转移"
        : (normalized.lodging ? "全程固定酒店，每日往返" : ""),
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
  // v1.6 多酒店：日期合法性/空档校验（离店早于入住、区间重叠、空档日）。
  var lodgingValidation = agentPlanner.validateLodging(normalized.lodging, dailyPlans.length || ctx.planData.length);
  if (lodgingValidation.errors.length) {
    lodgingWarnings = lodgingWarnings.concat(lodgingValidation.errors);
  }
  if (lodgingValidation.warnings.length) {
    lodgingWarnings = lodgingWarnings.concat(lodgingValidation.warnings);
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
  // v1.4 OI-1（方向C）：按日分组口径的跨城统计，反映「每日回酒店」后的真实同日跨城次数。
  var dailyMetrics = agentPlanner.computeDailyMetrics(ctx.planData, ctx.placeMetaMap, ctx.travelLookup);
  var strategyExplanationText = agentPlanner.buildStrategyExplanation(
    strategyTemplate.id,
    effectiveMetrics,
    ctx.chosenRoute ? ctx.chosenRoute.source : "llm"
  );
  // v1.4 结构化策略解释（含次优对比与 scoreGap）
  // #3/#4：以最终交付顺序（聚类/修复后）重打分，确保解释的得分构成与上面 routeMetrics 同源一致。
  var deliveredRoute = agentPlanner.rescoreChosenForDelivery(
    finalOrder,
    ctx.chosenRoute,
    ctx.placeMetaMap,
    ctx.travelLookup,
    strategyTemplate.id,
    ctx.body.transportPreference
  );
  var strategyExplanation = agentPlanner.buildStrategyExplanationDetail(
    strategyTemplate.id,
    deliveredRoute
  );
  var combinedRouteStrategy = [strategyExplanationText, strategyExplanation.reason, analysis.routeStrategy]
    .filter(Boolean)
    .join(" ");

  // v1.3.1 第二方案（仅 gap==1 时构建）：结构完整、可与主方案上下堆叠展示
  var alternativePlan = null;
  if (ctx.secondarySpec) {
    var sec = ctx.secondarySpec;
    var secCityOf = function (name) {
      return (ctx.placeMetaMap[agentPlanner.normalizeName(name)] || {}).city || "";
    };
    var secPlanData = agentPlanner.buildPlanDataFromOrder(sec.order, sec.places, normalized.city, sec.days, { cityOf: secCityOf });
    var secDaily = agentPlanner.buildDailyPlansFromPlanData(secPlanData, normalized.lodging, sec.days, {
      travelLookup: ctx.travelLookup,
      transitLookup: ctx.transitLookup,
      openingHoursByPlace: ctx.openingHoursByPlace || null,
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
    strategyExplanation: strategyExplanation,
    strategyComparison: ctx.strategyComparison || null,
    routeMetrics: {
      totalTravelMin: effectiveMetrics.totalTravelMin,
      crossCityCount: effectiveMetrics.crossCityCount,
      backtrackCount: effectiveMetrics.backtrackCount,
      crossCityWithinDay: dailyMetrics.totalCrossCityWithinDay,
      crossCityByDay: dailyMetrics.crossCityByDay,
    },
    transitBreakdown: ctx.transitBreakdown,
    placeSpotlights: filterSpotlightsByOrder(analysis.placeSpotlights, finalOrderSet),
    roadbook: filterRoadbookByOrder(analysis.roadbook, finalOrderSet),
    // v1.5：把天气风险提示并入注意事项（来自 Google Weather，已核实来源）
    precautions: (Array.isArray(ctx.weatherNotes) ? ctx.weatherNotes : []).concat(analysis.precautions || []),
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

        // v1.4 候选生成 + 剪枝：多路候选（LLM + 各策略贪心 + 优先级）去重后上限 K，防组合爆炸。
        var candidateOrders = agentPlanner.generateCandidateOrders(
          recommendedOrder,
          placeMetaMap,
          travelLookup,
          strategyTemplate.id,
          { K: CANDIDATE_LIMIT }
        );
        var chosenRoute = agentPlanner.chooseBestOrder(candidateOrders, placeMetaMap, travelLookup, strategyTemplate.id, body.transportPreference);
        if (chosenRoute && chosenRoute.order.length) {
          recommendedOrder = chosenRoute.order;
        }
        // v1.4 OI-1 根治（方向B）：对最终顺序按城市聚类，作为唯一顺序源向下游（enrichedPlaces/
        // 分天/planData/roadbook）一致传导，确保「先聚类、再连续分块」后同城景点同日、消除无谓跨城。
        recommendedOrder = agentPlanner.clusterOrderByCity(recommendedOrder, placeMetaMap);
        context.chosenRoute = chosenRoute;
        context.tracer.emit({
          stage: "plan_initial",
          eventType: "scoring",
          status: "ok",
          payload: {
            strategy: strategyTemplate.id,
            candidateCount: candidateOrders.length,
            bestScore: chosenRoute ? chosenRoute.cost : null,
            bestSource: chosenRoute ? chosenRoute.source : null,
            scoreBreakdown: chosenRoute ? chosenRoute.breakdown : null,
          },
        });

        // v1.4 A/B 多方案：用户所选策略 vs 次优策略（同候选集上另一策略的最优、与主方案差异最大者）。
        context.strategyComparison = agentPlanner.compareStrategies(
          candidateOrders,
          placeMetaMap,
          travelLookup,
          strategyTemplate.id,
          body.transportPreference
        );
        if (context.strategyComparison && context.strategyComparison.runnerUp) {
          context.tracer.emit({
            stage: "plan_initial",
            eventType: "alternative_compare",
            status: "ok",
            payload: {
              chosen: context.strategyComparison.primary.strategy,
              rejected: context.strategyComparison.runnerUp.strategy,
              scoreGap: context.strategyComparison.runnerUp.score - context.strategyComparison.primary.score,
              tradeoff: context.strategyComparison.runnerUp.tradeoff,
            },
          });
        }

        var enrichedPlaces = agentPlanner.applyAgentInsights(
          normalized.places,
          analysis.places,
          recommendedOrder,
          analysis.placeSpotlights
        ).filter(function (item) {
          return !excludedSet.has(normalizeText(item.name));
        });
        // #2：把用户设置的「每个景点游玩时长」回填到无显式时长的景点，向下游 planData/分天/体力校验一致传导。
        applyDefaultVisitDuration(enrichedPlaces, normalized.visitMinutes);
        context.enrichedPlaces = enrichedPlaces;

        // v1.6：天数估算改用「混合口径」真实通勤（travelCache 真实值 + 坐标 haversine 兜底），
        // 取代此前取自 LLM 乐观路书的偏小估计（那会把跨城/跨海段严重低估，误判成 1 天）。
        var coordOf = buildCoordLookup(context.toolContext);
        var roadbookAvg = calcAverageTravelMinutesFromRoadbook(analysis.roadbook);
        var averageTravelMin = estimateAverageTravelMinHybrid(recommendedOrder, travelLookup, coordOf, roadbookAvg);
        // v1.6：天数估算改为「逐日装箱」，约束来自用户所选体力档位（单日总预算随强度 8/10/12h + 15% 冗余），
        // 每天纯游玩含疲劳 ≤ maxVisitMinutes、景点数 ≤ maxVisits、且含每天各自的酒店往返（主酒店坐标近似）。
        var estimatePhysicalPreset = verifier.getPhysicalPreset(body.physicalPreference);
        var estimateLegMin = makeHybridLegMin(travelLookup, coordOf, roadbookAvg);
        var estimateHotels = agentPlanner.extractHotels(normalized.lodging);
        var estimatePrimaryHotel = estimateHotels.length ? estimateHotels[0] : null;
        var estimateHotelCoord = estimatePrimaryHotel && estimatePrimaryHotel.name
          ? coordOf(estimatePrimaryHotel.name)
          : null;
        var estimateHotelLegMin = function (placeName) {
          if (!estimatePrimaryHotel) {
            return 0;
          }
          if (!estimateHotelCoord) {
            return 25;
          }
          var hv = haversineTravelMin(estimateHotelCoord, coordOf(placeName));
          return Number.isFinite(Number(hv)) && Number(hv) > 0 ? Number(hv) : 25;
        };
        var estimateCityOf = function (name) {
          return (placeMetaMap[agentPlanner.normalizeName(name)] || {}).city || "";
        };
        var estimated = estimateNaturalDaysAndSubset(enrichedPlaces, normalized.totalDays, {
          physicalCaps: estimatePhysicalPreset,
          slack: verifier.DAY_BUDGET_SLACK,
          cityOf: estimateCityOf,
          legMin: estimateLegMin,
          hotelLegMin: estimateHotelLegMin,
        });
        context.estimated = estimated;
        context.tracer.emit({
          stage: "build_context",
          eventType: "day_estimate",
          status: "ok",
          payload: {
            averageTravelMin: averageTravelMin,
            roadbookAvg: roadbookAvg,
            dayBudgetMin: estimatePhysicalPreset.dayBudgetMin,
            dayBudgetSlack: verifier.DAY_BUDGET_SLACK,
            maxVisitMinutes: estimatePhysicalPreset.maxVisitMinutes,
            maxVisits: estimatePhysicalPreset.maxVisits,
            naturalDays: estimated.naturalDays,
            requestedDays: estimated.requestedDays,
          },
        });

        // v1.3.1 天数冲突决策：决定主方案（进状态机做校验/修复）与可选的第二方案
        var dayPlan = decideDayPlan(estimated, enrichedPlaces);
        context.dayConflict = dayPlan.dayConflict;
        context.planLabel = dayPlan.primary.label;
        context.secondarySpec = dayPlan.secondary;
        context.droppedByDayFit = dayPlan.primary.dropped;

        var effectiveOrder = dayPlan.primary.order;
        // v1.6：按城市软对齐分天——用 placeMetaMap 的城市把当日切在城市边界上，
        // 避免「按点数均分」把同城景点拆到两天、或把跨城点塞进同一天。
        var cityOfPlace = function (name) {
          return (placeMetaMap[agentPlanner.normalizeName(name)] || {}).city || "";
        };
        context.planData = agentPlanner.buildPlanDataFromOrder(
          dayPlan.primary.order,
          dayPlan.primary.places,
          normalized.city,
          dayPlan.primary.days,
          { cityOf: cityOfPlace }
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

        // v1.5 工具层：拉取当前顺序下各景点营业时间 + 按天天气（默认开启，走注册表统一缓存/降级/埋点）。
        var registry = buildToolRegistry(context.toolContext, context.tracer, body.mapsApiKey);
        context.toolRegistry = registry;
        // 景点 → 实际游玩日期，供 opening_hours/weather 按当天查询（修复"按今天查"）。
        var placeDateMap = buildPlaceDateMap(context.planData, normalized.lodging);
        context.placeDateMap = placeDateMap;
        if (registry.isEnabled("opening_hours")) {
          pushProgress({ percent: 89, stage: "opening_hours", message: "查询景点营业时间" });
        }
        context.openingHoursByPlace = await fetchOpeningHoursForOrder(
          effectiveOrder,
          registry,
          context.toolContext,
          placeDateMap,
          function (ohProgress) {
            pushProgress({ percent: 89, stage: "opening_hours", message: ohProgress.message || "查询营业时间" });
          },
          { concurrency: TOOL_FETCH_CONCURRENCY, scope: OPENING_HOURS_SCOPE, placeMetaMap: placeMetaMap }
        );
        // 按天天气 → 注意事项（precautions）
        if (registry.isEnabled("weather")) {
          pushProgress({ percent: 90, stage: "weather", message: "查询目的地天气" });
        }
        context.weatherNotes = await fetchWeatherNotes(
          context.planData,
          placeDateMap,
          registry,
          context.toolContext,
          function (wProgress) {
            pushProgress({ percent: 90, stage: "weather", message: wProgress.message || "查询天气" });
          },
          TOOL_FETCH_CONCURRENCY
        );
        // v1.5 校验层输入：闭馆风险（依赖 opening_hours）+ 体力强度（用户偏好档位）+ 回酒店往返 + 拥堵修正（高峰启发式）。
        var physicalPreset = verifier.getPhysicalPreset(body.physicalPreference);
        context.v15Checks = {
          openingHoursByPlace: context.openingHoursByPlace,
          dayStartMin: DAY_START_MIN,
          physicalLoad: {
            enabled: PHYSICAL_CHECK_ENABLED,
            maxVisitMinutes: physicalPreset.maxVisitMinutes,
            maxVisits: physicalPreset.maxVisits,
          },
          // v1.6：把体力档位的单日总预算 + 时间冗余透传给 TIME_OVERLOAD/evaluateTimeFeasibility，口径统一。
          dayBudgetMin: physicalPreset.dayBudgetMin,
          dayBudgetSlack: verifier.DAY_BUDGET_SLACK,
          hotelReturnCost: { enabled: HOTEL_RETURN_CHECK_ENABLED },
          congestion: { enabled: registry.isEnabled("congestion") },
        };

        return { next: "verify", status: "ok" };
      },
    },

    verify: {
      action: function (context) {
        context.dailyPlans = agentPlanner.buildDailyPlansFromPlanData(
          context.planData,
          normalized.lodging,
          context.planData.length,
          {
            travelLookup: context.travelLookup,
            transitLookup: context.transitLookup,
            openingHoursByPlace: context.openingHoursByPlace || null,
          }
        );
        var vr = verifier.runVerifiers({
          planData: context.planData,
          dailyPlans: context.dailyPlans,
          lodging: normalized.lodging,
          requestedDays: context.estimated.requestedDays,
          cityOf: context.repairContext.cityOf,
          checks: context.v15Checks || null,
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
        // v1.4 策略×修复联动：用当前策略权重对修复后方案重打分，写入 trace 供复盘「修复是否符合策略取向」。
        var afterStrategyScore = repair.rescorePlanWithStrategy(context.planData, context.repairContext);
        context.strategyScoreHistory.push(afterStrategyScore);
        context.tracer.repairAction({
          action: applied.changeLog.action,
          reason: context.pendingRepair.failure.code,
          beforeScore: beforeScore,
          afterScore: afterStrategyScore,
          strategy: context.repairContext.strategy,
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
    strategyScoreHistory: [],
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

  // v1.4 策略选择埋点：记录最终采用的策略、是否用户指定、交通模式偏好，供策略使用分布分析。
  requestTracer.emit({
    stage: "collect_input",
    eventType: "strategy_select",
    status: "ok",
    payload: {
      strategy: strategyTemplate.id,
      isUserSpecified: Boolean(body.strategy),
      transportPreference: String(body.transportPreference || "driving").toLowerCase(),
    },
  });

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

// v1.6 局部重算：从回传结果重建 placeMeta（不含实时坐标，退化为声明城市）。
function buildPlaceMetaMapFromEnriched(enrichedPlaces) {
  var map = {};
  (Array.isArray(enrichedPlaces) ? enrichedPlaces : []).forEach(function (p) {
    if (!p) {
      return;
    }
    var key = agentPlanner.normalizeName(p.name);
    if (!key) {
      return;
    }
    map[key] = {
      city: p.city || p.declaredCity || "",
      country: p.country || p.declaredCountry || "",
      priority: p.llmPriority || p.priority || "medium",
    };
  });
  return map;
}

// v1.6 局部重算主流程：应用改点 → 只重算受影响天 → 重建 dailyPlans → 校验 → 组装结果。
// 纯本地计算（不调外部工具），复用当前行程已知通勤时长；无状态友好（所有输入来自请求体）。
function buildAgentReplanPayload(body) {
  var input = body || {};
  var changeEvent = input.changeEvent || {};
  if (!changeEvent.type || !changeEvent.placeName) {
    var e1 = new Error("缺少 changeEvent");
    e1.statusCode = 400;
    e1.payload = { error: "缺少 changeEvent（需含 type 与 placeName）" };
    throw e1;
  }
  if (changeEvent.type !== "remove_place" && changeEvent.type !== "move_place") {
    var e2 = new Error("不支持的 changeEvent 类型");
    e2.statusCode = 400;
    e2.payload = { error: "不支持的 changeEvent 类型：" + changeEvent.type };
    throw e2;
  }
  var planData = Array.isArray(input.planData) ? input.planData : [];
  if (!planData.length) {
    var e3 = new Error("planData 不能为空");
    e3.statusCode = 400;
    e3.payload = { error: "planData 不能为空" };
    throw e3;
  }

  var lodging = buildDefaultLodging(input.lodging);
  var placeMetaMap = buildPlaceMetaMapFromEnriched(input.enrichedPlaces);
  var travelLookup = replan.buildTravelLookupFromDailyPlans(input.dailyPlans);
  var strategy = agentPlanner.getStrategyTemplate(input.strategy).id;
  var transportPreference = String(input.transportPreference || "driving").toLowerCase();

  var requestTracer = tracer.createTracer();

  var replanResult = replan.incrementalReplan({
    planData: planData,
    changeEvent: changeEvent,
    placeMetaMap: placeMetaMap,
    travelLookup: travelLookup,
    strategy: strategy,
    transportPreference: transportPreference,
  });

  var totalDays = replanResult.planData.length;
  var newDailyPlans = agentPlanner.buildDailyPlansFromPlanData(replanResult.planData, lodging, totalDays, {
    travelLookup: travelLookup,
  });
  var closure = agentPlanner.verifyHotelClosure(newDailyPlans, lodging);

  var cityOf = function (name) {
    var m = placeMetaMap[agentPlanner.normalizeName(name)] || {};
    return m.city || "";
  };
  var physicalPreset = verifier.getPhysicalPreset(input.physicalPreference);
  var verifyResult = verifier.runVerifiers({
    planData: replanResult.planData,
    dailyPlans: newDailyPlans,
    lodging: lodging,
    requestedDays: totalDays,
    cityOf: cityOf,
    checks: {
      physicalLoad: {
        enabled: true,
        maxVisitMinutes: physicalPreset.maxVisitMinutes,
        maxVisits: physicalPreset.maxVisits,
      },
    },
  });

  var recommendedOrder = [];
  replanResult.planData.forEach(function (d) {
    (Array.isArray(d.items) ? d.items : []).forEach(function (it) {
      if (it && it.type === "visit" && it.title) {
        recommendedOrder.push(it.title);
      }
    });
  });

  var effectiveMetrics = agentPlanner.computeRouteMetrics(recommendedOrder, placeMetaMap, travelLookup);
  var dailyMetrics = agentPlanner.computeDailyMetrics(replanResult.planData, placeMetaMap, travelLookup);

  var lodgingHotels = agentPlanner.extractHotels(lodging);
  var primaryHotel = lodgingHotels[0] || null;
  var lodgingSummary = {
    hotelName: primaryHotel ? primaryHotel.name : "",
    formattedAddress: primaryHotel ? (primaryHotel.resolvedAddress || primaryHotel.address || "") : "",
    checkInDate: primaryHotel ? primaryHotel.checkInDate : "",
    checkOutDate: primaryHotel ? primaryHotel.checkOutDate : "",
    hotelCount: lodgingHotels.length,
    hotels: lodgingHotels.map(function (h) {
      return {
        name: h.name || "",
        formattedAddress: h.resolvedAddress || h.address || "",
        checkInDate: h.checkInDate || "",
        checkOutDate: h.checkOutDate || "",
      };
    }),
    note: lodgingHotels.length > 1 ? "多酒店：按入住/离店日期分段闭环" : (lodging ? "全程固定酒店，每日往返" : ""),
  };

  var lodgingValidation = agentPlanner.validateLodging(lodging, totalDays);
  var lodgingWarnings = closure.warnings.concat(lodgingValidation.errors, lodgingValidation.warnings);

  requestTracer.emit({
    stage: "incremental_replan",
    eventType: "incremental_replan",
    status: "ok",
    payload: {
      changeType: replanResult.changeType,
      affectedScope: replanResult.affectedDays,
      reusedRatio: replanResult.reusedRatio,
      dayCount: replanResult.dayCount,
    },
  });
  tracer.recordTrace(requestTracer);

  return {
    planData: replanResult.planData,
    dailyPlans: newDailyPlans,
    recommendedOrder: recommendedOrder,
    affectedDays: replanResult.affectedDays,
    reusedRatio: replanResult.reusedRatio,
    changeType: replanResult.changeType,
    routeMetrics: {
      totalTravelMin: effectiveMetrics.totalTravelMin,
      crossCityCount: effectiveMetrics.crossCityCount,
      backtrackCount: effectiveMetrics.backtrackCount,
      crossCityWithinDay: dailyMetrics.totalCrossCityWithinDay,
      crossCityByDay: dailyMetrics.crossCityByDay,
    },
    lodgingSummary: lodgingSummary,
    validation: {
      pass: verifyResult.pass,
      findings: verifyResult.findings,
      lodgingWarnings: lodgingWarnings,
    },
    traceId: requestTracer.traceId,
  };
}

async function handleAgentReplan(req, res) {
  try {
    var body = await readRequestBody(req);
    var payload = buildAgentReplanPayload(body);
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
  // v1.6 局部重算：改点后只重算受影响天（纯本地计算，不重新调用地图/LLM）。
  if (req.method === "POST" && req.url === "/api/agent/replan") {
    if (!enforceRateLimit(req, res)) {
      return;
    }
    handleAgentReplan(req, res);
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
  mapWithConcurrency: mapWithConcurrency,
  applyDefaultVisitDuration: applyDefaultVisitDuration,
  estimateNaturalDaysAndSubset: estimateNaturalDaysAndSubset,
  makeHybridLegMin: makeHybridLegMin,
  haversineTravelMin: haversineTravelMin,
};
