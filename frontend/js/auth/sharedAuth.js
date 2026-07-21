export function switchAuthPane(role) {
  const targetRole = "hr";
  const hrPane = document.getElementById("authPaneHr");
  const candidatePane = document.getElementById("authPaneCandidate");
  const hrBtn = document.getElementById("authSwitchHr");
  const candidateBtn = document.getElementById("authSwitchCandidate");
  const authShell = document.getElementById("authWrapper") || document.getElementById("authCard");
  if (hrPane) hrPane.classList.toggle("active", targetRole === "hr");
  if (candidatePane) candidatePane.classList.toggle("active", targetRole === "candidate");
  if (hrBtn) hrBtn.classList.toggle("active", targetRole === "hr");
  if (candidateBtn) candidateBtn.classList.toggle("active", targetRole === "candidate");
  if (authShell) {
    authShell.classList.toggle("role-hr", targetRole === "hr");
    authShell.classList.toggle("role-candidate", targetRole === "candidate");
  }
}

export function authFieldsByRole(role) {
  const r = role === "hr" ? "Hr" : "Candidate";
  const isRegister = document.getElementById("authWrapper")?.classList.contains("toggled");
  const emailEl = isRegister
    ? document.getElementById(`auth${r}Email`)
    : document.getElementById(`auth${r}LoginEmail`) || document.getElementById(`auth${r}Email`);
  const passwordEl = isRegister
    ? document.getElementById(`auth${r}Password`)
    : document.getElementById(`auth${r}LoginPassword`) || document.getElementById(`auth${r}Password`);
  return {
    fullName: document.getElementById(`auth${r}FullName`)?.value.trim() || "",
    email: emailEl?.value.trim() || "",
    username: document.getElementById(`auth${r}Username`)?.value.trim() || "",
    password: passwordEl?.value || "",
  };
}

export function switchAuthMode(mode, registerHandler, loginHandler) {
  const isRegister = mode === "register";
  const wrapper = document.getElementById("authWrapper");
  if (wrapper) wrapper.classList.toggle("toggled", isRegister);

  const loginBtns = document.querySelectorAll("#modeLoginBtn, .login-trigger");
  const registerBtns = document.querySelectorAll("#modeRegisterBtn, .register-trigger");
  loginBtns.forEach((btn) => btn.classList.toggle("active", !isRegister));
  registerBtns.forEach((btn) => btn.classList.toggle("active", isRegister));

  // Portal label follows the visible auth screen (Welcome back vs Create account).
  const portalPill = document.getElementById("authSwitchHr");
  if (portalPill) {
    portalPill.textContent = isRegister ? "Register portal" : "Login Portal";
  }

  const hrBtn = document.getElementById("hrActionBtn");
  if (hrBtn) {
    hrBtn.innerText = "Sign in";
    hrBtn.onclick = () => loginHandler("hr");
  }

  const regBtn = document.getElementById("hrRegisterBtn");
  if (regBtn) {
    regBtn.onclick = () => registerHandler("hr");
  }

  const status = document.getElementById("authStatus");
  if (status) status.innerText = "";
}
