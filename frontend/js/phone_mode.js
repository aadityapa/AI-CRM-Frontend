/**
 * Phone interviews (25 Nov 2026).
 *
 * A template may allow a phone or tablet (`weights.devices.allowPhone`, B-V2
 * services/interview/device_policy.py). The invite lookup then carries
 * `schedule.devices.allow_phone = true` and a handheld device gets the phone
 * layout (`kx-phone` on <html> and <body>, CSS block "Phone interview" in
 * index.html) instead of the "use a laptop" screen.
 *
 * What a phone cannot do — share or record its screen, full screen on iPhone —
 * is replaced by phone checks while the interview runs:
 *   - the device is reported once (`phone_interview`, informational),
 *   - split screen / a floating window (`split_screen`, a strike): the page
 *     becomes much narrower, or much shorter while no text box has focus
 *     (a soft keyboard only shortens the page while typing),
 *   - the phone turned sideways during a spoken question: a "turn it upright"
 *     cover + `orientation_changed` (allowed while a typed panel is open),
 *   - the camera interrupted (a call, another app took it): `camera_interrupted`,
 *   - the screen kept awake (Wake Lock) so it never dims mid-answer.
 *
 * The PURE helpers at the top are covered by scripts/tests/phone_mode.test.mjs;
 * nothing touches `window` at module load, so node can import this file.
 */

/** Narrower than this share of the portrait width = a floating window. */
export const NARROW_SHARE = 0.8;
/** Shorter than this share of the portrait height (not typing) = split screen. */
export const SHORT_SHARE = 0.6;
/** The page must stay split this long before it counts. */
export const SPLIT_HOLD_MS = 1500;
/** At most one report of the same kind in this window. */
export const REPORT_COOLDOWN_MS = 20000;

export function isLandscape(w, h) {
  return Number(w) > Number(h);
}

/** The biggest portrait size seen so far; sideways sizes never change it. */
export function growBase(base, w, h) {
  const b = { w: Number(base && base.w) || 0, h: Number(base && base.h) || 0 };
  const ww = Number(w) || 0;
  const hh = Number(h) || 0;
  if (!ww || !hh || isLandscape(ww, hh)) return b;
  return { w: Math.max(b.w, ww), h: Math.max(b.h, hh) };
}

/**
 * Why the page looks split — or null. `typing` = a text box has focus (the
 * soft keyboard shortens the page; that is not split screen).
 */
export function splitScreenReason({ w, h, baseW, baseH, typing = false } = {}) {
  const ww = Number(w) || 0;
  const hh = Number(h) || 0;
  const bw = Number(baseW) || 0;
  const bh = Number(baseH) || 0;
  if (!bw || !bh || !ww || !hh) return null;
  if (isLandscape(ww, hh)) return null; // sideways — the rotate rule handles it
  if (ww < bw * NARROW_SHARE) {
    return `floating window — the page is ${ww}px wide on a ${bw}px screen`;
  }
  if (!typing && hh < bh * SHORT_SHARE) {
    return `split screen — the page is ${hh}px tall on a ${bh}px screen`;
  }
  return null;
}

/** The template switch, read from the invite lookup. Any failure means no. */
export async function phoneAllowedForInvite(token, fetchJson) {
  if (!token || typeof fetchJson !== "function") return false;
  try {
    const data = await fetchJson(token);
    const devices = data && data.schedule && data.schedule.devices;
    return !!(devices && devices.allow_phone === true);
  } catch (_) {
    return false;
  }
}

/** "Android phone · Chrome · 393×852 portrait" — what the Integrity tab shows. */
export function phoneDeviceDetails(nav = {}, win = {}) {
  const ua = String((nav && nav.userAgent) || "");
  let device = "Phone";
  if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && Number(nav.maxTouchPoints || 0) > 1)) device = "iPad";
  else if (/Android/i.test(ua)) device = /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  let browser = "Browser";
  if (/EdgA|EdgiOS|Edg\//i.test(ua)) browser = "Edge";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/FxiOS|Firefox/i.test(ua)) browser = "Firefox";
  else if (/CriOS|Chrome/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua)) browser = "Safari";
  const w = Math.round(Number(win && win.innerWidth) || 0);
  const h = Math.round(Number(win && win.innerHeight) || 0);
  const size = w && h ? ` · ${w}×${h} ${isLandscape(w, h) ? "landscape" : "portrait"}` : "";
  return `${device} · ${browser}${size}`;
}

/* ------------------------------------------------------------------ runtime */

let _phone = false;

export function enablePhoneMode() {
  _phone = true;
  try {
    document.documentElement.classList.add("kx-phone");
    document.body.classList.add("kx-phone");
  } catch (_) {
    /* ignore */
  }
}

export function isPhoneMode() {
  return _phone;
}

let _guards = null;

function _typing() {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName || "").toLowerCase();
  return tag === "textarea" || (tag === "input" && !/^(checkbox|radio|button|submit)$/i.test(el.type || ""));
}

function _size() {
  const vv = window.visualViewport;
  // The layout viewport: the soft keyboard shrinks the visual viewport only.
  return {
    w: Math.round(window.innerWidth || (vv && vv.width) || 0),
    h: Math.round(window.innerHeight || (vv && vv.height) || 0),
  };
}

function _rotateCover(show) {
  let cover = document.getElementById("kxPhoneRotate");
  if (!show) {
    if (cover) cover.hidden = true;
    return;
  }
  if (!cover) {
    cover = document.createElement("div");
    cover.id = "kxPhoneRotate";
    cover.setAttribute("role", "alertdialog");
    cover.setAttribute("aria-live", "assertive");
    cover.style.cssText =
      "position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "gap:14px;padding:24px;text-align:center;background:rgba(11,16,38,.96);color:#e2e8f0;" +
      "font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "56");
    icon.setAttribute("height", "56");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "#93c5fd");
    icon.setAttribute("stroke-width", "1.6");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    body.setAttribute("x", "7");
    body.setAttribute("y", "2");
    body.setAttribute("width", "10");
    body.setAttribute("height", "20");
    body.setAttribute("rx", "2");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "path");
    dot.setAttribute("d", "M11 18h2");
    icon.append(body, dot);
    const title = document.createElement("strong");
    title.textContent = "Turn your phone upright";
    title.style.cssText = "font-size:20px;color:#fff";
    const text = document.createElement("span");
    text.textContent = "Hold the phone in portrait during spoken questions so the camera keeps your face in view.";
    text.style.cssText = "font-size:14px;line-height:1.5;max-width:320px;color:#cbd5e1";
    cover.append(icon, title, text);
    document.body.appendChild(cover);
  }
  cover.hidden = false;
}

/**
 * Start the phone checks. `report(type, details)` posts an integrity event;
 * `isPaused()` (a recruiter hold) and `isTyped()` (a pseudo-code / coding panel
 * is open) relax the checks; `getVideo()` returns the camera <video>.
 */
export function startPhoneGuards({ report, isPaused, isTyped, getVideo } = {}) {
  if (_guards || !_phone || typeof window === "undefined") return;
  const send = typeof report === "function" ? report : () => {};
  const paused = () => (typeof isPaused === "function" ? !!isPaused() : false);
  const typed = () => (typeof isTyped === "function" ? !!isTyped() : false);
  const last = {};
  const once = (type, details) => {
    const now = Date.now();
    if (last[type] && now - last[type] < REPORT_COOLDOWN_MS) return;
    last[type] = now;
    try {
      send(type, details);
    } catch (_) {
      /* ignore */
    }
  };
  const g = { base: { w: 0, h: 0 }, splitSince: 0, sideways: false, track: null, timers: [], wake: null };
  _guards = g;

  once("phone_interview", phoneDeviceDetails(navigator, window));

  const check = () => {
    const { w, h } = _size();
    g.base = growBase(g.base, w, h);
    // Sideways: allowed while typing code or while a recruiter holds the interview.
    const side = isLandscape(w, h) && !typed() && !paused();
    _rotateCover(side);
    if (side && !g.sideways) once("orientation_changed", `Turned sideways (${w}×${h}) during a spoken question`);
    g.sideways = side;
    if (paused()) {
      g.splitSince = 0;
      return;
    }
    const reason = splitScreenReason({ w, h, baseW: g.base.w, baseH: g.base.h, typing: _typing() });
    if (!reason) {
      g.splitSince = 0;
      return;
    }
    const now = Date.now();
    if (!g.splitSince) g.splitSince = now;
    if (now - g.splitSince >= SPLIT_HOLD_MS) {
      g.splitSince = now;
      once("split_screen", reason);
    }
  };

  const watchCamera = () => {
    try {
      const video = typeof getVideo === "function" ? getVideo() : null;
      const stream = video && video.srcObject;
      const track = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks()[0] : null;
      if (!track || track === g.track) return;
      g.track = track;
      track.addEventListener("mute", () => {
        if (!paused()) once("camera_interrupted", "The camera stopped sending video (a call or another app?)");
      });
      track.addEventListener("ended", () => once("camera_interrupted", "The camera was turned off"));
    } catch (_) {
      /* ignore */
    }
  };

  const keepAwake = async () => {
    try {
      if (document.visibilityState !== "visible" || !navigator.wakeLock) return;
      if (g.wake && !g.wake.released) return;
      g.wake = await navigator.wakeLock.request("screen");
    } catch (_) {
      g.wake = null;
    }
  };

  g.onResize = () => check();
  g.onVisible = () => void keepAwake();
  window.addEventListener("resize", g.onResize);
  window.addEventListener("orientationchange", g.onResize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", g.onResize);
  document.addEventListener("visibilitychange", g.onVisible);
  g.timers.push(window.setInterval(check, 700));
  g.timers.push(window.setInterval(watchCamera, 2000));
  check();
  watchCamera();
  void keepAwake();
}

export function stopPhoneGuards() {
  const g = _guards;
  _guards = null;
  if (!g || typeof window === "undefined") return;
  window.removeEventListener("resize", g.onResize);
  window.removeEventListener("orientationchange", g.onResize);
  if (window.visualViewport) window.visualViewport.removeEventListener("resize", g.onResize);
  document.removeEventListener("visibilitychange", g.onVisible);
  g.timers.forEach((t) => window.clearInterval(t));
  try {
    if (g.wake && !g.wake.released) void g.wake.release();
  } catch (_) {
    /* ignore */
  }
  _rotateCover(false);
}
