// Unit tests for frontend/js/camera_monitor_logic.js (13 Oct 2026).
// Run: node --test scripts/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CameraMonitorLogic, MONITOR_DEFAULTS, awayReason, faceMetrics,
} from "../../frontend/js/camera_monitor_logic.js";

/** A face that looks straight at the screen (baseline-shaped numbers). */
const onScreen = (over = {}) => ({ width: 0.3, yaw: 0, pitch: 0.55, eyeSide: 0, eyeDown: 0.1, blink: 0, hasGaze: true, ...over });

function learnt(logic, t0 = 0) {
  let t = t0;
  for (let i = 0; i < MONITOR_DEFAULTS.baselineSamples; i += 1) {
    assert.deepEqual(logic.step(t, [onScreen()]), []);
    t += 400;
  }
  assert.ok(logic.base, "baseline learnt");
  return t;
}

function runFor(logic, t, ms, faces, ctx) {
  const out = [];
  const end = t + ms;
  for (; t <= end; t += 400) out.push(...logic.step(t, faces, ctx));
  return { t, out };
}

test("a second real face is reported once it has been seen for a moment, then quietly for the cooldown", () => {
  const logic = new CameraMonitorLogic({}, 0);
  const two = [onScreen(), onScreen({ width: 0.2 })];
  let r = runFor(logic, 0, 800, two);
  assert.equal(r.out.length, 0, "not on a single glimpse");
  r = runFor(logic, r.t, 800, two);
  assert.deepEqual(r.out.map((e) => e.type), ["multiple_faces"]);
  r = runFor(logic, r.t, 10000, two);
  assert.equal(r.out.filter((e) => e.type === "multiple_faces").length, 0, "cooldown");
});

test("a tiny face in the background (a poster) is not a second person", () => {
  const logic = new CameraMonitorLogic({}, 0);
  const r = runFor(logic, 0, 5000, [onScreen(), onScreen({ width: 0.03 })]);
  assert.equal(r.out.filter((e) => e.type === "multiple_faces").length, 0);
});

test("looking down for 3 s is a soft warning; a quick glance is not", () => {
  const logic = new CameraMonitorLogic({}, 0);
  let t = learnt(logic);
  let r = runFor(logic, t, 1500, [onScreen({ eyeDown: 0.7 })]);
  assert.equal(r.out.length, 0, "a glance");
  r = runFor(logic, r.t, 2000, [onScreen()]);
  r = runFor(logic, r.t, 3200, [onScreen({ eyeDown: 0.7 })]);
  assert.deepEqual(r.out.map((e) => e.type), ["gaze_away"]);
  assert.match(r.out[0].details, /eyes looking down/);
});

test("looking down at the keyboard during a coding question does not count; turning away still does", () => {
  const logic = new CameraMonitorLogic({}, 0);
  const t = learnt(logic);
  let r = runFor(logic, t, 6000, [onScreen({ eyeDown: 0.8, pitch: 0.8 })], { typed: true });
  assert.equal(r.out.length, 0);
  r = runFor(logic, r.t, 3400, [onScreen({ yaw: 0.4 })], { typed: true });
  assert.deepEqual(r.out.map((e) => e.type), ["gaze_away"]);
});

test("looking up (thinking) never counts", () => {
  const logic = new CameraMonitorLogic({}, 0);
  const t = learnt(logic);
  const r = runFor(logic, t, 8000, [onScreen({ pitch: 0.35, eyeDown: 0 })]);
  assert.equal(r.out.length, 0);
});

test("staying away warns again only after the repeat interval; looking back re-arms after the minimum gap", () => {
  const logic = new CameraMonitorLogic({}, 0);
  let t = learnt(logic);
  let r = runFor(logic, t, 12000, [onScreen({ yaw: -0.5 })]);
  assert.equal(r.out.length, 1, "one warning in the first 12 s of one long look-away");
  r = runFor(logic, r.t, 2000, [onScreen()]);
  r = runFor(logic, r.t, 4000, [onScreen({ yaw: -0.5 })]);
  assert.equal(r.out.length, 1, "looked back, then away again → next warning");
});

test("the face leaving the camera counts as looking away, but not before the camera warmed up", () => {
  const logic = new CameraMonitorLogic({}, 0);
  let r = runFor(logic, 0, 8000, []);
  assert.equal(r.out.length, 0, "grace period before any face");
  r = runFor(logic, r.t, 9000, []);
  assert.deepEqual(r.out.map((e) => e.type), ["gaze_away"]);
  assert.match(r.out[0].details, /face not visible/);
});

test("a pause (recruiter) clears a half-built look-away", () => {
  const logic = new CameraMonitorLogic({}, 0);
  const t = learnt(logic);
  let r = runFor(logic, t, 2400, [onScreen({ yaw: 0.5 })]);
  r = runFor(logic, r.t, 400, [onScreen({ yaw: 0.5 })], { paused: true });
  r = runFor(logic, r.t, 2400, [onScreen({ yaw: 0.5 })]);
  assert.equal(r.out.length, 0);
});

test("the baseline is the candidate's own: a camera above the screen does not make every frame 'looking down'", () => {
  const logic = new CameraMonitorLogic({}, 0);
  let t = 0;
  for (let i = 0; i < MONITOR_DEFAULTS.baselineSamples; i += 1) {
    logic.step(t, [onScreen({ pitch: 0.72, eyeDown: 0.35 })]);
    t += 400;
  }
  const r = runFor(logic, t, 6000, [onScreen({ pitch: 0.74, eyeDown: 0.38 })]);
  assert.equal(r.out.length, 0);
  assert.equal(awayReason(onScreen({ pitch: 0.74 }), logic.base), null);
});

test("faceMetrics reads head turn and eye direction from landmarks + blendshapes", () => {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[33] = { x: 0.4, y: 0.4 }; // eye corners
  lm[263] = { x: 0.6, y: 0.4 };
  lm[1] = { x: 0.56, y: 0.5 }; // nose pushed toward one side
  lm[13] = { x: 0.5, y: 0.6 };
  lm[14] = { x: 0.5, y: 0.62 };
  lm[0] = { x: 0.3, y: 0.5 };
  lm[2] = { x: 0.7, y: 0.5 };
  const shapes = [
    { categoryName: "eyeLookOutLeft", score: 0.7 }, { categoryName: "eyeLookInRight", score: 0.7 },
    { categoryName: "eyeLookDownLeft", score: 0.2 }, { categoryName: "eyeLookDownRight", score: 0.4 },
  ];
  const m = faceMetrics(lm, shapes, 640, 480);
  assert.ok(Math.abs(m.yaw - 0.3) < 1e-9);
  assert.ok(m.eyeSide > 0.6);
  assert.ok(Math.abs(m.eyeDown - 0.3) < 1e-9);
  assert.ok(Math.abs(m.width - 0.4) < 1e-9);
  assert.equal(faceMetrics([], shapes, 640, 480), null);
});
