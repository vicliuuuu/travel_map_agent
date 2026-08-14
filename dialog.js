"use strict";

// v2.0（变体 A）对话状态机决策层（纯函数，无副作用）。
//
// 定位（见 doc_auto/内测-v2.0-实施方案.md §4）：给定「当前对话状态 + 已合并草稿 + 澄清计数 + 是否已确认」，
// 决定下一步动作（ask / confirm / present / refine）。抽取（LLM）与规划/重算（网络）在 server 侧执行，
// 本模块只做「聊到哪」的决策，保持可单测、不依赖网络。

var intake = require("./intake.js");

var DIALOG_STATES = ["greet", "gather", "clarify", "confirm", "present", "refine"];

function buildGreeting() {
  return [
    "你好，我是你的旅行规划助手。用大白话告诉我你的行程就行，比如：",
    "「下个月去东京玩4天，想去浅草寺、teamLab、上野公园，带着老人节奏慢一点」。",
    "我会问几个关键问题，然后直接帮你排好路书。（API 已在下方表单填好即可，我不会问密钥）",
  ].join("\n");
}

// 结构化确认语：把草稿讲回给用户，附默认假设。
function buildConfirmSummary(draft) {
  var d = draft || {};
  var defaults = intake.applyDefaults(d);
  var lines = ["我理解你的需求是这样，对吗？"];

  var destText = (d.destinations || []).map(function (x) {
    return [x.country, x.city].filter(Boolean).join(" ");
  }).filter(Boolean).join("、");
  if (destText) {
    lines.push("· 目的地：" + destText);
  }
  var placeText = (d.places || []).map(function (p) { return p.name; }).join("、");
  if (placeText) {
    lines.push("· 景点：" + placeText);
  }
  if (intake.missingRequired(d).indexOf("totalDays") < 0) {
    lines.push("· 天数：" + d.totalDays + " 天");
  }
  if ((d.hotels || []).length) {
    lines.push("· 酒店：" + d.hotels.map(function (h) { return h.name || h.address; }).join("、"));
  }
  if (defaults.assumptions.length) {
    lines.push("· 其余按默认：" + defaults.assumptions.join("；"));
  }
  lines.push("确认无误就点「确认并规划」，或继续补充修改。");
  return lines.join("\n");
}

// 核心决策：纯函数。输入已「抽取并合并后」的草稿。
// 参数：
//   dialogState   当前对话状态
//   draft         已合并草稿
//   clarifyCount  已提出的澄清问题数（用于澄清预算）
//   confirmed     客户端是否已点「确认并规划」
//   budget        澄清预算上限
//   hasPlan       是否已有一次规划结果（用于 present→refine 判定）
// 返回：{ action, nextState, question?, triggeredBy?, missing?, summaryNeeded? }
function runDialogTurn(input) {
  var opts = input || {};
  var draft = opts.draft || intake.emptyDraft();
  var budget = Number(opts.budget) || intake.DEFAULT_CLARIFY_BUDGET;
  var clarifyCount = Number(opts.clarifyCount) || 0;

  // 已有规划 + 用户又发消息 → 进入 refine（对话内修改）。
  if (opts.hasPlan && !opts.confirmed) {
    return { action: "refine", nextState: "refine" };
  }

  // 用户已确认 → 出行程。
  if (opts.confirmed) {
    if (!intake.isRequiredComplete(draft)) {
      // 兜底：确认但必填仍缺，回到澄清（不硬规划）。
      var stillMissing = intake.missingRequired(draft);
      return {
        action: "ask",
        nextState: "clarify",
        question: (intake.decideClarify(draft, 0, budget).question) || "还差一点信息",
        triggeredBy: stillMissing[0],
        missing: stillMissing,
      };
    }
    return { action: "present", nextState: "present" };
  }

  // 常规：必填缺失且未超预算 → 追问；否则 → 结构化确认。
  var clar = intake.decideClarify(draft, clarifyCount, budget);
  if (clar.shouldAsk) {
    return {
      action: "ask",
      nextState: "clarify",
      question: clar.question,
      triggeredBy: clar.triggeredBy,
      missing: clar.missing,
    };
  }
  return {
    action: "confirm",
    nextState: "confirm",
    missing: intake.missingRequired(draft),
    summaryNeeded: true,
  };
}

module.exports = {
  DIALOG_STATES: DIALOG_STATES,
  buildGreeting: buildGreeting,
  buildConfirmSummary: buildConfirmSummary,
  runDialogTurn: runDialogTurn,
};
