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
        var result = {
          placeName: placeName || first.formatted_address,
          formattedAddress: first.formatted_address,
          lat: first.geometry.location.lat,
          lng: first.geometry.location.lng,
        };
        toolContext.geocodeByKey[key] = result;
        if (placeName) {
          toolContext.geocodeByName[placeName.toLowerCase()] = result;
        }
        resolve(result);
      })
      .catch(function (err) {
        reject(err);
      });
  });
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

async function runToolCallingAgent(input) {
  var llmBaseUrl = String(input.llmBaseUrl || "").replace(/\/$/, "");
  var llmApiKey = String(input.llmApiKey || "");
  var llmModel = String(input.llmModel || "");
  var mapsApiKey = String(input.mapsApiKey || "");
  var toolContext = createToolContext(input);

  var messages = [
    { role: "system", content: llm.buildAgentSystemPrompt() },
    { role: "user", content: buildAgentPrompt(input) },
  ];

  var maxSteps = 14;
  var step;
  for (step = 0; step < maxSteps; step += 1) {
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
      return llm.parseAgentPlanJson(finalText);
    }

    var idx;
    for (idx = 0; idx < toolCalls.length; idx += 1) {
      var toolCall = toolCalls[idx];
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

async function handleAgentPlan(req, res) {
  try {
    var body = await readRequestBody(req);
    var required = ["country", "city", "totalDays", "places", "llmBaseUrl", "llmApiKey", "llmModel", "mapsApiKey"];
    var missing = required.filter(function (key) {
      return body[key] === undefined || body[key] === null || body[key] === "";
    });
    if (missing.length) {
      sendJson(res, 400, { error: "缺少必填字段", missing: missing });
      return;
    }

    var places = Array.isArray(body.places) ? body.places : [];
    if (!places.length) {
      sendJson(res, 400, { error: "places 不能为空" });
      return;
    }

    var analysis = await runToolCallingAgent({
      country: body.country,
      city: body.city,
      totalDays: Number(body.totalDays),
      places: places,
      llmBaseUrl: body.llmBaseUrl,
      llmApiKey: body.llmApiKey,
      llmModel: body.llmModel,
      mapsApiKey: body.mapsApiKey,
    });

    var recommendedOrder = Array.isArray(analysis.recommendedOrder) ? analysis.recommendedOrder : [];
    var enrichedPlaces = agentPlanner.applyAgentInsights(
      places,
      analysis.places,
      recommendedOrder,
      analysis.placeSpotlights
    );
    var planData = agentPlanner.buildPlanDataFromOrder(
      recommendedOrder,
      enrichedPlaces,
      body.city,
      Number(body.totalDays)
    );

    sendJson(res, 200, {
      summary: analysis.summary || "",
      routeStrategy: analysis.routeStrategy || "",
      placeSpotlights: analysis.placeSpotlights || [],
      roadbook: analysis.roadbook || [],
      precautions: analysis.precautions || [],
      recommendedOrder: recommendedOrder,
      enrichedPlaces: enrichedPlaces,
      planData: planData,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

var server = http.createServer(function (req, res) {
  if (req.method === "POST" && req.url === "/api/agent/plan") {
    handleAgentPlan(req, res);
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
