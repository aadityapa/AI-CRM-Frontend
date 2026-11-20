/**
 * Anti-cheating checks before the interview (13 Nov 2026).
 *
 * After the Device Check — only for the checks the template turned on
 * (`schedule.proctoring`, B-V2 services/interview/proctoring.py):
 *
 *   1. Headphones  — we play 2–4 beeps; the candidate says how many they heard
 *                    (so the sound is audible) while the microphone listens. With
 *                    headphones it hears almost nothing; with speakers it hears
 *                    the beeps clearly.
 *   2. Lighting    — the face must be clearly lit, not dark and not against a
 *                    bright window.
 *   3. Gesture     — both open palms, then a gesture we name at random (proves a
 *                    live person, not a looped video).
 *   4. Eye calibration — follow five dots; the look-away rule then uses the
 *                    candidate's OWN screen range.
 *
 * A check set to "require" (or the gesture check) must pass before Continue; a
 * "warn" check can be passed over after one attempt. Every result is reported
 * to `/candidate/invite/{token}/device-check` (shown on the Integrity tab).
 *
 * Also here: `runRoomScan()` (after sign-in, recorded) and `runHeadphoneTest()`
 * (re-used when headphones are unplugged mid-interview).
 *
 * Every node is built with textContent — no server text reaches innerHTML.
 */
import {
  CALIBRATION_DOTS,
  GestureHold,
  PALMS,
  calibrate,
  dbAbove,
  gestureFailReason,
  goertzelPower,
  headphonePlan,
  headphoneVerdict,
  lightingVerdict,
  normalizeProctoring,
  randomGesture,
} from "./proctoring_logic.js";

const STEP_WORDS = {
  headphones: { title: "Headphones", icon: "headphones" },
  lighting: { title: "Lighting", icon: "light" },
  gesture: { title: "Gesture check", icon: "hand" },
  gaze_calibration: { title: "Eye calibration", icon: "eye" },
};

/* Line icons (24×24, stroke) — drawn, never emoji: an emoji is a missing-glyph
   box on a machine without an emoji font. */
const ICON_PATHS = {
  headphones: ["M3 18v-6a9 9 0 0 1 18 0v6", "M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z", "M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"],
  light: ["M9 18h6", "M10 22h4", "M15.1 14c.2-1 .7-1.7 1.4-2.5A6 6 0 1 0 7.5 11.5c.7.8 1.2 1.5 1.4 2.5"],
  hand: ["M18 11V6a2 2 0 0 0-4 0v5", "M14 10V4a2 2 0 0 0-4 0v6", "M10 10.5V6a2 2 0 0 0-4 0v8", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  check: ["M20 6 9 17l-5-5"],
};

function icon(name, size = 16) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICON_PATHS[name] || []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The left tile of a step that has no camera preview. */
function _iconTile(name) {
  return h("div", { class: "kxpc-cam kxpc-icontile" }, [icon(name, 96)]);
}

let _config = normalizeProctoring({});
let _camStream = null;
let _attempts = {};

/** The template's checks, from the invite lookup. */
export function setProctoringConfig(raw) {
  _config = normalizeProctoring(raw);
  return _config;
}

export function getProctoringConfig() {
  return _config;
}

/** The camera this module opened (the lobby may share it with a recruiter). */
export function getChecksCameraStream() {
  return _camStream && _camStream.active ? _camStream : null;
}

/* ------------------------------------------------------------------------- */
/* Small DOM helpers                                                           */
/* ------------------------------------------------------------------------- */

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "text") el.textContent = String(v);
    else if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _token() {
  try {
    return new URLSearchParams(window.location.search).get("invite") || "";
  } catch (_) {
    return "";
  }
}

/** Report one result (never awaited, never throws). */
export function reportCheck(check, ok, reason = "", detail = "") {
  try {
    const token = _token();
    if (!token) return;
    _attempts[check] = (_attempts[check] || 0) + 1;
    fetch(`/candidate/invite/${encodeURIComponent(token)}/device-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ check, ok: !!ok, reason: String(reason || ""), detail: String(detail || "").slice(0, 80), attempt: _attempts[check] }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* reporting is best-effort */
  }
}

function _ensureStyles() {
  if (document.getElementById("kxpcStyles")) return;
  const style = document.createElement("style");
  style.id = "kxpcStyles";
  style.textContent = `
  .kxpc{--pc-bg:rgba(15,23,42,.55);--pc-card:#fff;--pc-card-2:#f8fafc;--pc-fg:#0f172a;--pc-muted:#475569;--pc-border:#e2e8f0;
    --pc-brand:#2563eb;--pc-ok:#047857;--pc-ok-soft:#ecfdf5;--pc-warn:#b45309;--pc-warn-soft:#fffbeb;--pc-bad:#b91c1c;--pc-bad-soft:#fef2f2;
    font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--pc-fg)}
  html.kx-dark .kxpc{--pc-bg:rgba(2,6,23,.72);--pc-card:#0f172a;--pc-card-2:#111c33;--pc-fg:#e2e8f0;--pc-muted:#94a3b8;--pc-border:#1e293b;
    --pc-brand:#60a5fa;--pc-ok:#34d399;--pc-ok-soft:rgba(16,185,129,.12);--pc-warn:#fbbf24;--pc-warn-soft:rgba(245,158,11,.12);--pc-bad:#f87171;--pc-bad-soft:rgba(239,68,68,.12)}
  :where(.kxpc) :is(button,select,input){width:auto;margin:0;min-height:0;letter-spacing:normal;box-shadow:none;transition:none}
  :where(.kxpc) button{position:relative;overflow:visible;padding:0;border:0;background:none;color:inherit;font:inherit;text-transform:none}
  :where(.kxpc) button:hover,:where(.kxpc) button:active{transform:none;filter:none}
  :where(.kxpc) button::after{content:none;display:none}
  .kxpc [hidden]{display:none !important}
  .kxpc-icontile{display:flex;align-items:center;justify-content:center;color:#60a5fa;
    background:radial-gradient(circle at 50% 40%,rgba(37,99,235,.35),#020617 70%)}
  .kxpc-overlay{position:fixed;inset:0;z-index:11050;display:flex;align-items:center;justify-content:center;padding:16px;
    background:radial-gradient(circle at 20% 10%,rgba(37,99,235,.22),transparent 45%),var(--pc-bg);backdrop-filter:blur(8px)}
  .kxpc-card{width:min(920px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:20px;background:var(--pc-card);
    border:1px solid var(--pc-border);box-shadow:0 30px 80px rgba(15,23,42,.35);padding:24px 26px}
  .kxpc-eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--pc-brand)}
  .kxpc-title{font-size:22px;font-weight:800;margin:4px 0 2px;letter-spacing:-.01em}
  .kxpc-sub{font-size:14px;color:var(--pc-muted);line-height:1.55;margin:0}
  .kxpc-steps{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 18px}
  .kxpc-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;
    border:1px solid var(--pc-border);background:var(--pc-card-2);color:var(--pc-muted)}
  .kxpc-chip[data-state="current"]{border-color:var(--pc-brand);color:var(--pc-brand)}
  .kxpc-chip[data-state="ok"]{background:var(--pc-ok-soft);color:var(--pc-ok);border-color:transparent}
  .kxpc-chip[data-state="warn"]{background:var(--pc-warn-soft);color:var(--pc-warn);border-color:transparent}
  .kxpc-body{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:20px;align-items:start}
  @media (max-width:760px){.kxpc-body{grid-template-columns:1fr}}
  .kxpc-cam{position:relative;aspect-ratio:4/3;border-radius:16px;overflow:hidden;background:#020617}
  .kxpc-cam video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
  .kxpc-cam .kxpc-badge{position:absolute;left:12px;top:12px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:800;
    background:rgba(2,6,23,.65);color:#fff}
  .kxpc-big{position:absolute;inset:auto 12px 12px 12px;padding:10px 12px;border-radius:12px;background:rgba(2,6,23,.7);color:#fff;
    font-size:15px;font-weight:800;text-align:center}
  .kxpc-panel{display:flex;flex-direction:column;gap:12px}
  .kxpc-h{font-size:17px;font-weight:800;margin:0}
  .kxpc-list{margin:0;padding-left:18px;font-size:14px;color:var(--pc-muted);line-height:1.6}
  .kxpc-status{padding:12px 14px;border-radius:12px;font-size:14px;font-weight:600;line-height:1.45;white-space:pre-line;
    background:var(--pc-card-2);border:1px solid var(--pc-border)}
  .kxpc-status[data-tone="ok"]{background:var(--pc-ok-soft);color:var(--pc-ok);border-color:transparent}
  .kxpc-status[data-tone="warn"]{background:var(--pc-warn-soft);color:var(--pc-warn);border-color:transparent}
  .kxpc-status[data-tone="bad"]{background:var(--pc-bad-soft);color:var(--pc-bad);border-color:transparent}
  .kxpc-meter{height:10px;border-radius:999px;background:var(--pc-card-2);border:1px solid var(--pc-border);overflow:hidden}
  .kxpc-meter span{display:block;height:100%;width:0;background:linear-gradient(90deg,#ef4444,#f59e0b 35%,#10b981 60%);transition:width .3s}
  .kxpc-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .kxpc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px !important;border-radius:12px !important;
    font-size:14px;font-weight:800;cursor:pointer;border:1px solid var(--pc-border) !important;background:var(--pc-card-2) !important;color:var(--pc-fg) !important}
  .kxpc-btn[disabled]{opacity:.5;cursor:not-allowed}
  .kxpc-btn.primary{background:linear-gradient(135deg,#2563eb,#4f46e5) !important;color:#fff !important;border-color:transparent !important}
  .kxpc-btn.num{min-width:48px}
  .kxpc-btn.num[aria-pressed="true"]{border-color:var(--pc-brand) !important;color:var(--pc-brand) !important}
  .kxpc-foot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--pc-border)}
  .kxpc-foot .hint{font-size:13px;color:var(--pc-muted)}
  .kxpc-dots{position:fixed;inset:0;z-index:11060;background:#020617;cursor:none}
  .kxpc-dot{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#f59e0b;
    box-shadow:0 0 0 8px rgba(245,158,11,.25),0 0 30px rgba(245,158,11,.6);transition:left .45s ease,top .45s ease}
  .kxpc-dot::after{content:"";position:absolute;inset:9px;border-radius:50%;background:#fff}
  .kxpc-dots-text{position:absolute;left:50%;top:calc(50% + 44px);transform:translateX(-50%);color:#cbd5e1;font-size:15px;font-weight:600;text-align:center;width:min(520px,90vw)}
  .kxpc-prompt{position:fixed;right:20px;bottom:20px;z-index:11040;width:min(360px,calc(100vw - 40px));border-radius:16px;
    background:var(--pc-card);border:2px solid #f59e0b;box-shadow:0 20px 50px rgba(15,23,42,.4);padding:16px}
  .kxpc-prompt .kxpc-h{font-size:16px}
  .kxpc-count{font-size:30px;font-weight:900;color:#f59e0b;font-variant-numeric:tabular-nums}
  `;
  document.head.appendChild(style);
}

async function _openCamera() {
  if (_camStream && _camStream.active) return _camStream;
  _camStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  return _camStream;
}

export function releaseChecksCamera() {
  try {
    _camStream?.getTracks().forEach((t) => t.stop());
  } catch (_) {
    /* ignore */
  }
  _camStream = null;
}

function _status(el, tone, text) {
  el.dataset.tone = tone;
  el.textContent = text;
}

/* ------------------------------------------------------------------------- */
/* 1. Headphones                                                               */
/* ------------------------------------------------------------------------- */

async function _outputLabels() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audiooutput" || d.kind === "audioinput").map((d) => d.label || "");
  } catch (_) {
    return [];
  }
}

/**
 * Play the beeps and listen. Resolves `{ leakDb[], played, error }`.
 * The microphone is opened RAW (no echo cancellation / noise suppression —
 * those would hide the speaker leak this test measures).
 */
async function _playAndListen(plan) {
  let mic = null;
  let ctx = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (_) {
    return { leakDb: [], played: plan.count, error: "no_mic" };
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createMediaStreamSource(mic);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const sample = () => {
      analyser.getFloatTimeDomainData(buf);
      return Float32Array.from(buf);
    };
    const powerAt = (freq) => goertzelPower(sample(), ctx.sampleRate, freq);
    await sleep(350);
    const leakDb = [];
    for (const freq of plan.tones) {
      const noise = (powerAt(freq) + (await sleep(60), powerAt(freq))) / 2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.5, ctx.currentTime + 0.42);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      await sleep(180);
      let peak = 0;
      for (let i = 0; i < 4; i += 1) {
        peak = Math.max(peak, powerAt(freq));
        await sleep(50);
      }
      osc.stop(ctx.currentTime + 0.55);
      leakDb.push(dbAbove(peak, noise));
      await sleep(650 + Math.random() * 350);
    }
    return { leakDb, played: plan.count, error: "" };
  } catch (_) {
    return { leakDb: [], played: plan.count, error: "no_audio" };
  } finally {
    try { mic?.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
    try { await ctx?.close(); } catch (_) { /* ignore */ }
  }
}

/**
 * The headphone test as a panel. `onResult(verdict)` after each attempt.
 * Also used mid-interview (`runHeadphoneTest`).
 */
function _headphonePanel(onResult) {
  const status = h("div", { class: "kxpc-status", text: "Put on your headphones (wired or Bluetooth), turn the volume up, then press Play test." });
  const answer = h("div", { class: "kxpc-row", hidden: true });
  const play = h("button", { class: "kxpc-btn primary", type: "button", text: "Play test" });
  let busy = false;
  play.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    play.disabled = true;
    answer.hidden = true;
    answer.replaceChildren();
    _status(status, "", "Listen… beeps are playing in your headphones.");
    const plan = headphonePlan();
    const heard = await _playAndListen(plan);
    if (heard.error) {
      const v = { ok: false, reason: heard.error, detail: "", maxLeak: 0 };
      _status(status, "bad", heard.error === "no_mic"
        ? "The microphone could not be opened. Allow it from the address bar and press Play test again."
        : "The test sound could not play. Press Play test again.");
      busy = false;
      play.disabled = false;
      onResult(v);
      return;
    }
    _status(status, "", "How many beeps did you hear?");
    answer.hidden = false;
    for (let n = 1; n <= 5; n += 1) {
      answer.append(h("button", {
        class: "kxpc-btn num", type: "button", text: String(n),
        onclick: async () => {
          answer.querySelectorAll("button").forEach((b) => { b.disabled = true; });
          const labels = await _outputLabels();
          const v = headphoneVerdict({ leakDb: heard.leakDb, heard: n, played: heard.played, labels });
          if (v.ok) _status(status, "ok", "Headphones confirmed — the sound reaches only you.");
          else if (v.reason === "wrong_count") _status(status, "bad", `That was not the number played. Check the volume and press Play test again.`);
          else _status(status, "bad", "The microphone heard the beeps — the sound is coming from your speakers.\nConnect headphones (or switch the sound output to them) and press Play test again.");
          busy = false;
          answer.hidden = true;
          play.disabled = false;
          play.textContent = "Play test again";
          onResult(v);
        },
      }));
    }
  });
  const panel = h("div", { class: "kxpc-panel" }, [
    h("p", { class: "kxpc-h", text: "Connect your headphones" }),
    h("ul", { class: "kxpc-list" }, [
      h("li", { text: "Wired or Bluetooth headphones / earphones are fine." }),
      h("li", { text: "We play a few beeps — tell us how many you heard." }),
      h("li", { text: "Stay quiet during the test; the microphone checks the sound is not coming from speakers." }),
    ]),
    status,
    h("div", { class: "kxpc-row" }, [play]),
    answer,
  ]);
  return { panel, status };
}

/* ------------------------------------------------------------------------- */
/* 2. Lighting / 3. Gesture — both on a camera preview                        */
/* ------------------------------------------------------------------------- */

function _camBox(label) {
  const video = h("video", { autoplay: true, playsinline: true, muted: true, "aria-label": "Your camera" });
  video.muted = true;
  const badge = h("span", { class: "kxpc-badge", text: label });
  const big = h("div", { class: "kxpc-big", hidden: true });
  return { box: h("div", { class: "kxpc-cam" }, [video, badge, big]), video, badge, big };
}

async function _attachCamera(video) {
  const stream = await _openCamera();
  video.srcObject = stream;
  try { await video.play(); } catch (_) { /* autoplay may need a gesture; muted video is allowed */ }
  for (let i = 0; i < 40 && (video.readyState < 2 || !video.videoWidth); i += 1) await sleep(100);
}

async function _runLighting(ui, done) {
  const { detectFacesOnce, measureLight } = await import("./face_detection.js");
  const cam = _camBox("Lighting");
  const meter = h("div", { class: "kxpc-meter" }, [h("span")]);
  const status = h("div", { class: "kxpc-status", text: "Checking the light on your face…" });
  ui.body.replaceChildren(cam.box, h("div", { class: "kxpc-panel" }, [
    h("p", { class: "kxpc-h", text: "Sit in good light" }),
    h("ul", { class: "kxpc-list" }, [
      h("li", { text: "Face a window or a lamp — the light should fall on your face." }),
      h("li", { text: "Avoid a bright window or light BEHIND you." }),
      h("li", { text: "Your whole face should be clearly visible." }),
    ]),
    meter, status,
  ]));
  try {
    await _attachCamera(cam.video);
  } catch (_) {
    _status(status, "bad", "The camera could not be opened. Allow it and reload the page.");
    reportCheck("lighting", false, "no_camera");
    done({ ok: false, reason: "no_camera" });
    return () => {};
  }
  let goodSince = 0;
  let stopped = false;
  let reported = false;
  let lastVerdict = null;
  const deadline = Date.now() + 20000;
  const loop = async () => {
    while (!stopped) {
      const faces = await detectFacesOnce(cam.video);
      if (faces === null) {
        // The face model cannot run here — measure the whole frame instead.
        const m = measureLight(cam.video, null);
        lastVerdict = m ? lightingVerdict({ face: m.frame, frame: m.frame }) : null;
      } else if (faces.length) {
        const m = measureLight(cam.video, faces[0]);
        lastVerdict = m ? lightingVerdict(m) : null;
      } else {
        lastVerdict = lightingVerdict({ face: null, frame: 0 });
      }
      const v = lastVerdict;
      if (v) {
        const face = Number((v.detail.match(/face brightness (\d+)/) || [])[1] || 0);
        meter.firstChild.style.width = `${Math.max(4, Math.min(100, (face / 160) * 100))}%`;
        if (v.ok) {
          if (!goodSince) goodSince = Date.now();
          _status(status, "ok", "Good light — your face is clearly visible.");
          if (Date.now() - goodSince >= 2000 && !reported) {
            reported = true;
            reportCheck("lighting", true, "", v.detail);
            done({ ok: true });
          }
        } else {
          goodSince = 0;
          _status(status, v.reason === "no_face" ? "warn" : "bad", {
            too_dark: "Too dark — turn on a light or face a window.",
            backlit: "The light is behind you — turn so the light falls on your face.",
            no_face: "We cannot see your face — sit in front of the camera.",
          }[v.reason] || "Adjust your light.");
        }
      }
      if (!reported && Date.now() > deadline && v && !v.ok) {
        reported = true;
        reportCheck("lighting", false, v.reason, v.detail);
        done({ ok: false, reason: v.reason, retryable: true });
      }
      await sleep(400);
    }
  };
  void loop();
  return () => { stopped = true; };
}

async function _runGesture(ui, done) {
  const { detectHands, loadHandMonitor } = await import("./hand_monitor.js");
  const cam = _camBox("Gesture check");
  const status = h("div", { class: "kxpc-status", text: "Loading the hand detector…" });
  const stepText = h("p", { class: "kxpc-h", text: "Show your hands" });
  ui.body.replaceChildren(cam.box, h("div", { class: "kxpc-panel" }, [
    stepText,
    h("ul", { class: "kxpc-list" }, [
      h("li", { text: "Sit back a little so your hands fit in the camera." }),
      h("li", { text: "Hold each gesture still until it turns green." }),
    ]),
    status,
  ]));
  try {
    await _attachCamera(cam.video);
  } catch (_) {
    _status(status, "bad", "The camera could not be opened.");
    done({ ok: false, reason: "no_hands" });
    return () => {};
  }
  const ready = await loadHandMonitor();
  if (!ready) {
    _status(status, "warn", "The hand detector could not load in this browser. You can continue.");
    reportCheck("gesture", false, "model_unavailable");
    done({ ok: false, reason: "model_unavailable", passable: true });
    return () => {};
  }
  let stopped = false;
  const runTarget = async (target, timeoutMs) => {
    const hold = new GestureHold(target, 900);
    stepText.textContent = target.words;
    cam.big.hidden = false;
    cam.big.textContent = target.words;
    _status(status, "", "Hold it steady in front of the camera…");
    const until = Date.now() + timeoutMs;
    while (!stopped && Date.now() < until) {
      const hands = await detectHands(cam.video);
      if (hands === null) return { ok: false, reason: "model_unavailable" };
      if (hold.feed(Date.now(), hands)) return { ok: true };
      await sleep(120);
    }
    return { ok: false, reason: gestureFailReason(target, hold.sawHands, hold.bestMs) };
  };
  void (async () => {
    const palms = await runTarget(PALMS, 20000);
    if (stopped) return;
    if (!palms.ok) {
      cam.big.hidden = true;
      _status(status, "bad", palms.reason === "no_hands" ? "We could not see your hands. Sit back and try again." : "Both open palms were not shown. Try again.");
      reportCheck("gesture", false, palms.reason, "palms");
      done({ ok: false, reason: palms.reason, retryable: true });
      return;
    }
    _status(status, "ok", "Palms seen. Now the next gesture…");
    await sleep(700);
    const target = randomGesture();
    const g = await runTarget(target, 20000);
    if (stopped) return;
    cam.big.hidden = true;
    if (g.ok) {
      _status(status, "ok", "Gesture check passed.");
      reportCheck("gesture", true, "", target.kind === "fingers" ? `${target.n} fingers` : target.kind);
      done({ ok: true });
    } else {
      _status(status, "bad", "That gesture was not seen in time. Press Try again — you will get a new one.");
      reportCheck("gesture", false, g.reason, target.kind === "fingers" ? `${target.n} fingers` : target.kind);
      done({ ok: false, reason: g.reason, retryable: true });
    }
  })();
  return () => { stopped = true; };
}

/* ------------------------------------------------------------------------- */
/* 4. Eye calibration                                                          */
/* ------------------------------------------------------------------------- */

async function _runCalibration() {
  const { detectFacesOnce, setGazeCalibration } = await import("./face_detection.js");
  const video = h("video", { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  video.style.cssText = "position:absolute;width:2px;height:2px;opacity:0;pointer-events:none";
  const dot = h("div", { class: "kxpc-dot" });
  const text = h("div", { class: "kxpc-dots-text", text: "Keep your head still and follow the dot with your EYES." });
  const layer = h("div", { class: "kxpc-dots kxpc", role: "dialog", "aria-label": "Eye calibration" }, [video, dot, text]);
  document.body.appendChild(layer);
  try {
    await _attachCamera(video);
  } catch (_) {
    layer.remove();
    return { ok: false, reason: "no_face" };
  }
  const samples = {};
  let sawFace = false;
  for (const d of CALIBRATION_DOTS) {
    dot.style.left = `${d.x * 100}%`;
    dot.style.top = `${d.y * 100}%`;
    text.style.top = d.y > 0.5 ? "20%" : "calc(50% + 44px)";
    await sleep(900);
    const list = [];
    const until = Date.now() + 1300;
    while (Date.now() < until) {
      const faces = await detectFacesOnce(video);
      if (faces === null) {
        layer.remove();
        return { ok: false, reason: "model_unavailable" };
      }
      if (faces.length && faces[0].hasGaze && !(faces[0].blink >= 0.55)) {
        sawFace = true;
        list.push(faces[0]);
      }
      await sleep(90);
    }
    samples[d.key] = list;
  }
  layer.remove();
  const cal = calibrate(samples);
  if (!cal) return { ok: false, reason: sawFace ? "no_face" : "no_face" };
  setGazeCalibration(cal);
  try { sessionStorage.setItem("karnex_gaze_calibration", JSON.stringify(cal)); } catch (_) { /* ignore */ }
  const c = cal.cfg;
  return { ok: true, detail: `head ±${c.yaw.toFixed(2)}, eyes ±${c.eyeSide.toFixed(2)}` };
}

/** A calibration done earlier in this tab (a page that reloaded after sign-in). */
export async function restoreGazeCalibration() {
  try {
    const raw = sessionStorage.getItem("karnex_gaze_calibration");
    if (!raw) return;
    const { setGazeCalibration } = await import("./face_detection.js");
    setGazeCalibration(JSON.parse(raw));
  } catch (_) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------- */
/* The flow                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Run the template's pre-interview checks. Resolves true when the candidate
 * may continue, false when they pressed Back. Resolves true at once when the
 * template turned nothing on.
 * @param {{onStage?: (stage:string)=>void}} [opts]
 */
export function runProctoringChecks(opts = {}) {
  const cfg = _config;
  const steps = cfg.pre_checks.filter((s) => s !== "gaze_calibration");
  const withCalibration = cfg.pre_checks.includes("gaze_calibration");
  if (!steps.length && !withCalibration) return Promise.resolve(true);
  _ensureStyles();
  return new Promise((resolve) => {
    const chips = new Map();
    const stepsRow = h("div", { class: "kxpc-steps" });
    for (const s of cfg.pre_checks) {
      const chip = h("span", { class: "kxpc-chip", "data-state": "todo" }, [icon(STEP_WORDS[s].icon, 14), STEP_WORDS[s].title]);
      chips.set(s, chip);
      stepsRow.append(chip);
    }
    const title = h("div", { class: "kxpc-title", text: "A few quick checks" });
    const sub = h("p", { class: "kxpc-sub", text: "This interview asks for these checks before it starts. They take about a minute." });
    const body = h("div", { class: "kxpc-body" });
    const hint = h("span", { class: "hint" });
    const back = h("button", { class: "kxpc-btn", type: "button", text: "Back" });
    const retry = h("button", { class: "kxpc-btn", type: "button", text: "Try again", hidden: true });
    const next = h("button", { class: "kxpc-btn primary", type: "button", text: "Continue", disabled: true });
    const card = h("div", { class: "kxpc-card", role: "dialog", "aria-modal": "true", "aria-label": "Checks before the interview" }, [
      h("div", { class: "kxpc-eyebrow", text: "Before your interview" }), title, sub, stepsRow, body,
      h("div", { class: "kxpc-foot" }, [hint, h("div", { class: "kxpc-row" }, [back, retry, next])]),
    ]);
    const overlay = h("div", { class: "kxpc kxpc-overlay" }, [card]);
    document.body.appendChild(overlay);

    let index = 0;
    let stop = () => {};
    let advance = null;

    const finish = (ok) => {
      stop();
      overlay.remove();
      if (!ok) releaseChecksCamera();
      resolve(ok);
    };
    back.addEventListener("click", () => finish(false));

    const setChip = (s, state) => chips.get(s)?.setAttribute("data-state", state);
    const required = (s) => (s === "gesture" ? true : cfg[s] === "require");

    const runStep = async () => {
      stop();
      retry.hidden = true;
      next.disabled = true;
      next.textContent = "Continue";
      if (index >= steps.length) {
        await runCalibrationStep();
        return;
      }
      const s = steps[index];
      setChip(s, "current");
      title.textContent = `${STEP_WORDS[s].title} — step ${index + 1} of ${cfg.pre_checks.length}`;
      opts.onStage?.(s === "gesture" ? "gesture" : "device_check");
      hint.textContent = required(s) ? "This check must pass to continue." : "Recommended — you may continue after one attempt.";
      const done = (r) => {
        if (r.ok) {
          setChip(s, "ok");
          next.disabled = false;
          advance = () => { index += 1; void runStep(); };
          return;
        }
        retry.hidden = !r.retryable;
        if (!required(s) || r.passable) {
          next.disabled = false;
          next.textContent = "Continue anyway";
          advance = () => { setChip(s, "warn"); index += 1; void runStep(); };
        }
      };
      if (s === "headphones") {
        const { panel } = _headphonePanel((v) => {
          if (v.ok) reportCheck("headphones", true, "", v.detail);
          else reportCheck("headphones", false, v.reason, v.detail);
          done({ ok: v.ok, reason: v.reason });
        });
        body.replaceChildren(_iconTile("headphones"), panel);
      } else if (s === "lighting") {
        stop = await _runLighting({ body }, done);
      } else if (s === "gesture") {
        stop = await _runGesture({ body }, done);
      }
    };

    const runCalibrationStep = async () => {
      if (!withCalibration) {
        finish(true);
        return;
      }
      setChip("gaze_calibration", "current");
      title.textContent = `Eye calibration — step ${cfg.pre_checks.length} of ${cfg.pre_checks.length}`;
      opts.onStage?.("calibration");
      hint.textContent = "Takes about 10 seconds.";
      const status = h("div", { class: "kxpc-status", text: "A dot moves to the centre and the four corners of your screen. Keep your head still and follow it with your eyes." });
      const start = h("button", { class: "kxpc-btn primary", type: "button", text: "Start calibration" });
      body.replaceChildren(
        _iconTile("eye"),
        h("div", { class: "kxpc-panel" }, [h("p", { class: "kxpc-h", text: "Calibrate the eye monitor" }), status, h("div", { class: "kxpc-row" }, [start])]),
      );
      let tries = 0;
      start.addEventListener("click", async () => {
        start.disabled = true;
        tries += 1;
        const r = await _runCalibration();
        reportCheck("gaze_calibration", r.ok, r.ok ? "" : r.reason, r.detail || "");
        if (r.ok) {
          setChip("gaze_calibration", "ok");
          _status(status, "ok", "Calibrated. The monitor now knows where your screen is.");
          next.disabled = false;
          advance = () => finish(true);
        } else {
          _status(status, "bad", r.reason === "model_unavailable"
            ? "The eye monitor could not load in this browser. You can continue."
            : "Your face was not seen clearly. Sit facing the camera and try again.");
          start.disabled = false;
          start.textContent = "Calibrate again";
          // Never a dead end: after two tries (or no model) the standard monitor is used.
          if (tries >= 2 || r.reason === "model_unavailable") {
            next.disabled = false;
            next.textContent = "Continue anyway";
            advance = () => { setChip("gaze_calibration", "warn"); finish(true); };
          }
        }
      });
    };

    next.addEventListener("click", () => advance?.());
    retry.addEventListener("click", () => void runStep());
    void runStep();
  });
}

/* ------------------------------------------------------------------------- */
/* Headphones unplugged mid-interview                                          */
/* ------------------------------------------------------------------------- */

/**
 * A blocking card that re-runs the headphone test. Resolves when it passes
 * (or at once in "warn" mode after the candidate reads it).
 */
export function runHeadphoneTest({ blocking = true } = {}) {
  _ensureStyles();
  return new Promise((resolve) => {
    const cont = h("button", { class: "kxpc-btn primary", type: "button", text: "Continue", disabled: blocking });
    const { panel } = _headphonePanel((v) => {
      reportCheck("headphones", v.ok, v.reason, v.detail);
      if (v.ok) cont.disabled = false;
    });
    const card = h("div", { class: "kxpc-card", role: "dialog", "aria-modal": "true", "aria-label": "Reconnect your headphones" }, [
      h("div", { class: "kxpc-eyebrow", text: "Headphones" }),
      h("div", { class: "kxpc-title", text: "Your headphones were disconnected" }),
      h("p", { class: "kxpc-sub", text: blocking
        ? "This interview needs headphones. Reconnect them and pass the quick test to continue. This is recorded."
        : "This interview should be taken with headphones. Reconnect them — this is recorded." }),
      h("div", { style: "margin-top:16px" }, [panel]),
      h("div", { class: "kxpc-foot" }, [h("span", { class: "hint", text: "" }), cont]),
    ]);
    const overlay = h("div", { class: "kxpc kxpc-overlay" }, [card]);
    if (!blocking) cont.disabled = false;
    cont.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    document.body.appendChild(overlay);
  });
}

/* ------------------------------------------------------------------------- */
/* Room scan (after sign-in, recorded)                                         */
/* ------------------------------------------------------------------------- */

const ROOM_SCAN_MIN_SEC = 12;
const ROOM_SCAN_MAX_SEC = 40;

/**
 * Ask the candidate to show the room on camera. The session recording is
 * already running, so the scan is in it; the start / end are logged so a
 * reviewer can jump straight to it.
 * @param {{getCameraStream: () => MediaStream|null, report: (type:string, details:string)=>void}} deps
 */
export function runRoomScan({ getCameraStream, report }) {
  _ensureStyles();
  return new Promise((resolve) => {
    const cam = _camBox("REC · Room scan");
    const count = h("div", { class: "kxpc-count", text: String(ROOM_SCAN_MAX_SEC) });
    const done = h("button", { class: "kxpc-btn primary", type: "button", text: `I've shown the room (${ROOM_SCAN_MIN_SEC})`, disabled: true });
    const card = h("div", { class: "kxpc-card", role: "dialog", "aria-modal": "true", "aria-label": "Show your room" }, [
      h("div", { class: "kxpc-eyebrow", text: "Before the first question" }),
      h("div", { class: "kxpc-title", text: "Show us your room" }),
      h("p", { class: "kxpc-sub", text: "This is recorded. It takes about 20 seconds and the interview clock has not started." }),
      h("div", { class: "kxpc-body", style: "margin-top:16px" }, [
        cam.box,
        h("div", { class: "kxpc-panel" }, [
          h("ol", { class: "kxpc-list" }, [
            h("li", { text: "Slowly turn your laptop (or camera) all the way around the room — left, behind you, right." }),
            h("li", { text: "Then tilt it down to show your desk." }),
            h("li", { text: "Finally show both hands and your face again." }),
          ]),
          h("div", { class: "kxpc-row" }, [count, h("span", { class: "kxpc-sub", text: "seconds left" })]),
        ]),
      ]),
      h("div", { class: "kxpc-foot" }, [h("span", { class: "hint", text: "No notes, phones or other people should be in view." }), done]),
    ]);
    const overlay = h("div", { class: "kxpc kxpc-overlay" }, [card]);
    document.body.appendChild(overlay);
    const stream = typeof getCameraStream === "function" ? getCameraStream() : null;
    if (stream) {
      cam.video.srcObject = stream;
      void cam.video.play().catch(() => {});
    } else {
      void _attachCamera(cam.video).catch(() => {});
    }
    report("room_scan_started", "The candidate started the room scan");
    const started = Date.now();
    let finished = false;
    const end = (ok) => {
      if (finished) return;
      finished = true;
      window.clearInterval(timer);
      const secs = Math.round((Date.now() - started) / 1000);
      report(ok ? "room_scan_done" : "room_scan_skipped",
        ok ? `Room scan finished after ${secs} s` : `Room scan ended at the time limit (${secs} s) without the candidate confirming`);
      overlay.remove();
      resolve(ok);
    };
    const timer = window.setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      count.textContent = String(Math.max(0, ROOM_SCAN_MAX_SEC - secs));
      if (secs >= ROOM_SCAN_MIN_SEC) {
        done.disabled = false;
        done.textContent = "I've shown the room";
      } else {
        done.textContent = `I've shown the room (${ROOM_SCAN_MIN_SEC - secs})`;
      }
      if (secs >= ROOM_SCAN_MAX_SEC) end(true);
    }, 250);
    done.addEventListener("click", () => end(true));
  });
}
