/**
 * Camera monitor — the decisions, with no browser in them (13 Oct 2026).
 *
 * `face_detection.js` runs the MediaPipe Face Landmarker on the candidate's
 * camera and hands every scan to `CameraMonitorLogic.step()`, which decides:
 *
 *  - EXTRA FACE: a second real face (not a tiny poster in the background) seen
 *    for `extraFaceConfirmMs` → one `multiple_faces` event (a STRIKE on the
 *    server, like a tab switch), then quiet for `extraFaceCooldownMs`.
 *  - LOOKING AWAY: the head turned to a side, looking down at something, the
 *    eyes turned to a side / down, or the face gone from the camera — held for
 *    `awayConfirmMs` → one `gaze_away` event (a SOFT warning; the server ends
 *    the interview on the 10th). Looking UP is not counted — that is how most
 *    people think. While a pseudo-code / coding panel is open, looking down
 *    (at the keyboard) is not counted either.
 *
 * Gaze is judged against the candidate's OWN baseline, learnt from the first
 * scans and adapted slowly while they look at the screen — a laptop camera
 * sits above the screen, so "looking at the screen" is not "looking into the
 * lens", and every desk is different.
 *
 * Pure: every function takes plain numbers; `now` is passed in. Unit-tested
 * from node: `node --test scripts/tests/` (F-V2 repo root).
 */

export const MONITOR_DEFAULTS = Object.freeze({
  /** A face narrower than this share of the frame is background, not a person at the desk. */
  minFaceWidth: 0.07,
  extraFaceConfirmMs: 1200,
  extraFaceCooldownMs: 15000,
  /** Scans used to learn the candidate's own "looking at the screen". */
  baselineSamples: 12,
  /** How long the candidate must look away before it counts. */
  awayConfirmMs: 3000,
  /** No two look-away warnings closer than this. */
  minGapMs: 10000,
  /** Still looking away this long after a warning → warn again. */
  repeatAwayMs: 10000,
  /** Looking back this long re-arms the next warning. */
  backOnScreenMs: 800,
  /** The face gone from the camera this long counts as looking away. */
  noFaceAwayMs: 5000,
  /** Before any face was seen, wait this long before "no face" can count (camera warming up). */
  noFaceGraceMs: 10000,
  // Thresholds — deltas from the candidate's baseline.
  /** Head turned sideways: nose offset ÷ eye distance (≈ 0.24 → ~25°). */
  yaw: 0.24,
  /** Head tipped down: (nose − eyes) ÷ (mouth − eyes). */
  pitchDown: 0.16,
  /** Eyes turned to a side / down (MediaPipe blendshape scores, 0..1). */
  eyeSide: 0.42,
  eyeDown: 0.42,
  /** Both eyelids this closed = a blink: the scan says nothing either way. */
  blink: 0.55,
  /** How fast the baseline follows the candidate's posture while on screen. */
  adapt: 0.02,
});

function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function score(blendshapes, name) {
  if (!blendshapes) return 0;
  if (Array.isArray(blendshapes)) {
    const hit = blendshapes.find((c) => c && (c.categoryName === name || c.displayName === name));
    return hit ? Number(hit.score) || 0 : 0;
  }
  return Number(blendshapes[name]) || 0;
}

/**
 * One face → the numbers the monitor judges. `landmarks` are MediaPipe's
 * normalised points (x, y in 0..1); `blendshapes` the face's category list.
 * Landmark indices: 33 / 263 outer eye corners, 1 nose tip, 13 / 14 lips.
 */
export function faceMetrics(landmarks, blendshapes, frameWidth, frameHeight) {
  if (!Array.isArray(landmarks) || landmarks.length < 264) return null;
  const W = Math.max(1, Number(frameWidth) || 1);
  const H = Math.max(1, Number(frameHeight) || 1);
  let minX = 1;
  let maxX = 0;
  for (const p of landmarks) {
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const px = (p) => ({ x: p.x * W, y: p.y * H });
  const eR = px(landmarks[33]);
  const eL = px(landmarks[263]);
  const nose = px(landmarks[1]);
  const lipTop = px(landmarks[13]);
  const lipBottom = px(landmarks[14]);
  const eyeMid = { x: (eR.x + eL.x) / 2, y: (eR.y + eL.y) / 2 };
  const mouthMid = { x: (lipTop.x + lipBottom.x) / 2, y: (lipTop.y + lipBottom.y) / 2 };
  const iod = Math.hypot(eL.x - eR.x, eL.y - eR.y) || 1;
  const eyeToMouth = mouthMid.y - eyeMid.y || 1;
  const outL = score(blendshapes, "eyeLookOutLeft");
  const inL = score(blendshapes, "eyeLookInLeft");
  const outR = score(blendshapes, "eyeLookOutRight");
  const inR = score(blendshapes, "eyeLookInRight");
  return {
    width: Math.max(0, maxX - minX),
    yaw: (nose.x - eyeMid.x) / iod,
    pitch: (nose.y - eyeMid.y) / eyeToMouth,
    // + = both eyes turned toward the candidate's left, − = toward their right.
    eyeSide: ((outL - inL) - (outR - inR)) / 2,
    eyeDown: (score(blendshapes, "eyeLookDownLeft") + score(blendshapes, "eyeLookDownRight")) / 2,
    blink: Math.min(score(blendshapes, "eyeBlinkLeft"), score(blendshapes, "eyeBlinkRight")),
    hasGaze: true,
  };
}

/** Why this face is not looking at the screen, or null. */
export function awayReason(m, base, cfg = MONITOR_DEFAULTS, { typed = false } = {}) {
  if (!m || !m.hasGaze || !base) return null;
  const dYaw = m.yaw - base.yaw;
  if (Math.abs(dYaw) >= cfg.yaw) return dYaw > 0 ? "head turned to the side" : "head turned to the other side";
  if (!typed && m.pitch - base.pitch >= cfg.pitchDown) return "looking down";
  const dSide = m.eyeSide - base.eyeSide;
  if (Math.abs(dSide) >= cfg.eyeSide) return "eyes turned to the side";
  if (!typed && m.eyeDown - base.eyeDown >= cfg.eyeDown) return "eyes looking down";
  return null;
}

export class CameraMonitorLogic {
  constructor(cfg = {}, startedAt = 0) {
    this.cfg = { ...MONITOR_DEFAULTS, ...cfg };
    this.startedAt = startedAt;
    this.reset();
  }

  reset() {
    this.multiSince = 0;
    this.lastMultiAt = -Infinity;
    this.samples = [];
    this.base = null;
    this.awaySince = 0;
    this.awayWhy = "";
    this.backSince = 0;
    this.armed = true;
    this.lastAwayAt = -Infinity;
    this.noFaceSince = 0;
    this.seenFace = false;
  }

  /** A recruiter pause / anything that should not carry a half-built "away" over. */
  pause() {
    this.awaySince = 0;
    this.noFaceSince = 0;
    this.multiSince = 0;
  }

  _learn(m) {
    if (this.base || !m || !m.hasGaze) return;
    // Only frames that plausibly look at the screen teach the baseline.
    if (Math.abs(m.yaw) > 0.35 || m.blink >= this.cfg.blink) return;
    this.samples.push(m);
    if (this.samples.length >= this.cfg.baselineSamples) {
      const pick = (k) => median(this.samples.map((s) => s[k]));
      this.base = { yaw: pick("yaw"), pitch: pick("pitch"), eyeSide: pick("eyeSide"), eyeDown: pick("eyeDown") };
      this.samples = [];
    }
  }

  _adapt(m) {
    if (!this.base || !m || !m.hasGaze) return;
    const a = this.cfg.adapt;
    for (const k of ["yaw", "pitch", "eyeSide", "eyeDown"]) {
      this.base[k] = this.base[k] * (1 - a) + m[k] * a;
    }
  }

  _away(now, why, since = now, confirmMs = this.cfg.awayConfirmMs) {
    this.backSince = 0;
    // Keep the clock running across reasons (head turn → eyes) — it is one look-away.
    if (!this.awaySince) this.awaySince = since;
    this.awayWhy = why;
    const held = now - this.awaySince;
    if (held < confirmMs) return null;
    const sinceLast = now - this.lastAwayAt;
    if (sinceLast < this.cfg.minGapMs) return null;
    if (!this.armed && sinceLast < this.cfg.repeatAwayMs) return null;
    this.lastAwayAt = now;
    this.armed = false;
    return { type: "gaze_away", details: `${why} for ${Math.round(held / 1000)} s` };
  }

  _onScreen(now, m) {
    this.awaySince = 0;
    this.awayWhy = "";
    if (!this.backSince) this.backSince = now;
    if (now - this.backSince >= this.cfg.backOnScreenMs) this.armed = true;
    this._adapt(m);
  }

  /**
   * @param {number} now ms
   * @param {Array<{width:number}&Partial<ReturnType<typeof faceMetrics>>>} faces
   * @param {{paused?:boolean, typed?:boolean}} ctx
   * @returns {Array<{type:string, details:string}>}
   */
  step(now, faces, { paused = false, typed = false } = {}) {
    const out = [];
    if (paused) {
      this.pause();
      return out;
    }
    const cfg = this.cfg;
    const real = (Array.isArray(faces) ? faces : [])
      .filter((f) => f && Number(f.width) >= cfg.minFaceWidth)
      .sort((a, b) => b.width - a.width);

    if (real.length >= 2) {
      if (!this.multiSince) this.multiSince = now;
      if (now - this.multiSince >= cfg.extraFaceConfirmMs && now - this.lastMultiAt >= cfg.extraFaceCooldownMs) {
        this.lastMultiAt = now;
        out.push({ type: "multiple_faces", details: `${real.length} faces on camera` });
      }
    } else {
      this.multiSince = 0;
    }

    const me = real[0];
    if (!me) {
      const graceOver = this.seenFace || now - this.startedAt >= cfg.noFaceGraceMs;
      if (!graceOver) return out;
      if (!this.noFaceSince) this.noFaceSince = now;
      const ev = this._away(now, "face not visible on camera", this.noFaceSince, cfg.noFaceAwayMs);
      if (ev) out.push(ev);
      return out;
    }
    this.seenFace = true;
    this.noFaceSince = 0;
    if (!me.hasGaze) {
      // Face count only (no landmarks): a visible face is "on screen".
      this._onScreen(now, null);
      return out;
    }
    if (me.blink >= cfg.blink) return out; // a blink says nothing either way
    if (!this.base) {
      this._learn(me);
      return out;
    }
    const why = awayReason(me, this.base, cfg, { typed });
    if (why) {
      const ev = this._away(now, why);
      if (ev) out.push(ev);
    } else {
      this._onScreen(now, me);
    }
    return out;
  }
}
