/** Sliding login/register panel — UI only; mode sync via switchAuthMode. */
export function initAuthMotion(switchAuthModeFn) {
  const loginTriggers = document.querySelectorAll(".login-trigger");
  const registerTriggers = document.querySelectorAll(".register-trigger");

  registerTriggers.forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof switchAuthModeFn === "function") switchAuthModeFn("register");
    });
  });

  loginTriggers.forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof switchAuthModeFn === "function") switchAuthModeFn("login");
    });
  });
}

/** Press Enter in email/password (or register) fields to submit the active auth panel. */
export function initAuthEnterSubmit(loginHandler, registerHandler) {
  const wrapper = document.getElementById("authWrapper");
  if (!wrapper) return;

  wrapper.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // Forgot/Reset panes have their own Enter handling (js/auth/passwordReset.js).
    if (wrapper.classList.contains("mode-forgot") || wrapper.classList.contains("mode-reset")) return;
    const target = e.target;
    if (!target || target.tagName !== "INPUT") return;
    if (!wrapper.contains(target)) return;

    e.preventDefault();
    const isRegister = wrapper.classList.contains("toggled");
    if (isRegister) {
      if (typeof registerHandler === "function") registerHandler("hr");
    } else if (typeof loginHandler === "function") {
      loginHandler("hr");
    }
  });
}
