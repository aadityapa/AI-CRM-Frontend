/**
 * Anti-cheating checks — the decisions, with no browser in them (13 Nov 2026).
 *
 * The template chooses the checks (B-V2 services/interview/proctoring.py):
 * headphones, lighting, a gesture check, gaze calibration, reading detection,
 * random gesture prompts and a room scan. `proctoring_checks.js`,
 * `gesture_prompts.js` and `face_detection.js` measure; THIS module decides.
 *
 * Pure: plain numbers in, plain objects out; `now` and `rng` are passed in.
 * Unit-tested from node: `node --test scripts/tests/` (F-V2 repo root).
 */

/* ------------------------------------------------------------------------- */
/* Settings                                                                    */
/* ------------------------------------------------------------------------- */

export const MODES = Object.freeze(["off", "warn", "require"]);

/** The server's `proctoring` block, normalised (a missing block = all off). */
export function normalizeProctoring(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const mode = (v) => (MODES.includes(String(v)) ? String(v) : "off");
  const n = Math.max(0, Math.min(5, Math.round(Number(src.gesture_prompts) || 0)));
  const out = {
    headphones: mode(src.headphones),
    lighting: mode(src.lighting),
    gesture_check: !!src.gesture_check,
    gesture_prompts: n,
    gaze_calibration: !!src.gaze_calibration,
    reading_detection: !!src.reading_detection,
    room_scan: !!src.room_scan,
  };
  out.pre_checks = [
    out.headphones !== "off" && "headphones",
    out.lighting !== "off" && "lighting",
    out.gesture_check && "gesture",
    out.gaze_calibration && "gaze_calibration",
  ].filter(Boolean);
  out.enabled = out.pre_checks.length > 0 || n > 0 || out.reading_detection || out.room_scan;
  return out;
}

/* ------------------------------------------------------------------------- */
/* Headphones — an acoustic loopback test                                      */
/* ------------------------------------------------------------------------- */

/** Test tones (Hz): far from mains hum and most room noise. */
export const HEADPHONE_TONES = Object.freeze([1250, 1750, 2250, 2750]);
/** The microphone hearing a tone this many dB above the room = speakers. */
export const SPEAKER_LEAK_DB = 10;

/** Power of one frequency in a block of samples (Goertzel). */
export function goertzelPower(samples, sampleRate, freq) {
  const N = samples.length;
  if (!N || !sampleRate) return 0;
  const k = Math.round((N * freq) / sampleRate);
  const w = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < N; i += 1) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.max(0, (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (N * N));
}

/** dB of `power` over `noise` (both linear), floored at 0. */
export function dbAbove(power, noise) {
  const p = Math.max(1e-12, Number(power) || 0);
  const n = Math.max(1e-12, Number(noise) || 0);
  return Math.max(0, Math.round(10 * Math.log10(p / n) * 10) / 10);
}

const HEADSET_RE = /head(phone|set)|ear(phone|bud|piece)|airpod|buds|hands[- ]?free|bluetooth|bt |wh-|wf-|jabra|bose|sennheiser|jbl|boat|realme buds|oneplus buds/i;
const SPEAKER_RE = /speaker|built[- ]?in|internal|realtek high definition audio(?!.*head)/i;

/** What the device names suggest — a hint only, never the verdict. */
export function outputLabelHint(labels) {
  const list = (Array.isArray(labels) ? labels : []).map((l) => String(l || ""));
  if (list.some((l) => HEADSET_RE.test(l))) return "headset";
  if (list.some((l) => SPEAKER_RE.test(l))) return "speakers";
  return "unknown";
}

/**
 * The verdict of one headphone test.
 * @param {{leakDb:number[], heard:number, played:number, labels?:string[]}} input
 */
export function headphoneVerdict({ leakDb, heard, played, labels = [] }) {
  const leaks = (Array.isArray(leakDb) ? leakDb : []).map((v) => Number(v) || 0);
  const maxLeak = leaks.length ? Math.max(...leaks) : 0;
  const hint = outputLabelHint(labels);
  const detail = `tone heard ${maxLeak.toFixed(1)} dB · ${hint}`;
  if (Number(heard) !== Number(played)) return { ok: false, reason: "wrong_count", detail, maxLeak, hint };
  if (maxLeak >= SPEAKER_LEAK_DB) return { ok: false, reason: "speaker_leak", detail, maxLeak, hint };
  return { ok: true, reason: "", detail, maxLeak, hint };
}

/** How many beeps to play (2–4) and which tones, in a random order. */
export function headphonePlan(rng = Math.random) {
  const count = 2 + Math.floor(rng() * 3);
  const tones = [];
  for (let i = 0; i < count; i += 1) tones.push(HEADPHONE_TONES[Math.floor(rng() * HEADPHONE_TONES.length)]);
  return { count, tones };
}

/* ------------------------------------------------------------------------- */
/* Lighting                                                                    */
/* ------------------------------------------------------------------------- */

export const LIGHT = Object.freeze({
  /** Average face brightness (0–255) below this = too dark. */
  dark: 55,
  /** The background this much brighter than the face = lit from behind… */
  backlitGap: 45,
  /** …unless the face itself is bright enough anyway. */
  backlitFaceMax: 100,
});

/** Mean luma (0–255) of an RGBA buffer, optionally inside a box (pixels). */
export function meanLuma(rgba, width, height, box = null) {
  const W = Math.max(1, width | 0);
  const H = Math.max(1, height | 0);
  const x0 = box ? Math.max(0, Math.floor(box.x)) : 0;
  const y0 = box ? Math.max(0, Math.floor(box.y)) : 0;
  const x1 = box ? Math.min(W, Math.ceil(box.x + box.w)) : W;
  const y1 = box ? Math.min(H, Math.ceil(box.y + box.h)) : H;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4;
      sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/** @param {{face:number|null, frame:number}} m  face = null when no face was found */
export function lightingVerdict({ face, frame }) {
  if (face === null || face === undefined || !Number.isFinite(Number(face))) {
    return { ok: false, reason: "no_face", level: "unknown", detail: "no face found" };
  }
  const f = Math.round(Number(face));
  const bg = Math.round(Number(frame) || 0);
  const detail = `face brightness ${f}, background ${bg}`;
  if (f < LIGHT.dark) return { ok: false, reason: "too_dark", level: "dark", detail };
  if (bg - f >= LIGHT.backlitGap && f < LIGHT.backlitFaceMax) {
    return { ok: false, reason: "backlit", level: "backlit", detail };
  }
  return { ok: true, reason: "", level: f < LIGHT.dark + 20 ? "dim" : "good", detail };
}

/** During the interview: a bad light held `holdMs` → ONE `low_light`, then quiet for `cooldownMs`. */
export class LightMonitor {
  constructor({ holdMs = 8000, cooldownMs = 60000 } = {}) {
    this.holdMs = holdMs;
    this.cooldownMs = cooldownMs;
    this.badSince = null;
    this.lastAt = -Infinity;
  }

  feed(now, verdict) {
    if (!verdict || verdict.ok || verdict.reason === "no_face") {
      this.badSince = null;
      return null;
    }
    if (this.badSince === null) this.badSince = now;
    if (now - this.badSince < this.holdMs || now - this.lastAt < this.cooldownMs) return null;
    this.lastAt = now;
    this.badSince = null;
    return { type: "low_light", details: `${verdict.reason === "backlit" ? "lit from behind" : "too dark"} (${verdict.detail})` };
  }
}

/* ------------------------------------------------------------------------- */
/* Hands and gestures (MediaPipe Hand Landmarker: 21 points per hand)          */
/* ------------------------------------------------------------------------- */

const dist = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));

/** Which fingers are stretched out — robust to the hand's rotation. */
export function extendedFingers(lm) {
  if (!Array.isArray(lm) || lm.length < 21) return null;
  const wrist = lm[0];
  const finger = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15;
  const thumb = dist(lm[4], lm[5]) > dist(lm[3], lm[5]) * 1.25 && dist(lm[4], wrist) > dist(lm[2], wrist) * 1.1;
  return { thumb, index: finger(8, 6), middle: finger(12, 10), ring: finger(16, 14), pinky: finger(20, 18) };
}

export function fingerCount(lm) {
  const f = extendedFingers(lm);
  if (!f) return 0;
  return [f.thumb, f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
}

export function isOpenPalm(lm) {
  const f = extendedFingers(lm);
  return !!f && f.index && f.middle && f.ring && f.pinky;
}

export function isThumbsUp(lm) {
  const f = extendedFingers(lm);
  if (!f || !f.thumb || f.index || f.middle || f.ring || f.pinky) return false;
  // The thumb points UP: its tip clearly above the knuckles (y grows downward).
  return lm[4].y < lm[5].y - dist(lm[0], lm[5]) * 0.35;
}

/** The gestures a candidate may be asked for. */
export const GESTURES = Object.freeze([
  { kind: "fingers", n: 1, words: "Hold up ONE finger" },
  { kind: "fingers", n: 2, words: "Hold up TWO fingers" },
  { kind: "fingers", n: 3, words: "Hold up THREE fingers" },
  { kind: "fingers", n: 4, words: "Hold up FOUR fingers" },
  { kind: "thumbs_up", words: "Give a THUMBS UP" },
]);

export const PALMS = Object.freeze({ kind: "palms", words: "Show BOTH open palms to the camera" });

/** A random gesture, never the same as `avoid` (so a retry asks something new). */
export function randomGesture(rng = Math.random, avoid = null) {
  const pool = GESTURES.filter((g) => !avoid || g.kind !== avoid.kind || g.n !== avoid.n);
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/** Do the hands on camera show `target`? `hands` = landmark arrays (one per hand). */
export function gestureMatches(target, hands) {
  const list = (Array.isArray(hands) ? hands : []).filter((h) => Array.isArray(h) && h.length >= 21);
  if (!target || !list.length) return false;
  if (target.kind === "palms") return list.length >= 2 && list.filter(isOpenPalm).length >= 2;
  if (target.kind === "thumbs_up") return list.some(isThumbsUp);
  if (target.kind === "fingers") return list.some((h) => fingerCount(h) === target.n && !isThumbsUp(h));
  return false;
}

/** Why a gesture attempt failed, from what the camera saw. */
export function gestureFailReason(target, sawHands, sawAnyMatchMs) {
  if (!sawHands) return "no_hands";
  if (target?.kind === "palms") return "palms_not_shown";
  return sawAnyMatchMs ? "timeout" : "wrong_gesture";
}

/** The gesture must be HELD this long — one lucky frame is not enough. */
export class GestureHold {
  constructor(target, holdMs = 800) {
    this.target = target;
    this.holdMs = holdMs;
    this.since = null;
    this.sawHands = false;
    this.bestMs = 0;
  }

  /** @returns {boolean} true once held long enough */
  feed(now, hands) {
    if (Array.isArray(hands) && hands.length) this.sawHands = true;
    if (gestureMatches(this.target, hands)) {
      if (this.since === null) this.since = now;
      this.bestMs = Math.max(this.bestMs, now - this.since);
      return now - this.since >= this.holdMs;
    }
    this.since = null;
    return false;
  }
}

/** Which spoken questions (1-based, warm-up excluded) carry a gesture prompt. */
export function pickPromptTurns(count, total, rng = Math.random) {
  const n = Math.max(0, Math.min(Math.round(Number(count) || 0), Math.max(0, (Number(total) || 0) - 1)));
  // Never the first question (the candidate is settling in).
  const pool = [];
  for (let i = 2; i <= Number(total) || 0; i += 1) pool.push(i);
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
  }
  return out.sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------- */
/* Gaze calibration                                                            */
/* ------------------------------------------------------------------------- */

/** The dots, as fractions of the screen. The centre first. */
export const CALIBRATION_DOTS = Object.freeze([
  { key: "center", x: 0.5, y: 0.5 },
  { key: "top_left", x: 0.08, y: 0.1 },
  { key: "top_right", x: 0.92, y: 0.1 },
  { key: "bottom_right", x: 0.92, y: 0.9 },
  { key: "bottom_left", x: 0.08, y: 0.9 },
]);

const CAL_LIMITS = Object.freeze({
  yaw: [0.18, 0.45],
  eyeSide: [0.3, 0.75],
  pitchDown: [0.12, 0.35],
  eyeDown: [0.3, 0.75],
});

function med(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

/**
 * Turn the face numbers seen while the candidate looked at each dot into their
 * OWN "on the screen" range. Looking past the screen's edge — by a margin —
 * is "away". Returns null when too few dots were seen.
 * @param {Record<string, Array<{yaw:number,pitch:number,eyeSide:number,eyeDown:number}>>} samplesByDot
 */
export function calibrate(samplesByDot, margin = 1.35) {
  const per = {};
  for (const dot of CALIBRATION_DOTS) {
    const s = (samplesByDot && samplesByDot[dot.key]) || [];
    if (s.length < 2) continue;
    per[dot.key] = {
      yaw: med(s.map((m) => m.yaw)),
      pitch: med(s.map((m) => m.pitch)),
      eyeSide: med(s.map((m) => m.eyeSide)),
      eyeDown: med(s.map((m) => m.eyeDown)),
    };
  }
  const c = per.center;
  const corners = ["top_left", "top_right", "bottom_right", "bottom_left"].filter((k) => per[k]);
  if (!c || corners.length < 3) return null;
  const spread = (k) => Math.max(0, ...corners.map((d) => Math.abs(per[d][k] - c[k])));
  const lows = ["bottom_left", "bottom_right"].filter((k) => per[k]);
  const down = (k) => Math.max(0, ...lows.map((d) => per[d][k] - c[k]));
  return {
    base: { yaw: c.yaw, pitch: c.pitch, eyeSide: c.eyeSide, eyeDown: c.eyeDown },
    cfg: {
      yaw: clamp(spread("yaw") * margin, CAL_LIMITS.yaw),
      eyeSide: clamp(spread("eyeSide") * margin, CAL_LIMITS.eyeSide),
      pitchDown: clamp(down("pitch") * margin, CAL_LIMITS.pitchDown),
      eyeDown: clamp(down("eyeDown") * margin, CAL_LIMITS.eyeDown),
    },
    dots: Object.keys(per).length,
  };
}

/* ------------------------------------------------------------------------- */
/* Reading detection                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Reading text looks different from thinking: the eyes drift steadily along a
 * line, then JUMP back to the start of the next one — again and again. Each
 * scan gives the eyes' horizontal position (relative to the candidate's own
 * baseline). A "return sweep" is a quick jump opposite to the drift that came
 * before it. Several within a short window → ONE `reading_pattern` flag
 * (informational — a reviewer checks the recording; it never ends anything).
 */
export const READING = Object.freeze({
  jump: 0.16,
  drift: 0.14,
  driftWindowMs: 1600,
  sweeps: 3,
  windowMs: 12000,
  cooldownMs: 30000,
});

export class ReadingDetector {
  constructor(cfg = {}) {
    this.cfg = { ...READING, ...cfg };
    this.samples = [];
    this.sweeps = [];
    this.lastAt = -Infinity;
  }

  reset() {
    this.samples = [];
    this.sweeps = [];
  }

  /** @returns {{type:string, details:string}|null} */
  feed(now, x) {
    if (!Number.isFinite(x)) return null;
    const cfg = this.cfg;
    const prev = this.samples[this.samples.length - 1];
    this.samples.push({ t: now, x });
    this.samples = this.samples.filter((s) => now - s.t <= cfg.driftWindowMs + 600);
    if (prev) {
      const jump = x - prev.x;
      if (Math.abs(jump) >= cfg.jump) {
        const before = this.samples.filter((s) => s.t < prev.t && prev.t - s.t <= cfg.driftWindowMs);
        if (before.length >= 1) {
          const drift = prev.x - before[0].x;
          if (Math.abs(drift) >= cfg.drift && Math.sign(drift) === -Math.sign(jump)) {
            this.sweeps.push(now);
            this.samples = [{ t: now, x }];
          }
        }
      }
    }
    this.sweeps = this.sweeps.filter((t) => now - t <= cfg.windowMs);
    if (this.sweeps.length >= cfg.sweeps && now - this.lastAt >= cfg.cooldownMs) {
      this.lastAt = now;
      const n = this.sweeps.length;
      this.sweeps = [];
      return { type: "reading_pattern", details: `eyes moved line by line, as if reading (${n} return sweeps)` };
    }
    return null;
  }
}
