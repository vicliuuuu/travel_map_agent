(function (globalScope) {
  "use strict";

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  var PROVIDER_MODELS = {
    openai: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4o", "o4-mini"],
    qwen: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-32b"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    openrouter: ["openai/gpt-4o-mini", "qwen/qwen-2.5-72b-instruct", "anthropic/claude-3.5-sonnet"],
    siliconflow: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "meta-llama/Meta-Llama-3.1-70B-Instruct"],
    zhipu: ["glm-4-plus", "glm-4-air", "glm-4-flash"],
    moonshot: ["moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"],
    anthropic: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    custom: [],
  };

  function detectProviderByBaseUrl(baseUrl) {
    var normalizedUrl = String(baseUrl || "").trim().toLowerCase();
    if (!normalizedUrl) {
      return { provider: "openai", note: "默认按 OpenAI 兼容接口处理" };
    }

    if (normalizedUrl.indexOf("dashscope") >= 0 || normalizedUrl.indexOf("qwen") >= 0) {
      return { provider: "qwen", note: "识别为通义千问兼容网关" };
    }
    if (normalizedUrl.indexOf("deepseek") >= 0) {
      return { provider: "deepseek", note: "识别为 DeepSeek 平台" };
    }
    if (normalizedUrl.indexOf("openrouter") >= 0) {
      return { provider: "openrouter", note: "识别为 OpenRouter 聚合网关" };
    }
    if (normalizedUrl.indexOf("siliconflow") >= 0) {
      return { provider: "siliconflow", note: "识别为 SiliconFlow 平台" };
    }
    if (normalizedUrl.indexOf("bigmodel") >= 0 || normalizedUrl.indexOf("zhipu") >= 0) {
      return { provider: "zhipu", note: "识别为智谱 AI 平台" };
    }
    if (normalizedUrl.indexOf("moonshot") >= 0 || normalizedUrl.indexOf("kimi") >= 0) {
      return { provider: "moonshot", note: "识别为 Moonshot 平台" };
    }
    if (normalizedUrl.indexOf("anthropic") >= 0 || normalizedUrl.indexOf("claude") >= 0) {
      return { provider: "anthropic", note: "识别为 Anthropic 平台（需确认接口兼容性）" };
    }
    if (normalizedUrl.indexOf("openai") >= 0) {
      return { provider: "openai", note: "识别为 OpenAI 平台" };
    }
    return { provider: "custom", note: "未识别供应商，请手动选择模型" };
  }

  function getProviderModels(provider) {
    return (PROVIDER_MODELS[provider] || []).slice();
  }

  function clampDuration(value, fallbackValue) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallbackValue;
    }
    return Math.max(30, Math.min(480, Math.floor(parsed)));
  }

  function extractJsonText(rawText) {
    var text = String(rawText || "").trim();
    if (!text) {
      throw new Error("LLM 返回为空");
    }

    var fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
      return fencedMatch[1].trim();
    }

    var firstBrace = text.indexOf("{");
    var lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    throw new Error("未找到可解析 JSON");
  }

  function parsePlaceSpotlights(rawList) {
    return (Array.isArray(rawList) ? rawList : [])
      .map(function (item) {
        var name = String(item.name || "").trim();
        if (!name) {
          return null;
        }
        var priority = String(item.priority || "medium").toLowerCase();
        return {
          name: name,
          introduction: String(item.introduction || item.intro || ""),
          highlights: String(item.highlights || ""),
          suggestedVisitRange: String(item.suggestedVisitRange || item.visitTimeRange || ""),
          suggestedDurationMin: clampDuration(item.suggestedDurationMin, 90),
          priority: priority === "high" || priority === "low" ? priority : "medium",
          tips: String(item.tips || ""),
        };
      })
      .filter(function (item) {
        return !!item;
      });
  }

  function parseRoadbook(rawList) {
    return (Array.isArray(rawList) ? rawList : [])
      .map(function (item, index) {
        var placeName = String(item.placeName || item.name || "").trim();
        if (!placeName) {
          return null;
        }
        var travel = item.travelToNext || item.transitToNext || null;
        var travelBlock = null;
        if (travel && typeof travel === "object") {
          travelBlock = {
            destination: String(travel.destination || travel.toPlaceName || ""),
            durationRange: String(travel.durationRange || travel.timeRange || ""),
            durationMin: Number.isFinite(Number(travel.durationMin))
              ? Math.max(1, Math.floor(Number(travel.durationMin)))
              : null,
            distanceText: String(travel.distanceText || travel.distance || ""),
            note: String(travel.note || travel.tips || ""),
          };
        }
        return {
          step: Number.isFinite(Number(item.step)) ? Number(item.step) : (index + 1),
          placeName: placeName,
          visitTimeRange: String(item.visitTimeRange || item.suggestedVisitRange || ""),
          visitDurationMin: clampDuration(item.visitDurationMin, 90),
          visitTips: String(item.visitTips || item.tips || ""),
          travelToNext: travelBlock,
        };
      })
      .filter(function (item) {
        return !!item;
      });
  }

  function parsePrecautions(rawList) {
    return (Array.isArray(rawList) ? rawList : [])
      .map(function (item) {
        return String(item || "").trim();
      })
      .filter(function (item) {
        return !!item;
      });
  }

  function parseAnalysisPlaces(rawList) {
    return (Array.isArray(rawList) ? rawList : [])
      .map(function (item) {
        var name = String(item.name || "").trim();
        if (!name) {
          return null;
        }
        var priority = String(item.priority || "medium").toLowerCase();
        return {
          name: name,
          suggestedDurationMin: clampDuration(item.suggestedDurationMin, 90),
          priority: priority === "high" || priority === "low" ? priority : "medium",
          reason: String(item.reason || ""),
        };
      })
      .filter(function (item) {
        return !!item;
      });
  }

  function parseAgentPlanJson(rawText) {
    var jsonText = extractJsonText(rawText);
    var parsed = JSON.parse(jsonText);
    var placeSpotlights = parsePlaceSpotlights(parsed.placeSpotlights);
    var places = parseAnalysisPlaces(parsed.places);
    if (!places.length && placeSpotlights.length) {
      places = placeSpotlights.map(function (item) {
        return {
          name: item.name,
          suggestedDurationMin: item.suggestedDurationMin,
          priority: item.priority,
          reason: item.introduction || item.highlights || "",
        };
      });
    }

    var recommendedOrder = Array.isArray(parsed.recommendedOrder)
      ? parsed.recommendedOrder.map(function (item) {
        return String(item || "").trim();
      }).filter(function (item) {
        return !!item;
      })
      : [];

    if (!recommendedOrder.length) {
      recommendedOrder = parseRoadbook(parsed.roadbook).map(function (item) {
        return item.placeName;
      });
    }

    return {
      summary: String(parsed.summary || ""),
      routeStrategy: String(parsed.routeStrategy || parsed.routingStrategy || ""),
      placeSpotlights: placeSpotlights,
      recommendedOrder: recommendedOrder,
      roadbook: parseRoadbook(parsed.roadbook),
      precautions: parsePrecautions(parsed.precautions),
      places: places,
    };
  }

  function parseAnalysisJson(rawText) {
    var agentPlan = parseAgentPlanJson(rawText);
    return {
      summary: agentPlan.summary,
      recommendedOrder: agentPlan.recommendedOrder,
      places: agentPlan.places,
      routeStrategy: agentPlan.routeStrategy,
      placeSpotlights: agentPlan.placeSpotlights,
      roadbook: agentPlan.roadbook,
      precautions: agentPlan.precautions,
    };
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

  function toInsightMap(analysisPlaces) {
    var map = {};
    (Array.isArray(analysisPlaces) ? analysisPlaces : []).forEach(function (item) {
      map[normalizeName(item.name)] = {
        suggestedDurationMin: clampDuration(item.suggestedDurationMin, 90),
        priority: item.priority || "medium",
        reason: item.reason || "",
        score: priorityToScore(item.priority),
      };
    });
    return map;
  }

  function buildAgentSystemPrompt() {
    return [
      "你是资深旅行规划师与路书撰写专家。",
      "用户只听说过景点名字，不熟悉当地，也不知道合理的游玩顺序——顺序规划是你的核心职责。",
      "",
      "工作原则：",
      "1) 先汇总用户提到的全部景点，逐一给出通俗介绍，帮助用户快速建立认知；",
      "2) 必须调用 geocode_place 解析每个景点位置，并调用 get_travel_time 查询相邻景点真实通勤时间；",
      "3) 结合 Google Maps 真实路程与常见旅游攻略经验，按「尽量不走回头路」策略确定游览顺序；",
      "4) 输出完整路书：使用时间段/范围描述（如「建议游玩 2-3 小时」「车程约 25-35 分钟」），不要精确到几点几分；",
      "5) 根据目的地给出实用注意事项（地形、气候、安全、文化礼仪等），要具体、可执行。",
      "",
      "最终只输出 JSON，不要 markdown 包裹。",
    ].join("\n");
  }

  function buildAgentUserPrompt(input) {
    var city = String(input.city || "");
    var country = String(input.country || "");
    var places = Array.isArray(input.places) ? input.places : [];
    var days = Number(input.totalDays || 1);

    return [
      "请为以下旅行需求生成智能路书。",
      "",
      "【目的地】",
      "国家: " + country,
      "城市: " + city,
      "计划游玩天数: " + days,
      "",
      "【用户想去的景点（可能只听过名字）】",
      places.map(function (item, idx) {
        var durationPart = item.durationMin ? (" | 用户提及时长约 " + item.durationMin + " 分钟") : "";
        return (idx + 1) + ". " + item.name + (item.address ? (" | " + item.address) : "") + durationPart;
      }).join("\n"),
      "",
      "【工具使用要求】",
      "- 对每个景点调用 geocode_place（placeName 必填，可附 placeAddress）",
      "- 按你初步判断的顺序，对相邻景点调用 get_travel_time 获取真实驾驶时长",
      "- 若某段路程查询失败，在路书中注明并给出保守估计",
      "",
      "【规划策略（当前版本）】",
      "- 核心策略：尽量不走回头路，减少折返",
      "- 可综合景点开放时间、地理位置聚类、常见攻略动线，但必须在 routeStrategy 中解释",
      "",
      "【输出 JSON Schema】",
      "{",
      '  "summary": "本次行程一句话概述",',
      '  "routeStrategy": "为何采用此顺序（强调不走回头路、地理聚类等理由）",',
      '  "placeSpotlights": [',
      "    {",
      '      "name": "景点名（必须与用户输入一致）",',
      '      "introduction": "80-150字，景点是什么、适合谁、为何值得去",',
      '      "highlights": "核心看点/体验（简短条目感）",',
      '      "suggestedVisitRange": "建议游玩时间范围，如 2-3 小时",',
      '      "suggestedDurationMin": 120,',
      '      "priority": "high|medium|low",',
      '      "tips": "游玩小贴士（可选）"',
      "    }",
      "  ],",
      '  "recommendedOrder": ["景点A","景点B"],',
      '  "roadbook": [',
      "    {",
      '      "step": 1,',
      '      "placeName": "景点A",',
      '      "visitTimeRange": "建议游玩 2-3 小时",',
      '      "visitDurationMin": 120,',
      '      "visitTips": "该站怎么玩更省力（可选）",',
      '      "travelToNext": {',
      '        "destination": "景点B",',
      '        "durationRange": "驾车约 25-35 分钟",',
      '        "durationMin": 30,',
      '        "distanceText": "12 公里",',
      '        "note": "路况/停车/排队等提醒（可选）"',
      "      }",
      "    }",
      "  ],",
      '  "precautions": [',
      '    "针对该目的地的注意事项1",',
      '    "注意事项2"',
      "  ],",
      '  "places": [',
      '    {"name":"景点名","suggestedDurationMin":120,"priority":"high|medium|low","reason":"简短理由"}',
      "  ]",
      "}",
      "",
      "【硬性要求】",
      "- placeSpotlights 必须覆盖用户提到的每一个景点",
      "- recommendedOrder 与 roadbook 站点顺序一致",
      "- roadbook 最后一站的 travelToNext 设为 null 或省略",
      "- precautions 至少 2 条，结合目的地实际情况（如重庆山路/欧洲防盗/高原反应等）",
      "- suggestedDurationMin、durationMin 为整数分钟；priority 只能是 high/medium/low",
    ].join("\n");
  }

  function buildPlaceAnalysisPrompt(input) {
    var city = String(input.city || "");
    var country = String(input.country || "");
    var places = Array.isArray(input.places) ? input.places : [];
    var days = Number(input.totalDays || 1);

    return [
      "你是资深旅行规划师。用户只听说过景点名字，请帮助其快速了解每个景点。",
      "请只返回 JSON，不要返回 markdown。",
      "JSON schema:",
      "{",
      '  "summary": "一句话总结",',
      '  "placeSpotlights": [',
      '    {"name":"景点名","introduction":"景点介绍","highlights":"核心看点","suggestedVisitRange":"2-3小时","suggestedDurationMin":120,"priority":"high|medium|low","tips":"小贴士"}',
      "  ],",
      '  "places": [',
      '    {"name":"景点名","suggestedDurationMin":120,"priority":"high|medium|low","reason":"简短理由"}',
      "  ]",
      "}",
      "",
      "规则：",
      "1) suggestedDurationMin 必须是分钟整数，范围 30-480。",
      "2) priority 只能是 high/medium/low。",
      "3) reason 15-50字，突出真实游玩耗时因素（排队、展馆规模、交通）。",
      "",
      "输入：",
      "国家: " + country,
      "城市: " + city,
      "游玩天数: " + days,
      "景点：",
      places.map(function (p, idx) {
        return (idx + 1) + ". " + p.name + (p.address ? (" | " + p.address) : "");
      }).join("\n"),
    ].join("\n");
  }

  var exportsObj = {
    buildPlaceAnalysisPrompt: buildPlaceAnalysisPrompt,
    buildAgentSystemPrompt: buildAgentSystemPrompt,
    buildAgentUserPrompt: buildAgentUserPrompt,
    parseAnalysisJson: parseAnalysisJson,
    parseAgentPlanJson: parseAgentPlanJson,
    toInsightMap: toInsightMap,
    normalizeName: normalizeName,
    detectProviderByBaseUrl: detectProviderByBaseUrl,
    getProviderModels: getProviderModels,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof globalScope !== "undefined") {
    globalScope.TravelLlm = exportsObj;
  }
}(typeof window !== "undefined" ? window : global));
