// Karnex Careers page helpers (3 Nov 2026). Run: node --test scripts/tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProblems, cleanSource, filterPositions, jdBlocks, openingsText, popularSkills,
  positionLink, postedText,
} from "../../frontend/js/careers_logic.js";

const P = [
  { id: 1, code: "REQ-1", title: "AUTOSAR Developer", city: "Pune", location: "Pune, MH", summary: "BSW",
    skills: [{ name: "AUTOSAR", must: true }, { name: "CAN", must: false }] },
  { id: 2, code: "REQ-2", title: "Android Developer", city: "Bengaluru", location: "Bengaluru",
    skills: [{ name: "Kotlin", must: true }, { name: "CAN", must: false }] },
];

test("filters by location and by every keyword", () => {
  assert.deepEqual(filterPositions(P, { city: "Pune" }).map((p) => p.id), [1]);
  assert.deepEqual(filterPositions(P, { q: "can" }).map((p) => p.id), [1, 2]);
  assert.deepEqual(filterPositions(P, { q: "kotlin developer" }).map((p) => p.id), [2]);
  assert.deepEqual(filterPositions(P, { city: "Pune", q: "kotlin" }), []);
});

test("popular skills weigh must-haves", () => {
  assert.deepEqual(popularSkills(P, 2), ["AUTOSAR", "CAN"]);
});

test("the RMG JD becomes headings, paragraphs and lists", () => {
  const b = jdBlocks("We build ECUs.\nFor OEMs.\n\nResponsibilities:\n- Configure BSW\n• Debug on target\n1. Review code");
  assert.deepEqual(b, [
    { type: "p", text: "We build ECUs. For OEMs." },
    { type: "h", text: "Responsibilities" },
    { type: "ul", items: ["Configure BSW", "Debug on target", "Review code"] },
  ]);
  assert.deepEqual(jdBlocks(""), []);
});

test("words for counts and dates", () => {
  assert.equal(openingsText(1), "1 opening");
  assert.equal(openingsText(3), "3 openings");
  const now = new Date(2026, 10, 3, 15);
  assert.equal(postedText("2026-11-03", now), "Posted today");
  assert.equal(postedText("2026-11-02", now), "Posted yesterday");
  assert.equal(postedText("2026-10-30", now), "Posted 4 days ago");
  assert.equal(postedText(null, now), "");
});

test("the apply form says what is missing", () => {
  const file = { name: "cv.pdf", size: 2000 };
  const ok = { candidate_name: "Asha Rao", email: "a@b.in", phone: "+91 98765 43210", experience: "4",
    notice_period: "30 days", current_location: "Pune", file, consent: true };
  assert.deepEqual(applyProblems(ok), []);
  assert.deepEqual(applyProblems({ ...ok, email: "x", consent: false }), ["a valid email", "your consent to be contacted"]);
  assert.deepEqual(applyProblems({ ...ok, file: { name: "cv.exe", size: 1 } }), ["a PDF or Word resume"]);
  // A general application asks less.
  assert.deepEqual(applyProblems({ ...ok, experience: "", notice_period: "", current_location: "" }, { general: true }), []);
});

test("the source survives sharing, cleaned", () => {
  assert.equal(cleanSource("LinkedIn"), "linkedin");
  assert.equal(cleanSource("<x>"), "x");
  assert.equal(positionLink("https://karnexgroup.com", 7, "linkedin"), "https://karnexgroup.com/careers?job=7&src=linkedin");
});

test("serving notice needs a last working day in range", async () => {
  const { applyProblems, lwdProblem, isServingNotice } = await import("../../frontend/js/careers_logic.js");
  const today = new Date(2026, 10, 3);
  assert.equal(isServingNotice("Serving notice"), true);
  assert.equal(isServingNotice("30 days"), false);
  assert.equal(lwdProblem("", today), "your last working day");
  assert.equal(lwdProblem("2026-11-28", today), null);
  assert.match(lwdProblem("2026-09-01", today), /30 days ago/);
  assert.match(lwdProblem("2027-12-01", today), /6 months/);
  const base = { candidate_name: "Asha Rao", email: "a@b.co", phone: "+91 98765 43210", experience: "4",
    current_location: "Pune", file: { name: "cv.pdf", size: 10 }, consent: true, today };
  assert.ok(applyProblems({ ...base, notice_period: "Serving notice" }).includes("your last working day"));
  assert.deepEqual(applyProblems({ ...base, notice_period: "Serving notice", last_working_day: "2026-11-20" }), []);
  assert.deepEqual(applyProblems({ ...base, notice_period: "30 days" }), []);
});

test("a position open in two cities shows under each", async () => {
  const { inLocation } = await import("../../frontend/js/careers_logic.js");
  const ps = [{ id: 1, city: "Bangalore", cities: ["Bangalore", "Chennai"] }, { id: 2, city: "Pune" }];
  assert.deepEqual(inLocation(ps, "Chennai").map((p) => p.id), [1]);
  assert.deepEqual(inLocation(ps, "pune").map((p) => p.id), [2]);
});
