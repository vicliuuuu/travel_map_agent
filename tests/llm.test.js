const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../llm.js");

test("parseAgentPlanJson supports roadbook and precautions", () => {
  const raw = JSON.stringify({
    summary: "巴黎经典一日游",
    routeStrategy: "按地理位置由西向东，避免折返",
    placeSpotlights: [
      {
        name: "卢浮宫",
        introduction: "世界著名博物馆",
        highlights: "蒙娜丽莎",
        suggestedVisitRange: "3-4小时",
        suggestedDurationMin: 210,
        priority: "high",
      },
    ],
    recommendedOrder: ["卢浮宫", "埃菲尔铁塔"],
    roadbook: [
      {
        step: 1,
        placeName: "卢浮宫",
        visitTimeRange: "3-4小时",
        visitDurationMin: 210,
        travelToNext: {
          destination: "埃菲尔铁塔",
          durationRange: "驾车约20-30分钟",
          durationMin: 25,
          distanceText: "5公里",
        },
      },
      {
        step: 2,
        placeName: "埃菲尔铁塔",
        visitTimeRange: "1-2小时",
        visitDurationMin: 90,
      },
    ],
    precautions: ["注意扒手", "提前预约门票"],
    places: [
      { name: "卢浮宫", suggestedDurationMin: 210, priority: "high", reason: "馆藏丰富" },
    ],
  });

  const parsed = llm.parseAgentPlanJson(raw);
  assert.equal(parsed.summary, "巴黎经典一日游");
  assert.equal(parsed.placeSpotlights.length, 1);
  assert.equal(parsed.roadbook.length, 2);
  assert.equal(parsed.precautions.length, 2);
  assert.deepEqual(parsed.recommendedOrder, ["卢浮宫", "埃菲尔铁塔"]);
});

test("parseAnalysisJson supports fenced json response", () => {
  const raw = [
    "```json",
    "{",
    '  "summary": "样例",',
    '  "places": [',
    '    {"name":"故宫","suggestedDurationMin":240,"priority":"high","reason":"展区大且排队时间长"}',
    "  ],",
    '  "recommendedOrder": ["故宫"]',
    "}",
    "```",
  ].join("\n");

  const parsed = llm.parseAnalysisJson(raw);
  assert.equal(parsed.places.length, 1);
  assert.equal(parsed.places[0].name, "故宫");
  assert.equal(parsed.places[0].suggestedDurationMin, 240);
  assert.equal(parsed.places[0].priority, "high");
  assert.deepEqual(parsed.recommendedOrder, ["故宫"]);
});

test("toInsightMap normalizes names and maps score", () => {
  const insights = llm.toInsightMap([
    {
      name: " 故宫 ",
      suggestedDurationMin: 260,
      priority: "high",
      reason: "景区很大",
    },
  ]);

  assert.ok(insights["故宫"]);
  assert.equal(insights["故宫"].suggestedDurationMin, 260);
  assert.equal(insights["故宫"].score, 4.9);
});

test("provider detection infers qwen and openai model lists", () => {
  const qwenProvider = llm.detectProviderByBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(qwenProvider.provider, "qwen");
  assert.ok(llm.getProviderModels("qwen").includes("qwen-plus"));

  const openaiProvider = llm.detectProviderByBaseUrl("https://api.openai.com/v1");
  assert.equal(openaiProvider.provider, "openai");
  assert.ok(llm.getProviderModels("openai").includes("gpt-4o-mini"));
});
