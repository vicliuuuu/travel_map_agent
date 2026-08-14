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

test("tokenUsage emits a token_usage event with numeric payload (v1.7)", () => {
  const t = tracer.createTracer();
  t.tokenUsage({ model: "gpt-4o-mini", promptTokens: 100, completionTokens: 40, totalTokens: 140, calls: 2 });
  const evt = t.snapshot().events.find((e) => e.eventType === "token_usage");
  assert.ok(evt);
  assert.equal(evt.payload.totalTokens, 140);
  assert.equal(evt.payload.calls, 2);
  assert.equal(evt.payload.model, "gpt-4o-mini");
});

test("requestSummary emits a request_summary event with final status (v1.7)", () => {
  const t = tracer.createTracer();
  t.requestSummary({ totalDurationMs: 1200, finalStatus: "fallback", repairRounds: 3, totalTokens: 500 });
  const evt = t.snapshot().events.find((e) => e.eventType === "request_summary");
  assert.ok(evt);
  assert.equal(evt.status, "warn"); // fallback maps to warn
  assert.equal(evt.durationMs, 1200);
  assert.equal(evt.payload.finalStatus, "fallback");
  assert.equal(evt.payload.repairRounds, 3);
});

test("SCHEMA_VERSION is bumped to 2.0.0", () => {
  assert.equal(tracer.SCHEMA_VERSION, "2.0.0");
});

test("dialog events emit with correct eventType (v2.0)", () => {
  const t = tracer.createTracer();
  t.dialogTurn({ turnIndex: 1, dialogState: "gather", intent: "ask" });
  t.constraintExtract({ extracted: { totalDays: 3 }, confidence: { totalDays: 0.9 }, missing: ["places"] });
  t.clarify({ question: "去哪玩？", triggeredBy: "destinations" });
  t.dialogRefine({ changeType: "remove_place", incrementalReused: 0.8 });
  t.evidenceRef({ claim: "final_itinerary", sourceEvent: "trace-x" });
  const types = t.snapshot().events.map((e) => e.eventType);
  ["dialog_turn", "constraint_extract", "clarify", "dialog_refine", "evidence_ref"].forEach((et) => {
    assert.ok(types.includes(et), "missing event: " + et);
  });
  const refine = t.snapshot().events.find((e) => e.eventType === "dialog_refine");
  assert.equal(refine.payload.incrementalReused, 0.8);
});
