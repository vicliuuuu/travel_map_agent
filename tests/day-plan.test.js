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
