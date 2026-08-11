const test = require("node:test");
const assert = require("node:assert/strict");
const server = require("../server.js");

const decideDayPlan = server.decideDayPlan;

function places(names) {
  return names.map((n) => ({ name: n }));
}

test("gap == 0: single plan by user days, no conflict", () => {
  const result = decideDayPlan(
    { naturalDays: 2, requestedDays: 2, compactPlaces: places(["A", "B"]) },
    places(["A", "B"])
  );
  assert.equal(result.dayConflict.type, "none");
  assert.equal(result.primary.days, 2);
  assert.deepEqual(result.primary.order, ["A", "B"]);
  assert.deepEqual(result.primary.dropped, []);
  assert.equal(result.secondary, null);
  assert.equal(result.primary.label, "");
});

test("gap > 1 (needs more days): trust LLM, keep all places, no drop", () => {
  const result = decideDayPlan(
    { naturalDays: 5, requestedDays: 2, compactPlaces: places(["A", "B"]) },
    places(["A", "B", "C", "D", "E"])
  );
  assert.equal(result.dayConflict.type, "llm_primary");
  assert.equal(result.primary.days, 5);
  assert.deepEqual(result.primary.order, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(result.primary.dropped, []);
  assert.equal(result.secondary, null);
});

test("gap > 1 (needs fewer days): trust LLM, compress days", () => {
  const result = decideDayPlan(
    { naturalDays: 1, requestedDays: 3, compactPlaces: places(["A", "B"]) },
    places(["A", "B"])
  );
  assert.equal(result.dayConflict.type, "llm_primary");
  assert.equal(result.primary.days, 1);
  assert.equal(result.secondary, null);
});

test("gap == 1 (needs one more day): dual plans, plan A drops to fit user days", () => {
  const result = decideDayPlan(
    { naturalDays: 3, requestedDays: 2, compactPlaces: places(["A", "B"]) },
    places(["A", "B", "C"])
  );
  assert.equal(result.dayConflict.type, "dual");
  // 方案A：用户 2 天，删掉 C
  assert.equal(result.primary.days, 2);
  assert.deepEqual(result.primary.order, ["A", "B"]);
  assert.deepEqual(result.primary.dropped, ["C"]);
  assert.equal(result.primary.label, "方案A · 你的 2 天");
  // 方案B：建议 3 天，保留全部
  assert.ok(result.secondary);
  assert.equal(result.secondary.days, 3);
  assert.deepEqual(result.secondary.order, ["A", "B", "C"]);
  assert.equal(result.secondary.label, "方案B · 建议 3 天");
});

test("gap == 1 (needs one fewer day): dual plans, plan A keeps all places over user days", () => {
  const result = decideDayPlan(
    { naturalDays: 1, requestedDays: 2, compactPlaces: places(["A"]) },
    places(["A", "B", "C"])
  );
  assert.equal(result.dayConflict.type, "dual");
  // 方案A：用户 2 天，保留全部景点
  assert.equal(result.primary.days, 2);
  assert.deepEqual(result.primary.order, ["A", "B", "C"]);
  assert.deepEqual(result.primary.dropped, []);
  // 方案B：建议 1 天，紧凑
  assert.equal(result.secondary.days, 1);
  assert.deepEqual(result.secondary.order, ["A", "B", "C"]);
});

// v1.5.2 #2：用户级 visitMinutes 兜底
test("applyDefaultVisitDuration fills only places without explicit duration (#2)", () => {
  const list = [
    { name: "有LLM时长", suggestedDurationMin: 200 },
    { name: "既有durationMin", durationMin: 45 },
    { name: "缺时长" },
    { name: "非法时长", suggestedDurationMin: 0 },
  ];
  server.applyDefaultVisitDuration(list, 120);
  assert.equal(list[0].suggestedDurationMin, 200);
  assert.equal(list[0].durationMin, undefined); // 未覆盖已有 LLM 建议
  assert.equal(list[1].durationMin, 45);
  assert.equal(list[2].durationMin, 120); // 回填
  assert.equal(list[3].durationMin, 120); // 非法(0)视为缺失，回填
});

test("applyDefaultVisitDuration clamps to [30,480] and no-ops on invalid fallback (#2)", () => {
  const tooBig = [{ name: "x" }];
  server.applyDefaultVisitDuration(tooBig, 9999);
  assert.equal(tooBig[0].durationMin, 480);

  const tooSmall = [{ name: "x" }];
  server.applyDefaultVisitDuration(tooSmall, 5);
  assert.equal(tooSmall[0].durationMin, 30);

  const untouched = [{ name: "x" }];
  server.applyDefaultVisitDuration(untouched, null);
  assert.equal(untouched[0].durationMin, undefined);
});

// v1.5.2 #1：有界并发映射保序 + 不吞异常
test("mapWithConcurrency preserves order and caps in-flight count (#1)", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [10, 40, 20, 5, 30, 15];
  const out = await server.mapWithConcurrency(items, 2, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, n));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [20, 80, 40, 10, 60, 30]); // 保序
  assert.ok(maxInFlight <= 2, "并发不超过 limit=2，实际 " + maxInFlight);
});

test("mapWithConcurrency rethrows (no silent failure) (#1)", async () => {
  await assert.rejects(
    server.mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) {
        throw new Error("boom");
      }
      return n;
    }),
    /boom/
  );
});
