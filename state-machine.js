"use strict";

// v1.3 通用状态机引擎。
// 统一调度器：循环取当前态 → 执行 action → 依返回的 next 决定下一态，直到 finalize / fallback。
// 设计约束：
//   - 单一数据源 context 贯穿全流程；
//   - 未定义的状态跳转直接抛错（不允许隐式跳过）；
//   - 环路防护：超过 maxTransitions 抛错，避免死循环；
//   - 每次 state_enter / state_exit 通过 tracer 织入（AOP 式，避免每态手写埋点）。

function isTerminal(terminals, stateName) {
  return Array.isArray(terminals) && terminals.indexOf(stateName) >= 0;
}

async function runStateMachine(config) {
  var cfg = config || {};
  var states = cfg.states || {};
  var context = cfg.context || {};
  var start = cfg.start;
  var terminals = cfg.terminals || [];
  var tracer = cfg.tracer || null;
  var maxTransitions = Number(cfg.maxTransitions) || 50;

  if (!start || !states[start]) {
    throw new Error("状态机缺少合法起始状态: " + start);
  }

  var current = start;
  var path = [];
  var transitions = 0;

  while (true) {
    transitions += 1;
    if (transitions > maxTransitions) {
      throw new Error("状态机跳转超过上限（" + maxTransitions + "），疑似环路: " + path.concat(current).join(" -> "));
    }

    var state = states[current];
    if (!state || typeof state.action !== "function") {
      throw new Error("未定义状态或缺少 action: " + current);
    }
    path.push(current);

    if (tracer) {
      tracer.stateEnter(current);
    }

    var result;
    var status = "ok";
    try {
      result = await state.action(context);
      status = (result && result.status) || "ok";
    } catch (err) {
      if (tracer) {
        tracer.stateExit(current, "error");
      }
      // 无静默失败：状态执行异常直接上抛，由调用方决定兜底
      err.state = current;
      err.statePath = path.slice();
      throw err;
    }

    if (tracer) {
      tracer.stateExit(current, status);
    }

    if (isTerminal(terminals, current)) {
      break;
    }

    var next = result && result.next;
    if (!next) {
      throw new Error("状态 " + current + " 未返回下一状态（next 缺失）");
    }
    if (!states[next] && !isTerminal(terminals, next)) {
      throw new Error("非法状态跳转: " + current + " -> " + next + "（目标状态未定义）");
    }
    current = next;
  }

  return {
    finalState: current,
    path: path,
    context: context,
  };
}

module.exports = {
  runStateMachine: runStateMachine,
};
