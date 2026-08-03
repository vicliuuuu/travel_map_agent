(function (globalScope) {
  "use strict";

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  var PROVIDER_MODELS = {
    openai: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4o", "o4-mini"],
    qwen: [
      "qwen-plus",
      "qwen-max",
      "qwen-turbo",
      "qwen-plus-latest",
      "qwen-max-latest",
      "qwen3-plus",
      "qwen3-max",
      "qwen3-32b",
    ],
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

  function parseValidation(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var timeFeasibilityRaw = source.timeFeasibility && typeof source.timeFeasibility === "object"
      ? source.timeFeasibility
      : {};
    return {
      timeFeasibility: {
        feasible: Boolean(timeFeasibilityRaw.feasible),
        requestedDays: Number(timeFeasibilityRaw.requestedDays) || null,
        suggestedDays: Number(timeFeasibilityRaw.suggestedDays) || null,
        reason: String(timeFeasibilityRaw.reason || ""),
      },
      lodgingWarnings: (Array.isArray(source.lodgingWarnings) ? source.lodgingWarnings : [])
        .map(function (item) { return String(item || "").trim(); })
        .filter(function (item) { return !!item; }),
      warnings: (Array.isArray(source.warnings) ? source.warnings : [])
        .map(function (item) { return String(item || "").trim(); })
        .filter(function (item) { return !!item; }),
      excludedPlaces: (Array.isArray(source.excludedPlaces) ? source.excludedPlaces : [])
        .map(function (item) {
          if (!item || typeof item !== "object") {
            return null;
          }
          var name = String(item.name || "").trim();
          if (!name) {
            return null;
          }
          return {
            name: name,
            declaredCity: String(item.declaredCity || ""),
            declaredCountry: String(item.declaredCountry || ""),
            reason: String(item.reason || ""),
            resolvedAddress: String(item.resolvedAddress || ""),
          };
        })
        .filter(function (item) { return !!item; }),
    };
  }

  function parseDailyPlans(rawList) {
    return (Array.isArray(rawList) ? rawList : [])
      .map(function (item, index) {
        if (!item || typeof item !== "object") {
          return null;
        }
        var segments = Array.isArray(item.segments) ? item.segments : [];
        return {
          day: Number(item.day) || (index + 1),
          date: String(item.date || ""),
          hotelName: String(item.hotelName || ""),
          segments: segments.map(function (segment) {
            if (!segment || typeof segment !== "object") {
              return null;
            }
            var type = String(segment.type || "").toLowerCase();
            if (type === "visit") {
              return {
                type: "visit",
                placeName: String(segment.placeName || ""),
                visitTimeRange: String(segment.visitTimeRange || ""),
                visitDurationMin: clampDuration(segment.visitDurationMin, 90),
              };
            }
            if (type === "transit") {
              return {
                type: "transit",
                from: String(segment.from || ""),
                to: String(segment.to || ""),
                durationRange: String(segment.durationRange || ""),
                durationMin: Number.isFinite(Number(segment.durationMin))
                  ? Math.max(1, Math.floor(Number(segment.durationMin)))
                  : null,
                distanceText: String(segment.distanceText || ""),
                note: String(segment.note || ""),
              };
            }
            return null;
          }).filter(function (segment) { return !!segment; }),
        };
      })
      .filter(function (item) { return !!item; });
  }

  function parseLodgingSummary(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    return {
      hotelName: String(source.hotelName || ""),
      formattedAddress: String(source.formattedAddress || ""),
      checkInDate: String(source.checkInDate || ""),
      checkOutDate: String(source.checkOutDate || ""),
      nights: Number(source.nights) || null,
      note: String(source.note || ""),
    };
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
      lodgingSummary: parseLodgingSummary(parsed.lodgingSummary),
      dailyPlans: parseDailyPlans(parsed.dailyPlans),
      validation: parseValidation(parsed.validation),
      alternativeProposals: Array.isArray(parsed.alternativeProposals) ? parsed.alternativeProposals : [],
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
      lodgingSummary: agentPlan.lodgingSummary,
      dailyPlans: agentPlan.dailyPlans,
      validation: agentPlan.validation,
      alternativeProposals: agentPlan.alternativeProposals,
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
      "你必须严格基于地理工具结果与常识，不得编造预约渠道、内部可参观区域或不存在的景点事实。",
      "",
      "v1.1 规划纪律：",
      "1) 输入是 destinations（多国家/多城市）与 lodging（单酒店，可选）结构；",
      "2) 先 geocode 酒店与全部景点，再做顺序与路书；",
      "2.1) 酒店只作为位置锚点，不使用入住/退房日期参与规划；",
      "3) 景点若与其声明城市/国家不匹配，放入 validation.excludedPlaces，不得硬塞进路书；",
      "4) 每日行程必须闭环：酒店 -> 景点 -> ... -> 酒店；",
      "5) 先忽略用户填写的 totalDays，先基于真实路程与游览时长给出自然可行天数；",
      "6) 再与用户 totalDays 对比：若用户天数偏少，必须删减景点并给出替代方案；若用户天数偏多，允许压缩天数；",
      "7) 对时间不可行方案必须给出 validation.timeFeasibility 与 alternativeProposals；",
      "8) 时间只用范围描述，不精确到具体分钟时刻。",
      "",
      "最终只输出 JSON，不要 markdown 包裹。",
    ].join("\n");
  }

  function buildAgentUserPrompt(input) {
    var city = String(input.city || "");
    var country = String(input.country || "");
    var places = Array.isArray(input.places) ? input.places : [];
    var days = Number(input.totalDays || 1);
    var destinations = Array.isArray(input.destinations) ? input.destinations : [];
    var lodging = input.lodging && typeof input.lodging === "object" ? input.lodging : null;
    var destinationText = JSON.stringify(destinations, null, 2);
    var lodgingText = JSON.stringify(lodging || {}, null, 2);

    return [
      "请为以下旅行需求生成 v1.1 智能路书。",
      "",
      "【输入结构】",
      "destinations（多国家/多城市）:",
      destinationText,
      "",
      "lodging（v1.1 单酒店，可选）:",
      lodgingText,
      "",
      "兼容字段（旧版）:",
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
      "- 若提供酒店，则先 geocode 酒店",
      "- 对每个景点调用 geocode_place（placeName 必填，可附 placeAddress）",
      "- 若提供酒店，每天应包含 酒店->首站 与 末站->酒店 的 get_travel_time",
      "- 按你判断的顺序，对相邻景点调用 get_travel_time 获取真实驾驶时长",
      "- 若某段路程查询失败，在路书中注明并给出保守估计",
      "",
      "【规划策略（v1.1）】",
      "- 核心策略：尽量不走回头路，减少折返",
      "- 可综合地理聚类、跨城交通成本、酒店往返成本，但必须在 routeStrategy 中解释",
      "- 行程天数评估只以 totalDays 与景点/路程为准，不依赖酒店入住退房日期",
      "- 先做“自然可行规划”：暂时忽略用户 totalDays，先求一个真实可执行版本",
      "- 再做“天数对齐”：将自然可行规划与用户 totalDays 对比后再调整",
      "- 时间超载时不得硬输出看似完整但不可执行的路书",
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
      '  "lodgingSummary": {',
      '    "hotelName": "酒店名",',
      '    "formattedAddress": "酒店解析地址",',
      '    "checkInDate": "",',
      '    "checkOutDate": "",',
      '    "nights": null,',
      '    "note": "全程固定入住，每日返回酒店"',
      "  },",
      '  "dailyPlans": [',
      "    {",
      '      "day": 1,',
      '      "date": "YYYY-MM-DD",',
      '      "hotelName": "酒店名",',
      '      "segments": [',
      '        {"type":"transit","from":"酒店","to":"景点A","durationRange":"约20-30分钟","durationMin":25},',
      '        {"type":"visit","placeName":"景点A","visitTimeRange":"建议2-3小时","visitDurationMin":150},',
      '        {"type":"transit","from":"景点A","to":"酒店","durationRange":"约25-35分钟","durationMin":30}',
      "      ]",
      "    }",
      "  ],",
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
      '  "validation": {',
      '    "timeFeasibility": {"feasible": true, "requestedDays": 3, "suggestedDays": 3, "reason": "..."},',
      '    "lodgingWarnings": ["跨城日往返较远"],',
      '    "excludedPlaces": [',
      '      {"name":"景点X","declaredCity":"Beijing","declaredCountry":"China","reason":"解析地址在天津","resolvedAddress":"..."}',
      "    ],",
      '    "warnings": ["事实待核实提醒"]',
      "  },",
      '  "alternativeProposals": [',
      '    {"title":"方案A","days":2,"places":["A","B"],"summary":"..."}',
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
      "- dailyPlans 必须覆盖全部游玩日；若提供酒店则每天首段来自酒店、末段返回酒店",
      "- 必须先输出自然可行建议天数（suggestedDays），再判断是否需要删减景点或压缩天数",
      "- validation.excludedPlaces 里的景点不得出现在 recommendedOrder 与 roadbook",
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
