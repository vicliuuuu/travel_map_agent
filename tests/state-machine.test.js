const test = require("node:test");
const assert = require("node:assert/strict");
const stateMachine = require("../state-machine.js");
const repair = require("../repair.js");

test("runStateMachine walks a linear flow to terminal", async () => {
  const states = {
    a: { action: (ctx) => { ctx.seen.push("a"); return { next: "b" }; } },
    b: { action: (ctx) => { ctx.seen.push("b"); return { next: "done" }; } },
    done: { action: (ctx) => { ctx.seen.push("done"); return { status: "ok" }; } },
  };
  const ctx = { seen: [] };
  const result = await stateMachine.runStateMachine({
    states,
    context: ctx,
    start: "a",
    terminals: ["done"],
  });
  assert.equal(result.finalState, "done");
  assert.deepEqual(result.path, ["a", "b", "done"]);
  assert.deepEqual(ctx.seen, ["a", "b", "done"]);
});

test("runStateMachine rejects illegal transition to undefined state", async () => {
  const states = {
    a: { action: () => ({ next: "ghost" }) },
  };
  await assert.rejects(
    () => stateMachine.runStateMachine({ states, context: {}, start: "a", terminals: ["end"] }),
    /非法状态跳转/
  );
});

test("runStateMachine rejects missing start state", async () => {
  await assert.rejects(
    () => stateMachine.runStateMachine({ states: {}, context: {}, start: "nope", terminals: [] }),
    /合法起始状态/
  );
});

test("runStateMachine guards against infinite loops", async () => {
  const states = {
    a: { action: () => ({ next: "b" }) },
    b: { action: () => ({ next: "a" }) },
  };
  await assert.rejects(
    () => stateMachine.runStateMachine({ states, context: {}, start: "a", terminals: ["end"], maxTransitions: 6 }),
    /疑似环路/
  );
});

test("runStateMachine emits state_enter/exit via tracer", async () => {
  const events = [];
  const fakeTracer = {
    stateEnter: (stage) => events.push("enter:" + stage),
    stateExit: (stage, status) => events.push("exit:" + stage + ":" + status),
  };
  const states = {
    a: { action: () => ({ next: "done" }) },
    done: { action: () => ({ status: "ok" }) },
  };
  await stateMachine.runStateMachine({
    states,
    context: {},
    start: "a",
    terminals: ["done"],
    tracer: fakeTracer,
  });
  assert.deepEqual(events, ["enter:a", "exit:a:ok", "enter:done", "exit:done:ok"]);
});

test("verify<->repair cycle converges to fallback when never improving", async () => {
  // 模拟一个「无论怎么修都不可行」的样例，验证一定在上限内终止于 fallback
  const MAX = 3;
  const N = 2;
  const states = {
    verify: {
      action: (ctx) => {
        ctx.scoreHistory.push(100); // 分数恒定，无改善
        const stop = repair.shouldStopRepair({
          round: ctx.round,
          maxRounds: MAX,
          scoreHistory: ctx.scoreHistory,
          noImproveLimit: N,
        });
        if (stop.stop) {
          ctx.stopReason = stop.reason;
          return { next: "fallback" };
        }
        return { next: "repair" };
      },
    },
    repair: {
      action: (ctx) => {
        ctx.round += 1;
        return { next: "verify" };
      },
    },
    fallback: { action: (ctx) => ({ status: "ok" }) },
  };
  const ctx = { scoreHistory: [], round: 0, stopReason: null };
  const result = await stateMachine.runStateMachine({
    states,
    context: ctx,
    start: "verify",
    terminals: ["fallback"],
    maxTransitions: 40,
  });
  assert.equal(result.finalState, "fallback");
  assert.ok(ctx.round <= MAX, "repair rounds must not exceed MAX");
  assert.equal(ctx.stopReason, "no_improvement");
});

test("state error propagates with state metadata", async () => {
  const states = {
    boom: { action: () => { throw new Error("炸了"); } },
  };
  await assert.rejects(
    () => stateMachine.runStateMachine({ states, context: {}, start: "boom", terminals: ["done"] }),
    (err) => {
      assert.equal(err.state, "boom");
      assert.deepEqual(err.statePath, ["boom"]);
      return true;
    }
  );
});
