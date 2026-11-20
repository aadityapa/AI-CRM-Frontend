// Anti-cheating checks (13 Nov 2026): node --test scripts/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GestureHold,
  LightMonitor,
  ReadingDetector,
  calibrate,
  dbAbove,
  fingerCount,
  gestureMatches,
  goertzelPower,
  headphonePlan,
  headphoneVerdict,
  isOpenPalm,
  isThumbsUp,
  lightingVerdict,
  meanLuma,
  normalizeProctoring,
  outputLabelHint,
  pickPromptTurns,
  randomGesture,
} from "../../frontend/js/proctoring_logic.js";

const seeded = (seed = 7) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

test("settings: a missing block is all off; pre-checks follow the switches", () => {
  assert.equal(normalizeProctoring(null).enabled, false);
  const p = normalizeProctoring({ headphones: "require", lighting: "loud", gesture_check: true, gesture_prompts: 9, gaze_calibration: true });
  assert.deepEqual(p.pre_checks, ["headphones", "gesture", "gaze_calibration"]);
  assert.equal(p.lighting, "off");
  assert.equal(p.gesture_prompts, 5);
  assert.equal(p.enabled, true);
});

test("headphones: the microphone hearing the tone means speakers", () => {
  const sr = 48000;
  const tone = Float32Array.from({ length: 4096 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 1750 * i) / sr));
  const quiet = new Float32Array(4096).fill(0.0001);
  assert.ok(goertzelPower(tone, sr, 1750) > goertzelPower(quiet, sr, 1750) * 1000);
  assert.ok(dbAbove(goertzelPower(tone, sr, 1750), goertzelPower(quiet, sr, 1750)) > 30);
  assert.equal(headphoneVerdict({ leakDb: [2, 3], heard: 2, played: 2 }).ok, true);
  assert.equal(headphoneVerdict({ leakDb: [2, 22], heard: 2, played: 2 }).reason, "speaker_leak");
  assert.equal(headphoneVerdict({ leakDb: [1], heard: 3, played: 2 }).reason, "wrong_count");
  assert.equal(outputLabelHint(["audiooutput:Headphones (Realtek)"]), "headset");
  assert.equal(outputLabelHint(["Speakers (High Definition Audio)"]), "speakers");
  const plan = headphonePlan(seeded());
  assert.ok(plan.count >= 2 && plan.count <= 4 && plan.tones.length === plan.count);
});

test("lighting: dark, backlit and good", () => {
  assert.equal(lightingVerdict({ face: 30, frame: 40 }).reason, "too_dark");
  assert.equal(lightingVerdict({ face: 80, frame: 190 }).reason, "backlit");
  assert.equal(lightingVerdict({ face: 140, frame: 200 }).ok, true);
  assert.equal(lightingVerdict({ face: null, frame: 90 }).reason, "no_face");
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  assert.ok(Math.abs(meanLuma(rgba, 4, 4) - 255) < 0.5);
  const lm = new LightMonitor({ holdMs: 1000, cooldownMs: 5000 });
  assert.equal(lm.feed(0, { ok: false, reason: "too_dark", detail: "x" }), null);
  assert.equal(lm.feed(1200, { ok: false, reason: "too_dark", detail: "x" }).type, "low_light");
  assert.equal(lm.feed(1500, { ok: false, reason: "too_dark", detail: "x" }), null);
});

/** A synthetic hand: wrist at the bottom, fingers pointing up when `up`. */
function hand(ext = { thumb: true, index: true, middle: true, ring: true, pinky: true }, thumbUp = false) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  lm[0] = { x: 0.5, y: 0.9 };
  const fingers = [[5, 6, 7, 8, 0.42, "index"], [9, 10, 11, 12, 0.5, "middle"], [13, 14, 15, 16, 0.58, "ring"], [17, 18, 19, 20, 0.66, "pinky"]];
  for (const [mcp, pip, dip, tip, x, name] of fingers) {
    lm[mcp] = { x, y: 0.7 };
    lm[pip] = { x, y: 0.6 };
    lm[dip] = ext[name] ? { x, y: 0.5 } : { x, y: 0.65 };
    lm[tip] = ext[name] ? { x, y: 0.4 } : { x, y: 0.72 };
  }
  lm[1] = { x: 0.4, y: 0.85 };
  lm[2] = { x: 0.33, y: 0.8 };
  lm[3] = { x: 0.28, y: 0.75 };
  lm[4] = ext.thumb ? (thumbUp ? { x: 0.36, y: 0.45 } : { x: 0.2, y: 0.7 }) : { x: 0.4, y: 0.74 };
  return lm;
}

test("gestures: fingers, palms and a thumbs up", () => {
  const open = hand();
  assert.equal(isOpenPalm(open), true);
  assert.equal(fingerCount(open), 5);
  const three = hand({ thumb: false, index: true, middle: true, ring: true, pinky: false });
  assert.equal(fingerCount(three), 3);
  assert.equal(gestureMatches({ kind: "fingers", n: 3 }, [three]), true);
  assert.equal(gestureMatches({ kind: "fingers", n: 2 }, [three]), false);
  assert.equal(gestureMatches({ kind: "palms" }, [open]), false);
  assert.equal(gestureMatches({ kind: "palms" }, [open, hand()]), true);
  const thumbs = hand({ thumb: true, index: false, middle: false, ring: false, pinky: false }, true);
  assert.equal(isThumbsUp(thumbs), true);
  assert.equal(gestureMatches({ kind: "thumbs_up" }, [thumbs]), true);
  const hold = new GestureHold({ kind: "fingers", n: 3 }, 800);
  assert.equal(hold.feed(0, [three]), false);
  assert.equal(hold.feed(500, [open]), false); // broken → starts again
  assert.equal(hold.feed(600, [three]), false);
  assert.equal(hold.feed(1500, [three]), true);
  const g = randomGesture(seeded(3), { kind: "thumbs_up" });
  assert.notEqual(g.kind, "thumbs_up");
});

test("prompt turns: never the first question, at most total-1, sorted", () => {
  const turns = pickPromptTurns(3, 8, seeded(11));
  assert.equal(turns.length, 3);
  assert.ok(turns.every((t) => t >= 2 && t <= 8));
  assert.deepEqual(turns, [...turns].sort((a, b) => a - b));
  assert.deepEqual(pickPromptTurns(5, 1), []);
});

test("calibration: the candidate's own screen range, clamped", () => {
  const at = (yaw, pitch, eyeSide, eyeDown) => Array.from({ length: 5 }, () => ({ yaw, pitch, eyeSide, eyeDown }));
  const cal = calibrate({
    center: at(0, 0.5, 0, 0.1),
    top_left: at(-0.2, 0.45, -0.4, 0.05),
    top_right: at(0.2, 0.45, 0.4, 0.05),
    bottom_right: at(0.2, 0.62, 0.4, 0.3),
    bottom_left: at(-0.2, 0.62, -0.4, 0.3),
  });
  assert.ok(cal && cal.dots === 5);
  assert.ok(Math.abs(cal.cfg.yaw - 0.27) < 0.01);
  assert.ok(cal.cfg.eyeSide >= 0.3 && cal.cfg.eyeSide <= 0.75);
  assert.equal(calibrate({ center: at(0, 0.5, 0, 0.1) }), null);
});

test("reading: line-by-line sweeps raise one flag, then a cooldown", () => {
  const r = new ReadingDetector();
  let t = 0;
  let flag = null;
  for (let line = 0; line < 4 && !flag; line += 1) {
    for (const x of [-0.2, -0.1, 0, 0.1]) {
      t += 400;
      flag = r.feed(t, x) || flag;
    }
    t += 400;
    flag = r.feed(t, -0.2) || flag; // the jump back to the next line
  }
  assert.ok(flag && flag.type === "reading_pattern");
  assert.equal(r.feed(t + 400, 0.1), null);
  const calm = new ReadingDetector();
  let any = null;
  for (let i = 0; i < 40; i += 1) any = calm.feed(i * 400, Math.sin(i / 3) * 0.05) || any;
  assert.equal(any, null);
});
