/**
 * Skill-wise question bank — the candidate's side (10 Oct 2026, redesigned 12 Oct 2026).
 *
 *  - showSkillPicker(pick, submit)  "Select the skills you have worked on"
 *                                   (mandatory skills ticked + locked).
 *  - showPracticeScreen(kinds)      an unscored try-out of the answer screens
 *                                   before the clock starts.
 *  - presentTypedQuestion(data, h)  a pseudo-code (options) or coding (editor)
 *                                   question: shown on screen, never spoken,
 *                                   with its own timer and Submit / Skip.
 *  - renderStageStrip(data)         the progress strip on the spoken-question
 *                                   screen (every question, by kind).
 *
 * 12 Oct 2026 redesign: light / dark like the dashboard (follows `html.kx-dark`,
 * the same `karnexTheme` key; a toggle in the workspace header), a progress
 * strip of every question marked spoken / pseudo-code / coding, a real code
 * editor (line numbers + syntax colours, js/code_editor.js) with a language
 * picker (C, Embedded C, C++, Java, Kotlin, Python … CAPL, MATLAB), and the
 * candidate's own camera kept visible in a small window while they type.
 *
 * Everything renders into body-level overlays (the page is full screen on
 * <html>, so they stay visible). The keyboard lockdown in interview_security.js
 * already lets plain typing through inside an element marked
 * `data-kx-code-editor`; paste / drop are blocked in the editor, quietly.
 */

import { createCodeEditor, languageLabel, renderCodeBlock, starterFor } from "./code_editor.js";

const STYLE_ID = "kxSkillBankStyles";
const LETTERS = "ABCDEF";
const THEME_KEY = "karnexTheme";

const KIND_LOOK = {
  normal: { label: "Spoken", icon: "mic" },
  pseudo: { label: "Pseudo-code", icon: "braces" },
  coding: { label: "Coding", icon: "code" },
};

const ICONS = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
  braces: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
};

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
  .kxsb-theme{--sb-bg:#f1f5f9;--sb-card:#ffffff;--sb-card-2:#f8fafc;--sb-border:#e2e8f0;--sb-border-2:#cbd5e1;
    --sb-fg:#0f172a;--sb-fg-2:#334155;--sb-muted:#64748b;--sb-brand:#2563eb;--sb-brand-2:#4f46e5;--sb-brand-soft:#eff6ff;
    --sb-spoken:#2563eb;--sb-spoken-soft:#dbeafe;--sb-pseudo:#d97706;--sb-pseudo-soft:#fef3c7;--sb-coding:#059669;--sb-coding-soft:#d1fae5;
    --sb-danger:#dc2626;--sb-danger-soft:#fee2e2;--sb-warn:#b45309;--sb-shadow:0 24px 60px rgba(15,23,42,.18);
    --sb-overlay:rgba(15,23,42,.55);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--sb-fg)}
  html.kx-dark .kxsb-theme{--sb-bg:#0b1224;--sb-card:#0f172a;--sb-card-2:#111c33;--sb-border:rgba(148,163,184,.18);--sb-border-2:rgba(148,163,184,.32);
    --sb-fg:#e2e8f0;--sb-fg-2:#cbd5e1;--sb-muted:#94a3b8;--sb-brand:#60a5fa;--sb-brand-2:#818cf8;--sb-brand-soft:rgba(96,165,250,.12);
    --sb-spoken:#60a5fa;--sb-spoken-soft:rgba(96,165,250,.16);--sb-pseudo:#fbbf24;--sb-pseudo-soft:rgba(251,191,36,.16);
    --sb-coding:#34d399;--sb-coding-soft:rgba(52,211,153,.16);--sb-danger:#f87171;--sb-danger-soft:rgba(248,113,113,.16);--sb-warn:#fcd34d;
    --sb-shadow:0 30px 80px rgba(0,0,0,.55);--sb-overlay:rgba(2,6,23,.82)}
  .kxsb-theme *{box-sizing:border-box}
  .kxsb-overlay{position:fixed;inset:0;z-index:11000;display:flex;align-items:center;justify-content:center;padding:16px;
    background:radial-gradient(circle at 25% 15%,rgba(37,99,235,.22),transparent 45%),var(--sb-overlay);backdrop-filter:blur(8px)}
  .kxsb-card{width:min(880px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:20px;background:var(--sb-card);
    border:1px solid var(--sb-border);box-shadow:var(--sb-shadow);padding:28px}
  .kxsb-eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--sb-brand)}
  .kxsb-title{font-size:24px;font-weight:800;margin:6px 0 4px;color:var(--sb-fg);letter-spacing:-.01em}
  .kxsb-sub{font-size:14px;color:var(--sb-muted);line-height:1.55}
  .kxsb-skills{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:18px}
  .kxsb-skill{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;cursor:pointer;border:1px solid var(--sb-border-2);
    background:var(--sb-card-2);color:var(--sb-fg);font-family:inherit;font-weight:700;font-size:14px;line-height:1.3;text-align:left;transition:border-color .15s,box-shadow .15s}
  .kxsb-skill:hover:not([disabled]){border-color:var(--sb-brand)}
  .kxsb-skill[disabled]{opacity:.45;cursor:not-allowed}
  .kxsb-skill[aria-pressed="true"]{background:linear-gradient(135deg,#2563eb,#4f46e5);border-color:transparent;color:#fff;box-shadow:0 8px 20px rgba(37,99,235,.28)}
  .kxsb-skill[data-locked="true"]{cursor:default}
  .kxsb-tick{width:22px;height:22px;border-radius:7px;border:2px solid var(--sb-border-2);display:grid;place-items:center;flex:none}
  .kxsb-tick svg{width:14px;height:14px}
  .kxsb-skill[aria-pressed="true"] .kxsb-tick{background:#fff;color:#2563eb;border-color:#fff}
  .kxsb-lock{margin-left:auto;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.22)}
  .kxsb-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-top:22px}
  .kxsb-count{font-size:13px;color:var(--sb-muted)}
  .kxsb-btn{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 22px;border-radius:12px;border:0;font-family:inherit;font-weight:800;font-size:14px;cursor:pointer;
    background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;box-shadow:0 10px 25px rgba(37,99,235,.3)}
  .kxsb-btn[disabled]{opacity:.45;cursor:not-allowed;box-shadow:none}
  .kxsb-btn.ghost{background:var(--sb-card);border:1px solid var(--sb-border-2);box-shadow:none;color:var(--sb-fg-2)}
  .kxsb-btn.coding{background:linear-gradient(135deg,#059669,#0d9488);box-shadow:0 10px 25px rgba(5,150,105,.28)}
  .kxsb-btn.pseudo{background:linear-gradient(135deg,#d97706,#ea580c);box-shadow:0 10px 25px rgba(217,119,6,.28)}
  .kxsb-iconbtn{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:10px;border:1px solid var(--sb-border);background:var(--sb-card-2);color:var(--sb-fg-2);cursor:pointer}
  .kxsb-iconbtn svg{width:17px;height:17px}
  .kxsb-err{margin-top:12px;color:var(--sb-danger);font-size:13px;font-weight:600;min-height:18px}
  .kxsb-plan{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
  .kxsb-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:6px 11px;border-radius:999px}
  .kxsb-pill svg{width:14px;height:14px}
  .kxsb-pill.normal{background:var(--sb-spoken-soft);color:var(--sb-spoken)}
  .kxsb-pill.pseudo{background:var(--sb-pseudo-soft);color:var(--sb-pseudo)}
  .kxsb-pill.coding{background:var(--sb-coding-soft);color:var(--sb-coding)}
  .kxsb-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:18px}
  .kxsb-tile{border:1px solid var(--sb-border);border-radius:14px;padding:14px;background:var(--sb-card-2)}
  .kxsb-tile h4{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:14px;color:var(--sb-fg)}
  .kxsb-tile h4 .kxsb-kicon{width:26px;height:26px;border-radius:8px;display:grid;place-items:center}
  .kxsb-tile h4 svg{width:15px;height:15px}
  .kxsb-tile p{margin:0;font-size:13px;color:var(--sb-muted);line-height:1.5}
  .kxsb-kicon.normal{background:var(--sb-spoken-soft);color:var(--sb-spoken)}
  .kxsb-kicon.pseudo{background:var(--sb-pseudo-soft);color:var(--sb-pseudo)}
  .kxsb-kicon.coding{background:var(--sb-coding-soft);color:var(--sb-coding)}
  .kxsb-practice-ed{height:150px;margin-bottom:6px}

  /* progress strip */
  .kxsb-strip{display:flex;flex-direction:column;gap:6px;min-width:0}
  .kxsb-strip-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
  .kxsb-seg{position:relative;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;border:1.5px solid var(--seg-c);
    color:var(--seg-c);background:transparent;flex:none;transition:transform .15s}
  .kxsb-seg svg{width:14px;height:14px}
  .kxsb-seg.normal{--seg-c:var(--sb-spoken);--seg-s:var(--sb-spoken-soft)}
  .kxsb-seg.pseudo{--seg-c:var(--sb-pseudo);--seg-s:var(--sb-pseudo-soft)}
  .kxsb-seg.coding{--seg-c:var(--sb-coding);--seg-s:var(--sb-coding-soft)}
  .kxsb-seg.upcoming{opacity:.55;border-style:dashed}
  .kxsb-seg.done{background:var(--seg-s)}
  .kxsb-seg.done::after{content:"";position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:999px;background:var(--seg-c);
    box-shadow:0 0 0 2px var(--sb-card)}
  .kxsb-seg.current{background:var(--seg-c);color:#fff;transform:scale(1.12);box-shadow:0 0 0 3px var(--seg-s)}
  .kxsb-strip-legend{display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:11px;font-weight:700;color:var(--sb-muted)}
  .kxsb-strip-legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .kxsb-strip-legend .count{margin-left:auto;color:var(--sb-fg-2)}
  /* on the always-dark interview stage */
  .kxsb-stage{margin:2px 0 12px}
  .kxsb-stage .kxsb-theme,.kxsb-stage.kxsb-theme{--sb-spoken:#60a5fa;--sb-spoken-soft:rgba(96,165,250,.18);--sb-pseudo:#fbbf24;
    --sb-pseudo-soft:rgba(251,191,36,.18);--sb-coding:#34d399;--sb-coding-soft:rgba(52,211,153,.18);--sb-muted:#94a3b8;--sb-fg-2:#cbd5e1;--sb-card:#0b1430}

  /* workspace */
  .kxsb-ws{position:fixed;inset:10px;z-index:11000;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;
    background:var(--sb-bg);border:1px solid var(--sb-border);box-shadow:var(--sb-shadow)}
  .kxsb-ws-head{display:flex;align-items:center;gap:12px;padding:12px 18px;background:var(--sb-card);border-bottom:1px solid var(--sb-border);flex-wrap:wrap}
  .kxsb-ws-title{display:flex;align-items:center;gap:10px;min-width:0}
  .kxsb-kbadge{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;color:#fff;flex:none}
  .kxsb-kbadge svg{width:19px;height:19px}
  .kxsb-kbadge.pseudo{background:linear-gradient(135deg,#f59e0b,#ea580c)}.kxsb-kbadge.coding{background:linear-gradient(135deg,#10b981,#0d9488)}
  .kxsb-ws-kind{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--sb-muted)}
  .kxsb-ws-qn{font-size:16px;font-weight:800;color:var(--sb-fg)}
  .kxsb-chip{display:inline-flex;align-items:center;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:var(--sb-brand-soft);color:var(--sb-brand)}
  .kxsb-ws-strip{flex:1;min-width:240px;display:flex;justify-content:center}
  .kxsb-ws-tools{display:flex;align-items:center;gap:8px;margin-left:auto}
  .kxsb-timer{display:inline-flex;align-items:center;gap:7px;font-variant-numeric:tabular-nums;font-weight:800;font-size:18px;padding:6px 12px;
    border-radius:11px;background:var(--sb-card-2);border:1px solid var(--sb-border);color:var(--sb-fg)}
  .kxsb-timer svg{width:17px;height:17px;color:var(--sb-muted)}
  .kxsb-timer.low{background:var(--sb-danger-soft);border-color:var(--sb-danger);color:var(--sb-danger)}
  .kxsb-timer.low svg{color:var(--sb-danger)}
  .kxsb-timebar{height:3px;background:var(--sb-border)}
  .kxsb-timebar>i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#2563eb,#4f46e5);transition:width .5s linear}
  .kxsb-timebar.low>i{background:var(--sb-danger)}
  .kxsb-ws-body{flex:1;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:14px;padding:14px;min-height:0}
  .kxsb-ws-body.pseudo{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .kxsb-pane{display:flex;flex-direction:column;min-height:0;border-radius:14px;background:var(--sb-card);border:1px solid var(--sb-border);overflow:hidden}
  .kxsb-pane-h{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--sb-border);font-size:12px;font-weight:800;
    letter-spacing:.08em;text-transform:uppercase;color:var(--sb-muted)}
  .kxsb-pane-h .grow{flex:1}
  .kxsb-pane-b{flex:1;min-height:0;overflow:auto;padding:16px}
  .kxsb-q{font-size:17px;font-weight:700;color:var(--sb-fg);line-height:1.55;white-space:pre-wrap}
  .kxsb-hint{margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--sb-card-2);border:1px dashed var(--sb-border-2);font-size:12.5px;color:var(--sb-muted);line-height:1.5}
  .kxsb-snippet{margin-top:14px}
  .kxsb-opts{display:flex;flex-direction:column;gap:10px}
  .kxsb-opt{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border-radius:12px;cursor:pointer;border:1.5px solid var(--sb-border-2);
    background:var(--sb-card-2);color:var(--sb-fg);font:500 15px/1.45 "JetBrains Mono",Consolas,monospace;text-align:left;transition:border-color .15s,background .15s}
  .kxsb-opt:hover{border-color:var(--sb-pseudo)}
  .kxsb-opt[aria-checked="true"]{border-color:var(--sb-pseudo);background:var(--sb-pseudo-soft)}
  .kxsb-letter{width:30px;height:30px;border-radius:999px;display:grid;place-items:center;flex:none;font:800 13px Inter,sans-serif;background:var(--sb-border);color:var(--sb-fg-2)}
  .kxsb-opt[aria-checked="true"] .kxsb-letter{background:var(--sb-pseudo);color:#fff}
  .kxsb-edtools{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--sb-border);flex-wrap:wrap}
  .kxsb-select{height:34px;padding:0 30px 0 10px;border-radius:9px;border:1px solid var(--sb-border-2);background:var(--sb-card-2);color:var(--sb-fg);font-family:inherit;font-weight:700;font-size:13px;cursor:pointer}
  .kxsb-smallbtn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--sb-border);
    background:var(--sb-card-2);color:var(--sb-fg-2);font-family:inherit;font-weight:700;font-size:12px;cursor:pointer}
  .kxsb-smallbtn svg{width:14px;height:14px}
  .kxsb-edbody{flex:1;min-height:0;display:flex;padding:10px}
  .kxsb-edbody>.kxce{flex:1}
  .kxsb-status{display:flex;align-items:center;gap:12px;padding:6px 12px;border-top:1px solid var(--sb-border);font-size:11.5px;font-weight:600;color:var(--sb-muted)}
  .kxsb-status .grow{flex:1}
  .kxsb-note{font-size:12px;color:var(--sb-muted)}
  .kxsb-note.warn{color:var(--sb-warn);font-weight:700}
  .kxsb-ws-foot{display:flex;align-items:center;gap:10px;padding:12px 18px;background:var(--sb-card);border-top:1px solid var(--sb-border)}
  .kxsb-ws-foot .kxsb-btn{height:42px}
  .kxsb-ws-foot .grow{flex:1;min-width:0}
  /* camera window */
  .kxsb-cam{position:absolute;left:24px;bottom:78px;z-index:2;width:196px;border-radius:14px;overflow:hidden;background:#000;
    border:2px solid var(--sb-card);box-shadow:0 12px 30px rgba(0,0,0,.35)}
  .kxsb-cam video{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;transform:scaleX(-1)}
  .kxsb-cam-bar{position:absolute;inset:auto 0 0 0;display:flex;align-items:center;gap:6px;padding:5px 8px;background:linear-gradient(transparent,rgba(0,0,0,.7));
    color:#fff;font-size:11px;font-weight:700}
  .kxsb-cam-bar .dot{width:7px;height:7px;border-radius:999px;background:#ef4444;animation:kxsbBlink 1.4s infinite}
  .kxsb-cam-bar button{margin-left:auto;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;border:0;background:rgba(255,255,255,.18);color:#fff;cursor:pointer}
  .kxsb-cam-bar button svg{width:13px;height:13px}
  .kxsb-cam.min{width:auto}
  .kxsb-cam.min video{display:none}
  .kxsb-cam.min .kxsb-cam-bar{position:static;background:#0f172a}
  .kxsb-cam.off{display:none}
  .kxsb-ws.has-cam .kxsb-left .kxsb-pane-b{padding-bottom:170px}
  @keyframes kxsbBlink{50%{opacity:.25}}
  @media (prefers-reduced-motion:reduce){.kxsb-cam-bar .dot{animation:none}.kxsb-seg{transition:none}}
  @media (max-width:980px){.kxsb-ws-body,.kxsb-ws-body.pseudo{grid-template-columns:1fr;overflow:auto}.kxsb-pane{min-height:320px}
    .kxsb-ws-strip{order:3;flex-basis:100%}.kxsb-cam{width:132px;bottom:76px}}
  `;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function icon(name) {
  return h("span", { "aria-hidden": "true", html: ICONS[name] || "", style: "display:inline-flex" });
}

/* ------------------------------------------------------------------------- */
/* Theme                                                                     */
/* ------------------------------------------------------------------------- */

function isDark() {
  return document.documentElement.classList.contains("kx-dark");
}

/** Flip light / dark — the same key the dashboard and the page's boot script read. */
function toggleTheme() {
  const dark = !isDark();
  document.documentElement.classList.toggle("kx-dark", dark);
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    /* private mode: the toggle still works for this page */
  }
  return dark;
}

function themeButton() {
  const btn = h("button", { class: "kxsb-iconbtn", type: "button" });
  const paint = () => {
    btn.innerHTML = isDark() ? ICONS.sun : ICONS.moon;
    btn.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
    btn.title = btn.getAttribute("aria-label");
  };
  btn.addEventListener("click", () => {
    toggleTheme();
    paint();
  });
  paint();
  return btn;
}

/* ------------------------------------------------------------------------- */
/* Progress strip                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Every scored question as a small tile: spoken (mic) · pseudo-code (braces) ·
 * coding (code); done tiles are filled, the current one is solid, the rest dashed.
 * `current` is 1-based (0 = the warm-up, nothing current yet).
 */
export function buildStrip(map, current, { legend = true } = {}) {
  const items = Array.isArray(map) ? map : [];
  const row = h("div", { class: "kxsb-strip-row", role: "list", "aria-label": "Interview questions" });
  items.forEach((q, i) => {
    const kind = KIND_LOOK[q?.kind] ? q.kind : "normal";
    const n = i + 1;
    const state = n < current ? "done" : n === current ? "current" : "upcoming";
    const look = KIND_LOOK[kind];
    const word = state === "done" ? "answered" : state === "current" ? "now" : "coming up";
    row.appendChild(h("span", {
      class: `kxsb-seg ${kind} ${state}`,
      role: "listitem",
      title: `Question ${n} · ${look.label}${q?.skill ? ` · ${q.skill}` : ""} · ${word}`,
      "aria-label": `Question ${n}, ${look.label}, ${word}`,
      "aria-current": state === "current" ? "step" : null,
    }, [icon(look.icon)]));
  });
  const wrap = h("div", { class: "kxsb-strip" }, [row]);
  if (legend) {
    const counts = { normal: 0, pseudo: 0, coding: 0 };
    items.forEach((q) => { counts[KIND_LOOK[q?.kind] ? q.kind : "normal"] += 1; });
    const leg = h("div", { class: "kxsb-strip-legend" });
    for (const k of ["normal", "pseudo", "coding"]) {
      if (!counts[k]) continue;
      leg.appendChild(h("span", {}, [h("i", { style: `background:var(--sb-${k === "normal" ? "spoken" : k})` }),
        `${KIND_LOOK[k].label} ${counts[k]}`]));
    }
    // The current question's skill beside the count (12 Oct 2026) — the strip's
    // icons say WHAT kind of answer; this says which skill it tests.
    const nowSkill = current > 0 ? (items[current - 1]?.skill || "") : "";
    leg.appendChild(h("span", { class: "count", text: current > 0
      ? `Question ${current} of ${items.length}${nowSkill ? ` · ${nowSkill}` : ""}`
      : `${items.length} questions` }));
    wrap.appendChild(leg);
  }
  return wrap;
}

/**
 * The strip on the spoken-question screen (`#kxQuestionStrip`). Shown only for a
 * skill-wise interview (the server sends `question_map`); hidden otherwise.
 */
export function renderStageStrip(data) {
  const host = document.getElementById("kxQuestionStrip");
  if (!host) return;
  const map = Array.isArray(data?.question_map) ? data.question_map : [];
  if (!map.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  injectStyles();
  host.className = "kxsb-stage kxsb-theme";
  host.hidden = false;
  host.innerHTML = "";
  host.appendChild(buildStrip(map, data?.is_warmup ? 0 : Number(data?.index) || 0));
}

function planPills(plan) {
  if (!plan || typeof plan !== "object") return null;
  const bits = [];
  if (plan.normal) bits.push(["normal", `${plan.normal} spoken question${plan.normal === 1 ? "" : "s"}`]);
  if (plan.pseudo) bits.push(["pseudo", `${plan.pseudo} pseudo-code (pick an option)`]);
  if (plan.coding) bits.push(["coding", `${plan.coding} coding (type code)`]);
  if (!bits.length) return null;
  return h("div", { class: "kxsb-plan" }, bits.map(([k, t]) => h("span", { class: `kxsb-pill ${k}` }, [icon(KIND_LOOK[k].icon), t])));
}

/* ------------------------------------------------------------------------- */
/* Skill picker                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Resolves with the confirmed skills once `submit(skills)` succeeds.
 * `submit` must resolve `{ ok: true, plan? }` or `{ ok: false, error }`.
 */
export function showSkillPicker(pick, submit) {
  injectStyles();
  return new Promise((resolve) => {
    const offered = Array.isArray(pick?.offered) ? pick.offered : [];
    const mandatory = new Set((pick?.mandatory || []).map((s) => String(s).toLowerCase()));
    const min = Math.max(0, Number(pick?.min) || 0);
    const max = Math.max(min, Number(pick?.max) || offered.length);
    const chosen = new Set(offered.filter((s) => mandatory.has(String(s).toLowerCase())));
    const count = h("div", { class: "kxsb-count" });
    const err = h("div", { class: "kxsb-err", role: "alert" });
    const btn = h("button", { class: "kxsb-btn", type: "button", text: "Continue" });
    const buttons = [];

    const refresh = () => {
      const n = chosen.size;
      count.textContent = `${n} selected · choose ${min === max ? min : `${min} to ${max}`} skill${max === 1 ? "" : "s"}`;
      btn.disabled = n < min || n > max;
      for (const b of buttons) {
        const s = b.dataset.skill;
        const on = chosen.has(s);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.querySelector(".kxsb-tick").innerHTML = on ? ICONS.check : "";
        if (b.dataset.locked !== "true") b.disabled = !on && n >= max;
      }
    };

    for (const s of offered) {
      const locked = mandatory.has(String(s).toLowerCase());
      const b = h("button", {
        class: "kxsb-skill", type: "button", "data-skill": s, "data-locked": locked ? "true" : "false",
        "aria-pressed": "false",
        onclick: () => {
          if (locked) return;
          if (chosen.has(s)) chosen.delete(s); else if (chosen.size < max) chosen.add(s);
          err.textContent = "";
          refresh();
        },
      }, [h("span", { class: "kxsb-tick" }), h("span", { text: s }), locked ? h("span", { class: "kxsb-lock", text: "Required" }) : null]);
      buttons.push(b);
    }

    const overlay = h("div", { class: "kxsb-overlay kxsb-theme", role: "dialog", "aria-modal": "true", "aria-label": "Select your skills" }, [
      h("div", { class: "kxsb-card" }, [
        h("div", { style: "display:flex;align-items:flex-start;gap:12px" }, [
          h("div", { style: "flex:1;min-width:0" }, [
            h("div", { class: "kxsb-eyebrow", text: "Before we begin" }),
            h("div", { class: "kxsb-title", text: "Select the skills you have worked on" }),
          ]),
          themeButton(),
        ]),
        h("div", {
          class: "kxsb-sub",
          text: "You will only be asked about the skills you select. Skills marked Required are part of the role and are always included. Choose honestly — you can't change this after you continue.",
        }),
        h("div", { class: "kxsb-skills" }, buttons),
        planPills(pick?.plan),
        err,
        h("div", { class: "kxsb-foot" }, [count, btn]),
      ]),
    ]);

    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Preparing your questions…";
      err.textContent = "";
      const skills = offered.filter((s) => chosen.has(s));
      let res = { ok: false, error: "Could not save your skills. Please try again." };
      try {
        res = (await submit(skills)) || res;
      } catch (e) {
        res = { ok: false, error: e?.message || res.error };
      }
      if (res.ok) {
        overlay.remove();
        resolve(skills);
        return;
      }
      err.textContent = res.error || "Could not save your skills.";
      btn.textContent = "Continue";
      refresh();
    });

    document.body.appendChild(overlay);
    refresh();
  });
}

/* ------------------------------------------------------------------------- */
/* Practice screen                                                           */
/* ------------------------------------------------------------------------- */

/** Unscored walkthrough of the answer screens. Resolves when the candidate starts. */
export function showPracticeScreen(kinds = ["normal"]) {
  injectStyles();
  const want = new Set(kinds || ["normal"]);
  return new Promise((resolve) => {
    const tile = (kind, title, text) => h("div", { class: "kxsb-tile" }, [
      h("h4", {}, [h("span", { class: `kxsb-kicon ${kind}` }, [icon(KIND_LOOK[kind].icon)]), title]),
      h("p", { text }),
    ]);
    const tiles = [tile("normal", "Spoken questions",
      "The interviewer reads each question aloud. Answer by speaking, then tap Send Response (or just stop — it moves on after a short pause). Skip if you don't know.")];
    if (want.has("pseudo")) {
      tiles.push(tile("pseudo", "Pseudo-code questions",
        "A small piece of code is shown on the left — read it and click the correct option on the right. No speaking."));
    }
    if (want.has("coding")) {
      tiles.push(tile("coding", "Coding question",
        "The problem is on the left and an editor on the right. Pick your language, type your code — copy / paste is turned off — and press “Run & submit” before the timer ends. The AI checks whether your code solves the problem."));
    }
    let sampleArea = null;
    if (want.has("pseudo") || want.has("coding")) {
      const fb = h("div", { class: "kxsb-note", "aria-live": "polite", style: "margin-top:8px" });
      const opts = ["4", "6", "8"].map((label, i) => h("button", {
        class: "kxsb-opt", type: "button", role: "radio", "aria-checked": "false",
        onclick: () => {
          opts.forEach((o, j) => o.setAttribute("aria-checked", j === i ? "true" : "false"));
          fb.textContent = i === 1 ? "Correct — that's how you answer an option question." : "Not quite — but that's how you choose. (2 × 3 = 6)";
        },
      }, [h("span", { class: "kxsb-letter", text: LETTERS[i] }), h("span", { text: label })]));
      const note = h("div", { class: "kxsb-note" });
      const editor = want.has("coding")
        ? createCodeEditor({ value: 'print("hello")\n', language: "python", ariaLabel: "Practice editor",
          onBlocked: (m) => { note.textContent = m; note.classList.add("warn"); } })
        : null;
      if (editor) editor.el.classList.add("kxsb-practice-ed");
      sampleArea = h("div", { class: "kxsb-tiles" }, [
        h("div", { class: "kxsb-tile" }, [
          h("h4", { text: "Try it: what does this print?" }),
          renderCodeBlock("x = 2\ny = x * 3\nprint(y)", "python"),
          h("div", { class: "kxsb-opts", style: "margin-top:10px" }, opts),
          fb,
        ]),
        editor ? h("div", { class: "kxsb-tile" }, [
          h("h4", { text: "Try the editor" }),
          editor.el,
          h("div", { class: "kxsb-note", text: "Line numbers and colours help you read your code. Tab indents. Nothing here is saved or scored." }),
          note,
        ]) : null,
      ]);
    }
    const start = h("button", { class: "kxsb-btn", type: "button", text: "I'm ready — start the interview" });
    const overlay = h("div", { class: "kxsb-overlay kxsb-theme", role: "dialog", "aria-modal": "true", "aria-label": "Practice" }, [
      h("div", { class: "kxsb-card" }, [
        h("div", { style: "display:flex;align-items:flex-start;gap:12px" }, [
          h("div", { style: "flex:1;min-width:0" }, [
            h("div", { class: "kxsb-eyebrow", text: "Practice · not scored" }),
            h("div", { class: "kxsb-title", text: "How you will answer" }),
          ]),
          themeButton(),
        ]),
        h("div", { class: "kxsb-sub", text: "Take a minute to see the answer screens. The interview clock starts only when you continue." }),
        h("div", { class: "kxsb-tiles" }, tiles),
        sampleArea,
        h("div", { class: "kxsb-foot" }, [h("div", { class: "kxsb-count", text: "Stay in full screen and keep your face in the camera throughout." }), start]),
      ]),
    ]);
    start.addEventListener("click", () => { overlay.remove(); resolve(); });
    document.body.appendChild(overlay);
    start.focus();
  });
}

/* ------------------------------------------------------------------------- */
/* Typed questions (pseudo-code / coding)                                    */
/* ------------------------------------------------------------------------- */

let _ws = null; // { el, timer, data, getAnswer, done, video }

export function isTypedPayload(data) {
  const k = String(data?.kind || "").toLowerCase();
  return k === "pseudo" || k === "coding";
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A pseudo-code / coding panel is on screen (the camera monitor lets the
 * candidate look down at the keyboard while one is open). */
export function isTypedQuestionOpen() {
  return !!(_ws && !_ws.done);
}

export function closeTypedQuestion() {
  if (!_ws) return;
  window.clearInterval(_ws.timer);
  if (_ws.video) {
    // Only detach — the stream belongs to the proctoring feed and keeps running.
    try { _ws.video.srcObject = null; } catch { /* ignore */ }
  }
  _ws.el.remove();
  _ws = null;
}

/** What is on screen right now (for an interview that ends mid-question). */
export function typedAnswerSnapshot() {
  if (!_ws || _ws.done) return null;
  return _ws.getAnswer();
}

/** The camera window: the proctoring feed's own stream, shown small while typing. */
function cameraWindow(getStream) {
  let stream = null;
  try { stream = typeof getStream === "function" ? getStream() : null; } catch { stream = null; }
  const video = h("video", { autoplay: true, playsinline: true, muted: true, "aria-label": "Your camera" });
  video.muted = true;
  const minBtn = h("button", { type: "button", "aria-label": "Minimise camera", title: "Minimise camera", html: ICONS.min });
  const box = h("div", { class: "kxsb-cam" }, [
    video,
    h("div", { class: "kxsb-cam-bar" }, [h("span", { class: "dot", "aria-hidden": "true" }), "You · recording", minBtn]),
  ]);
  minBtn.addEventListener("click", () => {
    const min = box.classList.toggle("min");
    minBtn.innerHTML = min ? ICONS.cam : ICONS.min;
    minBtn.setAttribute("aria-label", min ? "Show camera" : "Minimise camera");
    minBtn.title = minBtn.getAttribute("aria-label");
  });
  if (stream) {
    try {
      video.srcObject = stream;
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      box.classList.add("off");
    }
  } else {
    box.classList.add("off");
  }
  return { box, video, live: !!stream };
}

/**
 * Show one pseudo-code / coding question. `handlers.onSubmit(result)` gets
 * `{ kind, ans, choice, language, skipped, trigger }` exactly once.
 * `handlers.getCameraStream()` → the proctoring MediaStream (shown small).
 * The payload's `question_map` draws the progress strip.
 */
export function presentTypedQuestion(data, handlers = {}) {
  injectStyles();
  closeTypedQuestion();
  const kind = String(data.kind || "").toLowerCase() === "coding" ? "coding" : "pseudo";
  const limit = Math.max(0, Number(data.answer_time_limit_sec) || 0);
  const startedAt = Date.now();
  const timerText = h("span", { text: limit ? fmt(limit) : "--:--" });
  const timerEl = h("div", { class: "kxsb-timer", role: "timer", "aria-label": "Time left on this question" }, [icon("clock"), timerText]);
  const timeBar = h("div", { class: "kxsb-timebar", "aria-hidden": "true" }, [h("i")]);
  const note = h("div", { class: "kxsb-note", "aria-live": "polite" });
  const submitLabel = kind === "coding" ? "Run & submit" : "Submit answer";
  const submitBtn = h("button", { class: `kxsb-btn ${kind}`, type: "button", text: submitLabel });
  const skipBtn = h("button", { class: "kxsb-btn ghost", type: "button", text: "Skip question" });
  let choice = -1;
  let editor = null;
  let lang = "";
  let starter = "";
  let right;
  let left;

  const total = Number(data.total) || 0;
  const index = Number(data.index) || 0;
  const map = Array.isArray(data.question_map) ? data.question_map : [];

  if (kind === "pseudo") {
    const opts = (data.options || []).map((label, i) => h("button", {
      class: "kxsb-opt", type: "button", role: "radio", "aria-checked": "false",
      onclick: () => {
        choice = i;
        opts.forEach((o, j) => o.setAttribute("aria-checked", j === i ? "true" : "false"));
        submitBtn.disabled = false;
      },
    }, [h("span", { class: "kxsb-letter", text: LETTERS[i] }), h("span", { text: String(label) })]));
    right = h("section", { class: "kxsb-pane" }, [
      h("div", { class: "kxsb-pane-h" }, [h("span", { text: "Choose one option" })]),
      h("div", { class: "kxsb-pane-b" }, [h("div", { class: "kxsb-opts", role: "radiogroup", "aria-label": "Options" }, opts), note]),
    ]);
    submitBtn.disabled = true;
    const codeLang = data.language && data.language !== "any" ? data.language : "pseudo";
    left = h("section", { class: "kxsb-pane kxsb-left" }, [
      h("div", { class: "kxsb-pane-h" }, [h("span", { class: "grow", text: "Question" }),
        h("span", { class: "kxsb-chip", text: languageLabel(codeLang) })]),
      h("div", { class: "kxsb-pane-b" }, [
        h("div", { class: "kxsb-q", text: String(data.question || "") }),
        data.code ? h("div", { class: "kxsb-snippet" }, [renderCodeBlock(String(data.code), codeLang)]) : null,
        h("div", { class: "kxsb-hint", text: "Trace the code line by line, then pick the option that matches. Only one option is fully right." }),
      ]),
    ]);
  } else {
    const allowed = (Array.isArray(data.languages) && data.languages.length ? data.languages : ["python"]).map(String);
    const preferred = String(data.language || "").toLowerCase();
    lang = allowed.includes(preferred) ? preferred : allowed[0];
    const starters = data.starters && typeof data.starters === "object" ? data.starters : {};
    // The question's legacy single starter belongs to its own language only.
    const legacy = (l) => (data.code && (l === preferred || (preferred === "any" && l === allowed[0])) ? String(data.code) : "");
    starter = starterFor(lang, starters, legacy(lang));
    const pos = h("span", { text: "Ln 1, Col 1" });
    editor = createCodeEditor({
      value: starter, language: lang, ariaLabel: "Your code",
      onCursor: ({ line, col }) => { pos.textContent = `Ln ${line}, Col ${col}`; },
      onBlocked: (m) => { note.textContent = m; note.classList.add("warn"); },
      onChange: () => { if (note.classList.contains("warn")) { note.textContent = ""; note.classList.remove("warn"); } },
    });
    const langLabel = h("span", { text: languageLabel(lang) });
    const select = h("select", { class: "kxsb-select", "aria-label": "Programming language" },
      allowed.map((k) => h("option", { value: k, text: languageLabel(k) })));
    select.value = lang;
    select.disabled = allowed.length < 2;
    select.addEventListener("change", () => {
      const untouched = editor.getValue().trim() === starter.trim() || !editor.getValue().trim();
      lang = select.value;
      const nextStarter = starterFor(lang, starters, legacy(lang));
      editor.setLanguage(lang);
      langLabel.textContent = languageLabel(lang);
      if (untouched) {
        editor.setValue(nextStarter);
        note.textContent = "";
      } else {
        note.textContent = `Your code was kept. “Reset” loads the ${languageLabel(lang)} template.`;
        note.classList.remove("warn");
      }
      starter = nextStarter;
      editor.focus();
    });
    const resetBtn = h("button", { class: "kxsb-smallbtn", type: "button", title: "Load the starter template again" }, [icon("reset"), "Reset"]);
    resetBtn.addEventListener("click", () => {
      editor.setValue(starter);
      note.textContent = "Starter template loaded.";
      note.classList.remove("warn");
      editor.focus();
    });
    right = h("section", { class: "kxsb-pane" }, [
      h("div", { class: "kxsb-edtools" }, [
        h("label", { class: "kxsb-note", style: "font-weight:800", text: "Language" }), select, resetBtn,
        h("span", { style: "flex:1" }), note,
      ]),
      h("div", { class: "kxsb-edbody" }, [editor.el]),
      h("div", { class: "kxsb-status" }, [pos, langLabel, h("span", { text: "Tab indents · copy / paste is off" }), h("span", { class: "grow" })]),
    ]);
    left = h("section", { class: "kxsb-pane kxsb-left" }, [
      h("div", { class: "kxsb-pane-h" }, [h("span", { class: "grow", text: "Problem" })]),
      h("div", { class: "kxsb-pane-b" }, [
        h("div", { class: "kxsb-q", text: String(data.question || "") }),
        h("div", { class: "kxsb-hint", text: "Write working logic in the language you pick, then press “Run & submit”. The AI checks whether your code solves the problem — correct, partly correct or incorrect. Small syntax slips are not penalised; comments that explain your approach help." }),
      ]),
    ]);
  }

  const cam = cameraWindow(handlers.getCameraStream);
  const head = h("header", { class: "kxsb-ws-head" }, [
    h("div", { class: "kxsb-ws-title" }, [
      h("span", { class: `kxsb-kbadge ${kind}` }, [icon(KIND_LOOK[kind].icon)]),
      h("div", {}, [
        h("div", { class: "kxsb-ws-kind", text: `${KIND_LOOK[kind].label} question · no voice` }),
        h("div", { class: "kxsb-ws-qn" }, [
          total ? `Question ${index} of ${total}` : "Question",
          data.skill ? h("span", { class: "kxsb-chip", style: "margin-left:8px", text: String(data.skill) }) : null,
        ]),
      ]),
    ]),
    map.length ? h("div", { class: "kxsb-ws-strip" }, [buildStrip(map, index, { legend: false })]) : h("div", { style: "flex:1" }),
    h("div", { class: "kxsb-ws-tools" }, [timerEl, themeButton()]),
  ]);

  const el = h("div", {
    class: `kxsb-ws kxsb-theme${cam.live ? " has-cam" : ""}`, role: "dialog", "aria-modal": "true",
    "aria-label": kind === "pseudo" ? "Pseudo-code question" : "Coding question",
  }, [
    head,
    limit ? timeBar : null,
    h("div", { class: `kxsb-ws-body ${kind}` }, [left, right]),
    cam.box,
    h("footer", { class: "kxsb-ws-foot" }, [
      h("div", { class: "grow kxsb-note", text: "This question is read on screen — there is no voice. Stay in full screen and keep your face in the camera." }),
      skipBtn, submitBtn,
    ]),
  ]);

  const getAnswer = () => (kind === "pseudo"
    ? { kind, ans: choice >= 0 ? `Option ${LETTERS[choice]}` : "", choice: choice >= 0 ? choice : null, language: "" }
    : { kind, ans: String(editor?.getValue() || "").replace(/\s+$/, ""), choice: null, language: lang });

  const finish = (trigger, forceSkip = false) => {
    if (!_ws || _ws.done) return;
    _ws.done = true;
    window.clearInterval(_ws.timer);
    submitBtn.disabled = true;
    skipBtn.disabled = true;
    const a = getAnswer();
    const empty = kind === "pseudo" ? a.choice === null : !a.ans.trim() || a.ans.trim() === String(starter || "").trim();
    const skipped = forceSkip || empty;
    submitBtn.textContent = skipped ? "Skipping…" : kind === "coding" ? "Running…" : "Saving…";
    Promise.resolve(handlers.onSubmit?.({ ...a, skipped, trigger }))
      .then((res) => {
        if (res && res.retry) {
          // The server refused (e.g. network) — give the candidate the panel back.
          if (_ws) _ws.done = false;
          submitBtn.disabled = kind === "pseudo" ? choice < 0 : false;
          skipBtn.disabled = false;
          submitBtn.textContent = submitLabel;
          note.textContent = res.message || "Could not save — please try again.";
          note.classList.add("warn");
        }
      });
  };

  submitBtn.addEventListener("click", () => finish("submit"));
  skipBtn.addEventListener("click", () => finish("skip", true));

  const timer = limit
    ? window.setInterval(() => {
        const leftSec = limit - (Date.now() - startedAt) / 1000;
        timerText.textContent = fmt(leftSec);
        const low = leftSec <= 30;
        timerEl.classList.toggle("low", low);
        timeBar.classList.toggle("low", low);
        timeBar.firstChild.style.width = `${Math.max(0, Math.min(100, (leftSec / limit) * 100))}%`;
        if (leftSec <= 0) finish("time_limit");
      }, 500)
    : 0;

  _ws = { el, timer, data, getAnswer, done: false, video: cam.video };
  document.body.appendChild(el);
  window.setTimeout(() => (editor ? editor.focus() : right.querySelector(".kxsb-opt")?.focus()), 50);
}
