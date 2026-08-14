"use strict";

// v1.7 标准评测集（内存态定义，覆盖 v1.3–v1.6 能力场景）。
//
// 范围（见 doc_auto/内测-v1.7-前瞻规划.md §0）：
// - ACTIVE：定义标准场景 case + 每个 case 的「期望」，供单次跑通并计算当次指标。
// - PENDING（本文件不做）：baseline 留存、跨次对比、准入门禁——依赖持久化存储。
//
// 每个 case：
//   id / name / description：场景标识。
//   input：规划请求体（形状与 POST /api/agent/plan 一致；真实运行需注入 runOne）。
//   expect：期望（仅用于「本次报告」标注是否符合预期，NON-GATING，不拦截、不留存）。

var EVAL_CASES = [
  {
    id: "cross-country-city",
    name: "跨国跨城",
    description: "多国家/多城市，考察跨城分天与交通分段。",
    input: {
      destinations: [
        { country: "Denmark", city: "Copenhagen" },
        { country: "Sweden", city: "Malmö" },
      ],
      totalDays: 3,
      places: [
        { name: "Nyhavn", declaredCity: "Copenhagen", declaredCountry: "Denmark" },
        { name: "Tivoli Gardens", declaredCity: "Copenhagen", declaredCountry: "Denmark" },
        { name: "Turning Torso", declaredCity: "Malmö", declaredCountry: "Sweden" },
      ],
      lodging: { hotel: { name: "CPH Hotel", address: "Copenhagen Central" } },
      strategy: "classic",
    },
    expect: { finalStatus: "ok", violationsZero: true },
  },
  {
    id: "same-city-dense",
    name: "同城高密",
    description: "单城多点密集，考察单日体力/时间超载与打分排序。",
    input: {
      destinations: [{ country: "Japan", city: "Tokyo" }],
      totalDays: 2,
      places: [
        { name: "Senso-ji", declaredCity: "Tokyo", declaredCountry: "Japan" },
        { name: "Tokyo Skytree", declaredCity: "Tokyo", declaredCountry: "Japan" },
        { name: "Ueno Park", declaredCity: "Tokyo", declaredCountry: "Japan" },
        { name: "Akihabara", declaredCity: "Tokyo", declaredCountry: "Japan" },
        { name: "Meiji Shrine", declaredCity: "Tokyo", declaredCountry: "Japan" },
      ],
      lodging: { hotel: { name: "Tokyo Hotel", address: "Shinjuku" } },
      physicalPreference: "standard",
      strategy: "least-transfer",
    },
    expect: { finalStatus: "ok" },
  },
  {
    id: "no-lodging",
    name: "无酒店",
    description: "不提供酒店，考察无酒店闭环退化。",
    input: {
      destinations: [{ country: "France", city: "Paris" }],
      totalDays: 1,
      places: [
        { name: "Eiffel Tower", declaredCity: "Paris", declaredCountry: "France" },
        { name: "Louvre Museum", declaredCity: "Paris", declaredCountry: "France" },
      ],
      lodging: null,
      strategy: "fastest",
    },
    expect: { finalStatus: "ok" },
  },
  {
    id: "time-overload",
    name: "超载兜底",
    description: "天数明显不足以容纳景点，考察超载修复与兜底。",
    input: {
      destinations: [{ country: "Italy", city: "Rome" }],
      totalDays: 1,
      places: [
        { name: "Colosseum", declaredCity: "Rome", declaredCountry: "Italy" },
        { name: "Vatican Museums", declaredCity: "Rome", declaredCountry: "Italy" },
        { name: "Trevi Fountain", declaredCity: "Rome", declaredCountry: "Italy" },
        { name: "Roman Forum", declaredCity: "Rome", declaredCountry: "Italy" },
        { name: "Pantheon", declaredCity: "Rome", declaredCountry: "Italy" },
        { name: "Borghese Gallery", declaredCity: "Rome", declaredCountry: "Italy" },
      ],
      physicalPreference: "easy",
      strategy: "classic",
    },
    expect: { finalStatusIn: ["ok", "fallback"] },
  },
  {
    id: "multi-hotel",
    name: "换酒店",
    description: "多酒店按日闭环（含换酒店日行李转移）。",
    input: {
      destinations: [
        { country: "Japan", city: "Osaka" },
        { country: "Japan", city: "Kyoto" },
      ],
      totalDays: 4,
      places: [
        { name: "Osaka Castle", declaredCity: "Osaka", declaredCountry: "Japan" },
        { name: "Dotonbori", declaredCity: "Osaka", declaredCountry: "Japan" },
        { name: "Fushimi Inari", declaredCity: "Kyoto", declaredCountry: "Japan" },
        { name: "Kinkaku-ji", declaredCity: "Kyoto", declaredCountry: "Japan" },
      ],
      lodging: {
        hotels: [
          { name: "Osaka Hotel", address: "Namba", checkInDate: "2026-05-01", checkOutDate: "2026-05-03" },
          { name: "Kyoto Hotel", address: "Kyoto Station", checkInDate: "2026-05-03", checkOutDate: "2026-05-05" },
        ],
      },
      strategy: "least-transfer",
    },
    expect: { finalStatus: "ok" },
  },
];

module.exports = { EVAL_CASES: EVAL_CASES };
