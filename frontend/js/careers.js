// Karnex Careers — the public page (3 Nov 2026). ONE link for every open position.
// Data: GET /api/public/careers (live from Orbit), one position with its RMG JD from
// GET /api/public/careers/positions/{id}; apply → POST …/{id}/apply (multipart).
// Everything is built with textContent — no server text is ever put into innerHTML.
import {
  applyProblems, cleanSource, isServingNotice, filterPositions, inLocation, jdBlocks, openingsText,
  popularSkills, positionLink, postedText,
} from "./careers_logic.js?v=3";

const API = "/api/public/careers";
const REFRESH_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

const state = {
  positions: [], locations: [], totalPositions: 0, totalOpenings: 0, loaded: false,
  city: "", q: "", src: "", view: "list", job: null, general: false,
};

// ------------------------------------------------------------------- helpers
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  // `cond && el(...)` children: skip the falsy results (false, "", 0, null).
  for (const c of kids.flat()) {
    if (c == null || c === false || c === "" || c === 0) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

function svgIcon(path) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("aria-hidden", "true"); s.setAttribute("width", "16"); s.setAttribute("height", "16");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "#475569");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", path); s.append(p);
  return s;
}
const ICON_PIN = "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z";
const ICON_BAG = "M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2";
const ICON_HOME = "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6";

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || (body && body.success === false)) {
    const err = new Error((body && (body.detail || body.message)) || `Request failed (${res.status})`);
    err.status = res.status; throw err;
  }
  return body && "data" in body ? body.data : body;
}

// ---------------------------------------------------------------------- URL
function readUrl() {
  const p = new URLSearchParams(location.search);
  state.src = cleanSource(p.get("src")) || state.src;
  state.city = p.get("loc") || "";
  state.q = p.get("q") || "";
  const job = p.get("job");
  state.general = p.get("apply") === "general";
  state.view = job ? "detail" : state.general ? "detail" : "list";
  state.jobId = job ? Number(job) : null;
}

function writeUrl(push) {
  const p = new URLSearchParams();
  if (state.view === "detail" && state.jobId) p.set("job", String(state.jobId));
  else if (state.view === "detail" && state.general) p.set("apply", "general");
  else {
    if (state.city) p.set("loc", state.city);
    if (state.q) p.set("q", state.q);
  }
  if (state.src) p.set("src", state.src);
  const url = `/careers${p.toString() ? `?${p}` : ""}`;
  if (url === location.pathname + location.search) return;
  (push ? history.pushState : history.replaceState).call(history, { careers: true }, "", url);
}

// --------------------------------------------------------------------- list
async function loadList({ quiet = false } = {}) {
  if (!quiet && !state.loaded) drawSkeleton();
  try {
    const data = await getJson(API);
    state.positions = data.positions || [];
    state.locations = data.locations || [];
    state.totalPositions = data.total_positions || 0;
    state.totalOpenings = data.total_openings || 0;
    state.loaded = true;
    $("listError").hidden = true;
    if (state.city && !state.locations.some((l) => l.city === state.city)) state.city = "";
    drawList();
  } catch (e) {
    if (quiet && state.loaded) return;
    $("grid").replaceChildren();
    $("listErrorText").textContent = e.message || "Please check your connection and try again.";
    $("listError").hidden = false;
  }
}

function drawSkeleton() {
  $("grid").replaceChildren(...Array.from({ length: 6 }, () => el("div", { class: "skel", "aria-hidden": "true" })));
}

function drawHeader() {
  $("allBtn").textContent = state.loaded ? `View all openings (${state.totalPositions})` : "View all openings";
  $("heroCount").textContent = state.loaded
    ? `We're hiring · ${state.totalPositions} open position${state.totalPositions === 1 ? "" : "s"} · ${openingsText(state.totalOpenings)}`
    : "We're hiring";
}

function drawDropdowns() {
  const inLoc = inLocation(state.positions, state.city);
  $("roleBtnText").textContent = `All positions (${inLoc.length})`;
  const roleList = $("roleList");
  roleList.replaceChildren(
    el("div", { class: "dd-title", text: state.city ? `Open positions in ${state.city}` : "All open positions" }),
    ...(inLoc.length ? inLoc.map((p) => el("button", {
      type: "button", class: "opt", role: "option", "aria-selected": "false",
      onclick: () => { closeDropdowns(); openPosition(p.id); },
    },
    el("span", { class: "t" }, el("b", { text: p.title }),
      el("small", { text: [p.location || p.city, p.experience, p.work_mode].filter(Boolean).join(" · ") })),
    el("span", { class: "count", text: openingsText(p.openings) }))) : [el("div", { class: "dd-title", text: "No open positions here right now" })]),
  );

  $("locBtnText").textContent = state.city || "All locations";
  $("ddLoc").querySelector(".dd-btn").classList.toggle("on", !!state.city);
  const locs = [{ city: "", positions: state.totalPositions }, ...state.locations];
  $("locList").replaceChildren(...locs.map((l) => el("button", {
    type: "button", class: `opt${l.city === state.city ? " sel" : ""}`, role: "option",
    "aria-selected": l.city === state.city ? "true" : "false",
    onclick: () => { state.city = l.city; closeDropdowns(); writeUrl(false); drawList(); },
  },
  el("span", { class: "loc-name" }, svgIcon(ICON_PIN), l.city || "All locations"),
  el("span", { class: "n", text: `${l.positions} position${l.positions === 1 ? "" : "s"}` }))));
}

function drawPopular() {
  const names = popularSkills(state.positions, 5);
  const box = $("popular");
  box.hidden = names.length === 0;
  box.replaceChildren(el("span", { text: "Popular:" }), ...names.map((n) => el("button", {
    type: "button", class: "chip", text: n,
    onclick: () => { state.q = n; $("q").value = n; writeUrl(false); drawList(); },
  })));
}

function card(p) {
  const open = () => openPosition(p.id);
  const skills = (p.skills || []).map((s) => el("span", { class: "sk", text: s.name }));
  if (p.skills_more) skills.push(el("span", { class: "sk more", text: `+${p.skills_more} more` }));
  return el("article", { class: "card" },
    el("div", { class: "card-top" },
      el("span", { class: "code", text: p.code }), el("span", { class: "posted", text: postedText(p.posted) })),
    el("h3", {}, el("button", { type: "button", onclick: open, text: p.title })),
    el("div", { class: "facts" },
      (p.location || p.city) && el("span", {}, svgIcon(ICON_PIN), p.location || p.city),
      p.experience && el("span", {}, svgIcon(ICON_BAG), p.experience),
      p.work_mode && el("span", {}, svgIcon(ICON_HOME), p.work_mode)),
    skills.length && el("div", { class: "skills" }, skills),
    el("div", { class: "card-foot" },
      el("span", { class: "openings", text: openingsText(p.openings) }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn btn-ghost", onclick: open, text: "Details" }),
        el("button", { type: "button", class: "btn btn-pri", onclick: () => openPosition(p.id, true), text: "Apply" }))));
}

function drawList() {
  drawHeader();
  if (!state.loaded) return;
  drawDropdowns();
  drawPopular();
  const shown = filterPositions(state.positions, { city: state.city, q: state.q });
  $("resultsTitle").textContent =
    `${shown.length} open position${shown.length === 1 ? "" : "s"}${state.city ? ` in ${state.city}` : ""}`;
  const f = $("filters");
  f.replaceChildren(
    state.city && el("button", { type: "button", class: "fchip", "aria-label": "Remove location filter",
      onclick: () => { state.city = ""; writeUrl(false); drawList(); } }, `Location: ${state.city}`, el("span", { "aria-hidden": "true", text: " ×" })),
    state.q && el("button", { type: "button", class: "fchip", "aria-label": "Remove keyword filter",
      onclick: () => { state.q = ""; $("q").value = ""; writeUrl(false); drawList(); } }, `Keyword: ${state.q}`, el("span", { "aria-hidden": "true", text: " ×" })),
    (state.city || state.q) && el("button", { type: "button", class: "linkbtn", onclick: clearAll, text: "Clear all" }),
  );
  $("noResults").hidden = shown.length > 0 || state.positions.length === 0;
  if (!state.positions.length) {
    $("grid").replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" },
      el("h3", { text: "No positions are open right now" }),
      el("p", { text: "New positions open often — send us your resume and a recruiter will contact you when one fits." })));
    return;
  }
  $("grid").replaceChildren(...shown.map(card));
}

function clearAll() {
  state.city = ""; state.q = ""; $("q").value = ""; writeUrl(false); drawList();
}

// ---------------------------------------------------------------- dropdowns
function closeDropdowns() {
  for (const id of ["ddRole", "ddLoc"]) {
    const dd = $(id);
    dd.querySelector(".dd-btn").setAttribute("aria-expanded", "false");
    dd.querySelector(".dd-list").hidden = true;
  }
}
function toggleDropdown(id) {
  const dd = $(id);
  const btn = dd.querySelector(".dd-btn");
  const willOpen = btn.getAttribute("aria-expanded") !== "true";
  closeDropdowns();
  if (willOpen) {
    btn.setAttribute("aria-expanded", "true");
    const list = dd.querySelector(".dd-list");
    list.hidden = false;
    list.querySelector(".opt")?.focus();
  }
}

// ------------------------------------------------------------------- detail
function show(view) {
  state.view = view;
  $("viewList").hidden = view !== "list";
  $("viewDetail").hidden = view !== "detail";
  $("viewDone").hidden = view !== "done";
  window.scrollTo({ top: 0 });
}

function goHome(push = true) {
  state.jobId = null; state.job = null; state.general = false;
  show("list"); writeUrl(push); setJsonLd(null);
  document.title = "Careers at Karnex — open positions";
  drawList();
}

async function openPosition(id, focusApply = false) {
  state.jobId = id; state.general = false;
  show("detail"); writeUrl(true);
  $("detailError").hidden = true; $("detailBody").hidden = true;
  try {
    const p = await getJson(`${API}/positions/${encodeURIComponent(id)}`);
    state.job = p;
    drawDetail(p);
    if (focusApply) $("applyForm").querySelector("input[name=candidate_name]").focus({ preventScroll: false });
  } catch (e) {
    $("detailErrorText").textContent = e.status === 404 ? e.message
      : "We could not load this position. Please try again.";
    $("detailError").hidden = false;
  }
}

function drawDetail(p) {
  document.title = `${p.title} — Careers at Karnex`;
  $("dCode").textContent = p.code;
  $("dPosted").textContent = postedText(p.posted);
  $("dTitle").textContent = p.title;
  $("dTags").replaceChildren(
    ...[p.location || p.city, p.experience && `${p.experience} experience`, p.work_mode]
      .filter(Boolean).map((t) => el("span", { class: "tag", text: t })),
    el("span", { class: "tag hot", text: openingsText(p.openings) }));
  $("dAboutH").textContent = "About the role";
  const blocks = jdBlocks(p.jd);
  $("dJd").replaceChildren(...(blocks.length ? blocks.map((b) => b.type === "ul"
    ? el("ul", {}, b.items.map((t) => el("li", { text: t })))
    : el(b.type === "h" ? "h3" : "p", { text: b.text }))
    : [el("p", { text: "The recruiter will share the full job description with you." })]));
  const sk = p.skills || [];
  $("dSkillsPanel").hidden = sk.length === 0;
  $("dSkills").replaceChildren(...sk.map((s) => el("span", { class: `skc${s.must ? " must" : ""}`, text: `${s.must ? "★ " : ""}${s.name}` })));
  $("dShare").hidden = false;
  const link = positionLink(location.origin, p.id, state.src);
  $("liBtn").href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
  $("waBtn").href = `https://wa.me/?text=${encodeURIComponent(`${p.title} — open position at Karnex: ${link}`)}`;
  $("copyBtn").textContent = "Copy link";
  $("copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(link); $("copyBtn").textContent = "Link copied"; }
    catch { toast(link); }
  };
  setApplyMode(false);
  $("detailBody").hidden = false;
  setJsonLd(p);
}

function openGeneral() {
  state.jobId = null; state.job = null; state.general = true;
  show("detail"); writeUrl(true);
  document.title = "Send your resume — Careers at Karnex";
  $("detailError").hidden = true;
  $("dCode").textContent = "OPEN";
  $("dPosted").textContent = "Always open";
  $("dTitle").textContent = "General application";
  $("dTags").replaceChildren(...["Any location", "Any experience"].map((t) => el("span", { class: "tag", text: t })),
    el("span", { class: "tag hot", text: "Talent pool" }));
  $("dAboutH").textContent = "How it works";
  $("dJd").replaceChildren(el("p", { text: "Share your resume with Karnex. When a position that matches your skills and location opens, a recruiter will contact you." }));
  $("dSkillsPanel").hidden = true;
  $("dShare").hidden = true;
  setApplyMode(true);
  $("detailBody").hidden = false;
  setJsonLd(null);
}

function setApplyMode(general) {
  const form = $("applyForm");
  form.reset();
  form.dataset.general = general ? "1" : "";
  $("applyTitle").textContent = general ? "Send your resume" : "Apply for this position";
  $("submitBtn").textContent = general ? "Send resume" : "Submit application";
  form.querySelectorAll("[data-pos-only]").forEach((n) => { n.hidden = general; });
  form.querySelectorAll("[data-general-only]").forEach((n) => { n.hidden = !general; });
  $("applyErr").hidden = true;
  syncLwd();
  drawFile(null);
}

// "Serving notice" → ask for the last working day (the date picker's own range
// matches the server's: at most 30 days ago, at most 6 months ahead).
function syncLwd() {
  const form = $("applyForm");
  const serving = form.dataset.general !== "1" && isServingNotice($("noticeSel").value);
  const field = $("lwdField");
  const input = $("lwdInput");
  field.hidden = !serving;
  input.required = serving;
  if (!serving) input.value = "";
  const iso = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  input.min = iso(-30);
  input.max = iso(180);
}

function drawFile(file) {
  const drop = $("drop");
  drop.classList.toggle("has", !!file);
  $("dropTitle").textContent = file ? file.name : "Upload your resume *";
  $("dropHint").textContent = file ? `${Math.max(1, Math.round(file.size / 1024))} KB · click to change` : "PDF or Word, up to 10 MB";
}

async function submitApply(ev) {
  ev.preventDefault();
  const form = $("applyForm");
  const general = form.dataset.general === "1";
  const fd = new FormData(form);
  const file = form.querySelector("input[type=file]").files[0] || null;
  const values = Object.fromEntries(fd.entries());
  values.file = file;
  values.consent = form.querySelector("input[name=consent]").checked;
  const problems = applyProblems(values, { general });
  const err = $("applyErr");
  if (problems.length) {
    err.textContent = `Please add ${problems.join(", ")}.`;
    err.hidden = false; return;
  }
  err.hidden = true;
  if (!general && values.expected_ctc) fd.set("expected_ctc", `${values.expected_ctc} LPA`);
  if (!general && values.current_ctc) fd.set("current_ctc", `${values.current_ctc} LPA`);
  if (!isServingNotice(values.notice_period)) fd.delete("last_working_day");
  if (!general && values.experience) fd.set("experience", String(values.experience));
  fd.set("consent", "true");
  fd.set("src", state.src || "");
  if (general) { fd.delete("notice_period"); fd.delete("expected_ctc"); fd.delete("current_ctc"); fd.delete("last_working_day"); }
  const btn = $("submitBtn");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const url = general ? `${API}/general-apply` : `${API}/positions/${state.jobId}/apply`;
    const res = await fetch(url, { method: "POST", body: fd });
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    if (!res.ok) throw new Error((body && body.detail) || "We could not send your application. Please try again.");
    $("doneTitle").textContent = general ? "Resume received" : "Application received";
    $("doneText").textContent = general
      ? "Thank you. A recruiter will contact you by email or phone when a position that fits you opens."
      : `We've got your application for ${state.job?.title || "this position"}. A recruiter reads every application and will contact you by email or phone if your profile fits.`;
    show("done");
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// Google for Jobs reads a JobPosting on the position view. The customer is never
// named — the hiring organisation is Karnex.
function setJsonLd(p) {
  document.getElementById("jobLd")?.remove();
  if (!p) return;
  const data = {
    "@context": "https://schema.org", "@type": "JobPosting",
    title: p.title, description: (p.jd || p.summary || p.title).slice(0, 5000),
    datePosted: p.posted || undefined, employmentType: "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: "Karnex", sameAs: "https://karnexgroup.com" },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: p.city || p.location, addressCountry: "IN" } },
    identifier: { "@type": "PropertyValue", name: "Karnex", value: p.code },
    skills: (p.skills || []).map((s) => s.name).join(", ") || undefined,
  };
  const s = document.createElement("script");
  s.type = "application/ld+json"; s.id = "jobLd";
  s.textContent = JSON.stringify(data);
  document.head.append(s);
}

// --------------------------------------------------------------------- boot
function route() {
  readUrl();
  $("q").value = state.q;
  if (state.view === "detail" && state.jobId) openPosition(state.jobId);
  else if (state.view === "detail" && state.general) openGeneral();
  else { show("list"); drawList(); }
}

function boot() {
  document.querySelectorAll("[data-home]").forEach((a) => a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); clearAll(); goHome();
  }));
  document.querySelectorAll("[data-home-btn]").forEach((b) => b.addEventListener("click", () => goHome()));
  document.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", clearAll));
  $("ddRole").querySelector(".dd-btn").addEventListener("click", () => toggleDropdown("ddRole"));
  $("ddLoc").querySelector(".dd-btn").addEventListener("click", () => toggleDropdown("ddLoc"));
  document.addEventListener("click", (e) => { if (!e.target.closest(".dd")) closeDropdowns(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdowns();
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest?.(".dd-list")) {
      const opts = [...e.target.closest(".dd-list").querySelectorAll(".opt")];
      const i = opts.indexOf(e.target);
      const next = opts[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    }
  });
  let t;
  $("q").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = $("q").value.trim(); writeUrl(false); drawList(); }, 200);
  });
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault(); state.q = $("q").value.trim(); writeUrl(false); drawList();
    document.querySelector(".results")?.scrollIntoView({ behavior: "smooth" });
  });
  $("retryBtn").addEventListener("click", () => loadList());
  $("generalBtn").addEventListener("click", openGeneral);
  const fileIn = $("drop").querySelector("input[type=file]");
  fileIn.addEventListener("change", () => drawFile(fileIn.files[0] || null));
  for (const ev of ["dragenter", "dragover"]) $("drop").addEventListener(ev, () => $("drop").classList.add("over"));
  for (const ev of ["dragleave", "drop"]) $("drop").addEventListener(ev, () => $("drop").classList.remove("over"));
  $("applyForm").addEventListener("submit", submitApply);
  $("noticeSel").addEventListener("change", () => {
    syncLwd();
    if (!$("lwdField").hidden) $("lwdInput").focus();
  });
  window.addEventListener("popstate", route);
  // The page follows Orbit: a quiet re-read every few minutes while it is visible.
  setInterval(() => { if (document.visibilityState === "visible") loadList({ quiet: true }); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.loaded) loadList({ quiet: true });
  });
  route();
  loadList();
}

boot();
