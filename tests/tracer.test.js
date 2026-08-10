const test = require("node:test");
const assert = require("node:assert/strict");
const tracer = require("../tracer.js");

test("createTracer emits structured events with schema fields", () => {
  const t = tracer.createTracer({ traceId: "trace-1", requestId: "req-1" });
  t.stateEnter("verify");
  t.stateExit("verify", "ok");
  t.validation({ code: "TIME_OVERLOAD", level: "error", pass: false, message: "超载", evidence: { day: 1 } });
  const snap = t.snapshot();
  assert.equal(snap.traceId, "trace-1");
  assert.equal(snap.schemaVersion, tracer.SCHEMA_VERSION);
  assert.equal(snap.eventCount, 3);
  const first = snap.events[0];
  assert.equal(first.eventType, "state_enter");
  assert.equal(first.stage, "verify");
  assert.equal(typeof first.ts, "number");
});

test("summarizePayload trims long strings and large arrays", () => {
  const long = "x".repeat(1000);
  const out = tracer.summarizePayload({ text: long, list: [1, 2, 3, 4, 5], flag: true });
  assert.ok(out.text.length < 1000);
  assert.equal(out.list.type, "array");
  assert.equal(out.list.length, 5);
  assert.equal(out.flag, true);
});

test("recordTrace and getLastTrace round-trip the latest snapshot", () => {
  const t = tracer.createTracer();
  t.emit({ stage: "finalize", eventType: "state_exit", status: "ok" });
  tracer.recordTrace(t);
  const last = tracer.getLastTrace();
  assert.equal(last.traceId, t.traceId);
  assert.ok(last.eventCount >= 1);
});

test("withTrace records a tool_call event on success", async () => {
  const t = tracer.createTracer();
  const value = await t.withTrace("geocode", () => Promise.resolve(42), { city: "Paris" });
  assert.equal(value, 42);
  const snap = t.snapshot();
  const toolEvent = snap.events.find((e) => e.eventType === "tool_call");
  assert.ok(toolEvent);
  assert.equal(toolEvent.payload.ok, true);
});
