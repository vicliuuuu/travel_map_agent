const test = require("node:test");
const assert = require("node:assert/strict");
const tools = require("../tools.js");
const tracer = require("../tracer.js");

test("defaultCacheKey normalizes args (order/case/space/diacritics insensitive)", () => {
  const k1 = tools.defaultCacheKey({ placeName: "  Café  Central ", date: "2026-08-11" });
  const k2 = tools.defaultCacheKey({ date: "2026-08-11", placeName: "cafe central" });
  assert.equal(k1, k2);
});

test("stampFactSource attaches source/fetchedAt/verifyState", () => {
  const out = tools.stampFactSource({ open: "09:00", close: "18:00" }, { source: "google_places" });
  assert.equal(out.open, "09:00");
  assert.equal(out.source, "google_places");
  assert.equal(out.verifyState, "verified");
  assert.ok(typeof out.fetchedAt === "string" && out.fetchedAt.length > 0);
});

test("normalizeError maps provider errors to standard enum", () => {
  assert.equal(tools.normalizeError(new Error("Request timed out")), tools.STD_ERROR_CODES.TIMEOUT);
  assert.equal(tools.normalizeError(new Error("HTTP 429 too many requests")), tools.STD_ERROR_CODES.RATE_LIMIT);
  assert.equal(tools.normalizeError(new Error("ZERO_RESULTS")), tools.STD_ERROR_CODES.NOT_FOUND);
  assert.equal(tools.normalizeError(new Error("boom")), tools.STD_ERROR_CODES.PROVIDER_ERROR);
  assert.equal(tools.normalizeError({ code: "RATE_LIMIT" }), tools.STD_ERROR_CODES.RATE_LIMIT);
});

test("invoke returns fact-stamped data and caches idempotently", async () => {
  let calls = 0;
  const registry = tools.createToolRegistry({});
  registry.register({
    name: "opening_hours",
    source: "google_places",
    invoke: (args) => {
      calls += 1;
      return Promise.resolve({ placeName: args.placeName, open: "09:00", close: "18:00" });
    },
    cacheKey: (args) => tools.normalizeArgValue(args.placeName),
  });
  const first = await registry.invoke("opening_hours", { placeName: "Louvre" });
  const second = await registry.invoke("opening_hours", { placeName: "louvre" });
  assert.equal(first.ok, true);
  assert.equal(first.cacheHit, false);
  assert.equal(first.data.source, "google_places");
  assert.equal(first.data.verifyState, "verified");
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1, "第二次相同参数应命中缓存，不再调用 provider");
});

test("disabled tool degrades (skip) without invoking provider", async () => {
  let called = false;
  const registry = tools.createToolRegistry({});
  registry.register({
    name: "weather",
    enabled: false,
    invoke: () => { called = true; return Promise.resolve({}); },
  });
  const res = await registry.invoke("weather", { city: "Paris" });
  assert.equal(res.ok, false);
  assert.equal(res.degraded, true);
  assert.equal(res.errorCode, tools.STD_ERROR_CODES.DISABLED);
  assert.equal(called, false);
});

test("non-fatal provider failure degrades to skip (unverified), not throw", async () => {
  const registry = tools.createToolRegistry({});
  registry.register({
    name: "opening_hours",
    degradeMode: tools.DEGRADE_MODES.SKIP,
    invoke: () => Promise.reject(new Error("ZERO_RESULTS")),
  });
  const res = await registry.invoke("opening_hours", { placeName: "X" });
  assert.equal(res.ok, false);
  assert.equal(res.degraded, true);
  assert.equal(res.errorCode, tools.STD_ERROR_CODES.NOT_FOUND);
});

test("conservative degrade returns fallbackData stamped unverified", async () => {
  const registry = tools.createToolRegistry({});
  registry.register({
    name: "congestion",
    degradeMode: tools.DEGRADE_MODES.CONSERVATIVE,
    fallbackData: { factor: 1.0 },
    invoke: () => Promise.reject(new Error("provider down")),
  });
  const res = await registry.invoke("congestion", { from: "A", to: "B" });
  assert.equal(res.degraded, true);
  assert.equal(res.data.factor, 1.0);
  assert.equal(res.data.verifyState, "unverified");
});

test("fatal degrade rethrows (no silent failure)", async () => {
  const registry = tools.createToolRegistry({});
  registry.register({
    name: "geocode_place",
    degradeMode: tools.DEGRADE_MODES.FATAL,
    invoke: () => Promise.reject(new Error("all geocode failed")),
  });
  await assert.rejects(() => registry.invoke("geocode_place", { placeName: "X" }));
});

test("invoke honors timeoutMs and normalizes to TIMEOUT", async () => {
  const registry = tools.createToolRegistry({});
  registry.register({
    name: "slow",
    timeoutMs: 20,
    degradeMode: tools.DEGRADE_MODES.SKIP,
    invoke: () => new Promise((resolve) => setTimeout(() => resolve({ ok: 1 }), 200)),
  });
  const res = await registry.invoke("slow", {});
  assert.equal(res.degraded, true);
  assert.equal(res.errorCode, tools.STD_ERROR_CODES.TIMEOUT);
});

test("registry emits tool_call / fact_source / tool_degrade to tracer", async () => {
  const t = tracer.createTracer();
  const registry = tools.createToolRegistry({ tracer: t });
  registry.register({
    name: "opening_hours",
    source: "google_places",
    invoke: (args) => Promise.resolve({ placeName: args.placeName, open: "09:00", close: "18:00" }),
  });
  registry.register({
    name: "weather",
    degradeMode: tools.DEGRADE_MODES.SKIP,
    invoke: () => Promise.reject(new Error("boom")),
  });
  await registry.invoke("opening_hours", { placeName: "Louvre" });
  await registry.invoke("weather", { city: "Paris" });
  const snap = t.snapshot();
  const types = snap.events.map((e) => e.eventType);
  assert.ok(types.includes("tool_call"));
  assert.ok(types.includes("fact_source"));
  assert.ok(types.includes("tool_degrade"));
});

test("built-in tools disabled when no provider fetch supplied", () => {
  const oh = tools.buildOpeningHoursTool({ enabled: true });
  const wx = tools.buildWeatherTool({ enabled: true });
  assert.equal(oh.enabled, false, "无 provider 时 opening_hours 不启用");
  assert.equal(wx.enabled, false, "无 provider 时 weather 不启用");
  const ohReady = tools.buildOpeningHoursTool({ enabled: true, fetch: () => Promise.resolve({}) });
  assert.equal(ohReady.enabled, true);
});

test("listEnabled reflects registered enabled tools", () => {
  const registry = tools.createToolRegistry({});
  registry.register(tools.buildOpeningHoursTool({ enabled: true, fetch: () => Promise.resolve({}) }));
  registry.register(tools.buildWeatherTool({ enabled: false }));
  const names = registry.listEnabled().map((t) => t.name);
  assert.deepEqual(names, ["opening_hours"]);
});

test("peakHourCongestionFactor amplifies peak windows, neutral off-peak", () => {
  assert.equal(tools.peakHourCongestionFactor(8 * 60), 1.4); // 08:00 早高峰
  assert.equal(tools.peakHourCongestionFactor(18 * 60), 1.4); // 18:00 晚高峰
  assert.equal(tools.peakHourCongestionFactor(13 * 60), 1.0); // 13:00 平峰
  assert.equal(tools.peakHourCongestionFactor(10 * 60 + 15), 1.15); // 10:15 肩部
  assert.equal(tools.peakHourCongestionFactor(NaN), 1.0);
});

test("congestion tool is functional by default via built-in heuristic (no provider)", async () => {
  const registry = tools.createToolRegistry({});
  registry.register(tools.buildCongestionTool({ enabled: true }));
  assert.equal(registry.isEnabled("congestion"), true, "无 provider 也应启用（内置启发式）");
  const res = await registry.invoke("congestion", { from: "A", to: "B", minuteOfDay: 8 * 60 });
  assert.equal(res.ok, true);
  assert.equal(res.data.factor, 1.4);
});
