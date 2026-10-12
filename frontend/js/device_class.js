/**
 * Laptop / PC only (12 Oct 2026, user decision).
 *
 * The AI interview is recorded (camera + shared screen), proctored, and the
 * coding questions need a keyboard — none of which works on a phone or tablet.
 * An invite link opened on one stops here, before the welcome screen, with a
 * full-page notice and a "Copy link" button so the candidate can move to a
 * computer. The server refuses the same devices on /verify and /login
 * (B-V2 services/device_class.py), so this page is a courtesy, not the lock.
 *
 * Signals, any one of which marks a handheld device:
 *   - the browser says so (`navigator.userAgentData.mobile`),
 *   - a phone / tablet User-Agent (the server checks the same tokens),
 *   - an iPad in "desktop mode" (Macintosh UA + multi-touch),
 *   - a touch-only device (no fine pointer at all) — "desktop site" on a phone.
 * A touchscreen laptop has a fine pointer (its trackpad) and passes.
 */

const HANDHELD_UA =
  /Android|iPhone|iPad|iPod|Mobile|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile|webOS|Silk\/|Kindle|KFAPWI|PlayBook|Tablet/i;

function _matches(query) {
  try {
    return !!(window.matchMedia && window.matchMedia(query).matches);
  } catch (_) {
    return false;
  }
}

/** { handheld: boolean, reason: string } — pure apart from reading navigator. */
export function detectHandheld(nav = typeof navigator !== "undefined" ? navigator : {}) {
  const ua = String(nav.userAgent || "");
  if (nav.userAgentData && nav.userAgentData.mobile === true) {
    return { handheld: true, reason: "ua_data_mobile" };
  }
  if (HANDHELD_UA.test(ua)) return { handheld: true, reason: "user_agent" };
  const touch = Number(nav.maxTouchPoints || 0);
  if (/Macintosh/i.test(ua) && touch > 1) return { handheld: true, reason: "ipad_desktop_mode" };
  if (touch > 0 && !_matches("(any-pointer: fine)") && _matches("(pointer: coarse)")) {
    return { handheld: true, reason: "touch_only" };
  }
  return { handheld: false, reason: "" };
}

let _shown = false;

/**
 * Full-page "open this on a laptop or PC" notice. Covers every other screen
 * (it is appended last with the highest z-index) and cannot be dismissed.
 */
export function showDesktopRequiredScreen({ message } = {}) {
  if (_shown) return;
  _shown = true;
  try {
    document.body.classList.remove("interview-mode");
  } catch (_) {
    /* ignore */
  }
  const link = String(window.location.href || "");
  const wrap = document.createElement("div");
  wrap.id = "screenDesktopRequired";
  wrap.setAttribute("role", "alertdialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-labelledby", "kxDesktopTitle");
  wrap.innerHTML = `
    <style>
      #screenDesktopRequired{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
        padding:20px;background:linear-gradient(160deg,#0b1026 0%,#13235a 55%,#1d4ed8 120%);color:#e2e8f0;
        font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:auto}
      #screenDesktopRequired .kxdr-card{width:100%;max-width:420px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.25);
        border-radius:16px;padding:28px 22px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.45)}
      #screenDesktopRequired .kxdr-icon{width:72px;height:72px;margin:0 auto 16px;border-radius:18px;display:flex;align-items:center;
        justify-content:center;background:linear-gradient(135deg,#2563eb,#7c3aed)}
      #screenDesktopRequired h1{font-size:20px;line-height:1.3;margin:0 0 10px;color:#fff;font-weight:700}
      #screenDesktopRequired p{font-size:14px;line-height:1.55;margin:0 0 14px;color:#cbd5e1}
      #screenDesktopRequired ul{list-style:none;padding:0;margin:0 0 18px;text-align:left;font-size:13px;color:#cbd5e1}
      #screenDesktopRequired li{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid rgba(148,163,184,.15)}
      #screenDesktopRequired li:first-child{border-top:0}
      #screenDesktopRequired li b{color:#93c5fd;font-weight:600;min-width:18px}
      #screenDesktopRequired .kxdr-link{display:block;word-break:break-all;font-size:12px;color:#94a3b8;background:rgba(2,6,23,.55);
        border:1px solid rgba(148,163,184,.2);border-radius:8px;padding:9px 10px;margin:0 0 12px;text-align:left}
      #screenDesktopRequired button{width:100%;min-height:44px;border:0;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;
        color:#fff;background:linear-gradient(135deg,#2563eb,#4f46e5)}
      #screenDesktopRequired .kxdr-note{font-size:12px;color:#94a3b8;margin:12px 0 0}
    </style>
    <div class="kxdr-card">
      <div class="kxdr-icon" aria-hidden="true">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/><circle cx="12" cy="10" r="2"/>
        </svg>
      </div>
      <h1 id="kxDesktopTitle">Please use a laptop or desktop computer</h1>
      <p>${_escape(message || "This interview cannot be taken on a mobile phone or tablet.")}</p>
      <ul>
        <li><b>1</b><span>Open this same interview link on a laptop or PC.</span></li>
        <li><b>2</b><span>Make sure it has a working camera and microphone.</span></li>
        <li><b>3</b><span>Use Google Chrome or Microsoft Edge for the best experience.</span></li>
      </ul>
      <span class="kxdr-link" id="kxDesktopLink">${_escape(link)}</span>
      <button type="button" id="kxDesktopCopy">Copy interview link</button>
      <p class="kxdr-note" id="kxDesktopNote">Send it to yourself by email or chat, then open it on your computer.</p>
    </div>`;
  document.body.appendChild(wrap);
  const btn = wrap.querySelector("#kxDesktopCopy");
  const note = wrap.querySelector("#kxDesktopNote");
  if (btn) {
    btn.addEventListener("click", async () => {
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(link);
          ok = true;
        }
      } catch (_) {
        ok = false;
      }
      if (!ok) {
        try {
          const range = document.createRange();
          range.selectNodeContents(wrap.querySelector("#kxDesktopLink"));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          ok = document.execCommand && document.execCommand("copy");
        } catch (_) {
          ok = false;
        }
      }
      if (note) note.textContent = ok ? "Link copied — open it on your laptop or PC." : "Press and hold the link above to copy it.";
    });
  }
}

function _escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
