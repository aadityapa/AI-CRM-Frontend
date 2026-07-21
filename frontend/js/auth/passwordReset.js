/**
 * Forgot-password / reset-password panes + show-password eye toggles.
 * (July 2026 auth redesign.)
 *
 * Self-initializing ES module, loaded from index.html right after js/app.js:
 *   <script type="module" src="js/auth/passwordReset.js?v=1"></script>
 *
 * Pane model (CSS in index.html drives visibility off these classes):
 *   #authWrapper                -> sign-in pane (default)
 *   #authWrapper.toggled        -> sign-up pane (existing switchAuthMode flow)
 *   #authWrapper.mode-forgot    -> #authPaneForgot
 *   #authWrapper.mode-reset     -> #authPaneReset
 *
 * Deep link: opening the page with ?reset_token=... lands directly on the
 * Reset pane (js/app.js bootstrapInviteFlow also short-circuits the startup
 * hero for this case). The token is stripped from the URL via
 * history.replaceState once the user heads back to sign-in.
 */
import { apiFetch } from "../core.js";

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

const byId = (id) => document.getElementById(id);
const wrapper = () => byId("authWrapper");

function readResetTokenFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("reset_token") || "";
  } catch (_) {
    return "";
  }
}

let resetToken = readResetTokenFromUrl();

/* ------------------------------------------------------------- pane state */

function clearGlobalAuthStatus() {
  const status = byId("authStatus");
  if (status) status.innerText = "";
}

function setPaneMode(mode) {
  const w = wrapper();
  if (!w) return;
  w.classList.remove("mode-forgot", "mode-reset");
  if (mode === "forgot") w.classList.add("mode-forgot");
  else if (mode === "reset") w.classList.add("mode-reset");
  clearGlobalAuthStatus();
}

function showInline(el, text) {
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

function hideInline(el) {
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

function resetForgotPane() {
  const email = byId("authForgotEmail");
  if (email) email.value = "";
  hideInline(byId("forgotError"));
  const form = byId("forgotFormBlock");
  if (form) form.hidden = false;
  const success = byId("forgotSuccessBlock");
  if (success) success.hidden = true;
  const btn = byId("forgotSubmitBtn");
  if (btn) {
    btn.disabled = false;
    btn.innerText = "Send reset link";
  }
}

function resetResetPane() {
  const pass = byId("authResetPassword");
  const confirm = byId("authResetConfirm");
  if (pass) pass.value = "";
  if (confirm) confirm.value = "";
  hideInline(byId("resetError"));
  const actions = byId("resetErrorActions");
  if (actions) actions.hidden = true;
  const form = byId("resetFormBlock");
  if (form) form.hidden = false;
  const success = byId("resetSuccessBlock");
  if (success) success.hidden = true;
  const btn = byId("resetSubmitBtn");
  if (btn) {
    btn.disabled = false;
    btn.innerText = "Update password";
  }
}

function openForgotPane() {
  resetForgotPane();
  setPaneMode("forgot");
  window.setTimeout(() => byId("authForgotEmail")?.focus(), 280);
}

function backToSignIn() {
  setPaneMode(null);
  if (typeof window.switchAuthMode === "function") window.switchAuthMode("login");
}

function stripResetTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("reset_token")) return;
    url.searchParams.delete("reset_token");
    const qs = url.searchParams.toString();
    window.history.replaceState({}, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash || ""}`);
  } catch (_) {
    /* ignore — cosmetic only */
  }
}

/* -------------------------------------------------------------- API calls */

async function submitForgot() {
  const emailEl = byId("authForgotEmail");
  const errEl = byId("forgotError");
  const btn = byId("forgotSubmitBtn");
  const email = emailEl ? emailEl.value.trim() : "";
  if (!email) {
    showInline(errEl, "Enter your email address first.");
    emailEl?.focus();
    return;
  }
  hideInline(errEl);
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Sending...";
  }
  try {
    await apiFetch("/auth/forgot-password", {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ email }),
    });
    // Anti-enumeration: identical outcome whether or not the account exists.
    const form = byId("forgotFormBlock");
    if (form) form.hidden = true;
    const success = byId("forgotSuccessBlock");
    if (success) success.hidden = false;
  } catch (_) {
    showInline(errEl, "Could not reach the server. Check your connection and try again.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "Send reset link";
    }
  }
}

async function submitReset() {
  const passEl = byId("authResetPassword");
  const confirmEl = byId("authResetConfirm");
  const errEl = byId("resetError");
  const actionsEl = byId("resetErrorActions");
  const btn = byId("resetSubmitBtn");
  const pass = passEl ? passEl.value : "";
  const confirm = confirmEl ? confirmEl.value : "";
  if (actionsEl) actionsEl.hidden = true;
  if (pass.length < 8) {
    showInline(errEl, "Password must be at least 8 characters long.");
    passEl?.focus();
    return;
  }
  if (pass !== confirm) {
    showInline(errEl, "Passwords do not match.");
    confirmEl?.focus();
    return;
  }
  if (!resetToken) {
    showInline(errEl, "This reset link is missing its token. Request a new one below.");
    if (actionsEl) actionsEl.hidden = false;
    return;
  }
  hideInline(errEl);
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Updating...";
  }
  try {
    const res = await apiFetch("/auth/reset-password", {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ token: resetToken, new_password: pass }),
    });
    if (res.ok) {
      const form = byId("resetFormBlock");
      if (form) form.hidden = true;
      const success = byId("resetSuccessBlock");
      if (success) success.hidden = false;
      return;
    }
    // 400 etc. — surface the server's message (e.g. expired link) inline.
    let message = "This reset link is invalid or has expired.";
    try {
      const data = await res.json();
      const serverMsg = data.error || data.detail || data.message;
      if (typeof serverMsg === "string" && serverMsg.trim()) message = serverMsg;
    } catch (_) {
      /* non-JSON body — keep the default message */
    }
    showInline(errEl, message);
    if (actionsEl) actionsEl.hidden = false;
  } catch (_) {
    showInline(errEl, "Could not reach the server. Check your connection and try again.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "Update password";
    }
  }
}

/* ----------------------------------------------------------------- wiring */

function initPasswordToggles() {
  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = byId(btn.getAttribute("data-target") || "");
      if (!input) return;
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      btn.classList.toggle("is-revealed", reveal);
      btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", reveal ? "true" : "false");
    });
  });
}

function initPaneNavigation() {
  byId("forgotPasswordLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    openForgotPane();
  });
  byId("backToLoginFromForgot")?.addEventListener("click", (e) => {
    e.preventDefault();
    backToSignIn();
  });
  byId("backToLoginFromReset")?.addEventListener("click", (e) => {
    e.preventDefault();
    stripResetTokenFromUrl();
    backToSignIn();
  });
  byId("forgotDoneBtn")?.addEventListener("click", () => backToSignIn());
  byId("resetSuccessSignInBtn")?.addEventListener("click", () => {
    stripResetTokenFromUrl();
    backToSignIn();
  });
  byId("resetRequestNewLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    stripResetTokenFromUrl();
    openForgotPane();
  });
  byId("forgotSubmitBtn")?.addEventListener("click", () => {
    void submitForgot();
  });
  byId("resetSubmitBtn")?.addEventListener("click", () => {
    void submitReset();
  });
  // Existing sign-in/sign-up triggers must always exit the forgot/reset panes.
  document.querySelectorAll(".login-trigger, .register-trigger").forEach((el) => {
    el.addEventListener("click", () => {
      wrapper()?.classList.remove("mode-forgot", "mode-reset");
    });
  });
}

function initEnterSubmit() {
  const w = wrapper();
  if (!w) return;
  // Capture phase so the legacy login/register Enter handler (authMotion.js)
  // never fires while a forgot/reset pane is active.
  w.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter") return;
      if (!w.classList.contains("mode-forgot") && !w.classList.contains("mode-reset")) return;
      const target = e.target;
      if (!target || target.tagName !== "INPUT") return;
      e.preventDefault();
      e.stopPropagation();
      if (w.classList.contains("mode-forgot")) void submitForgot();
      else void submitReset();
    },
    true
  );
}

function bootFromUrl() {
  if (!resetToken) return;
  resetResetPane();
  setPaneMode("reset");
  const auth = byId("screenAuth");
  if (auth) auth.classList.add("active");
  const startup = byId("screenStartup");
  if (startup) startup.classList.remove("active");
}

initPasswordToggles();
initPaneNavigation();
initEnterSubmit();
bootFromUrl();
