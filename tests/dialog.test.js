const test = require("node:test");
const assert = require("node:assert/strict");
const dialog = require("../dialog.js");
const intake = require("../intake.js");

function fullDraft() {
  return intake.mergeConstraints(intake.emptyDraft(), {
    destinations: [{ country: "Japan", city: "Tokyo" }],
    places: [{ name: "浅草寺" }, { name: "上野公园" }],
    totalDays: 3,
  });
}

test("buildGreeting returns a non-empty intro", () => {
  const g = dialog.buildGreeting();
  assert.equal(typeof g, "string");
  assert.ok(g.length > 0);
});

test("runDialogTurn asks when required missing", () => {
  const d = dialog.runDialogTurn({ dialogState: "gather", draft: intake.emptyDraft(), clarifyCount: 0, budget: 6 });
  assert.equal(d.action, "ask");
  assert.equal(d.nextState, "clarify");
  assert.ok(d.question);
});

test("runDialogTurn confirms when required complete (not yet confirmed)", () => {
  const d = dialog.runDialogTurn({ dialogState: "gather", draft: fullDraft(), clarifyCount: 0, budget: 6 });
  assert.equal(d.action, "confirm");
  assert.equal(d.nextState, "confirm");
});

test("runDialogTurn presents when confirmed and complete", () => {
  const d = dialog.runDialogTurn({ dialogState: "confirm", draft: fullDraft(), confirmed: true, budget: 6 });
  assert.equal(d.action, "present");
  assert.equal(d.nextState, "present");
});

test("runDialogTurn falls back to ask when confirmed but still missing", () => {
  const d = dialog.runDialogTurn({ dialogState: "confirm", draft: intake.emptyDraft(), confirmed: true, budget: 6 });
  assert.equal(d.action, "ask");
});

test("runDialogTurn routes to refine when a plan already exists", () => {
  const d = dialog.runDialogTurn({ dialogState: "present", draft: fullDraft(), hasPlan: true, confirmed: false, budget: 6 });
  assert.equal(d.action, "refine");
  assert.equal(d.nextState, "refine");
});

test("runDialogTurn confirm has priority path even after budget exhausted", () => {
  // budget exhausted + missing → decideClarify won't ask → confirm
  const d = dialog.runDialogTurn({ dialogState: "gather", draft: intake.emptyDraft(), clarifyCount: 6, budget: 6 });
  assert.equal(d.action, "confirm");
});

test("buildConfirmSummary mentions destinations, places and assumptions", () => {
  const s = dialog.buildConfirmSummary(fullDraft());
  assert.match(s, /Tokyo/);
  assert.match(s, /浅草寺/);
  assert.match(s, /默认/); // assumptions line
});
