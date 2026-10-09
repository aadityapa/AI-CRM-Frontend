import { apiFetch, assertBackendOnline, handleJson } from "./core.js";
import {
  formatHrDateTimeDisplay,
  updateHrSetupProfilePreview,
  setHrSchedulerSchedules,
} from "./hrSetupUi.js";
import { showCandidateAccessDetails } from "./hrAccessDetails.js";
import { loadHrRecords } from "./results.js";
import { loadQuestion, setInterviewRuntimeConfig, setModeTag, startInterviewTimer, setScreenNavigator } from "./candidate.js";

function toBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  return Boolean(raw);
}

export function setCandidateNavigator(showScreenFn) {
  setScreenNavigator(showScreenFn);
}

export async function loadModels() {
  const select = document.getElementById("model");
  const status = document.getElementById("hrStatus");
  try {
    // The server's model (9 Oct 2026): shown, never chosen here — the server
    // decides when the session starts (Settings ▸ AI engine).
    const data = await handleJson(await apiFetch("/models"));
    if (select && Array.isArray(data.models) && data.models.length > 0) {
      const labels = data.labels || {};
      select.innerHTML = "";
      data.models.forEach((m, idx) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = labels[m] || m;
        if (idx === 0) opt.selected = true;
        select.appendChild(opt);
      });
      if (status && !status.innerText.trim()) {
        const first = data.models[0];
        status.innerText = `AI provider: OpenAI ${labels[first] || first}.`;
      }
    }
  } catch (err) {
    status.innerText = `Model list load warning: ${err.message}`;
  }
}

export function getHrFormValues() {
  const finalSkillsRaw = document.getElementById("finalSkills").value.trim();
  const finalSkillsClean = Array.from(
    new Set(
      finalSkillsRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
  ).join(", ");
  return {
    candidateName: document.getElementById("candidateName").value.trim(),
    candidateExperience: document.getElementById("candidateExperience")?.value.trim() || "",
    candidateEmail: document.getElementById("candidateEmail").value.trim(),
    candidateRole: document.getElementById("candidateRole").value.trim(),
    jd: document.getElementById("jdText").value.trim(),
    cv: document.getElementById("cvText").value.trim(),
    jdFile: document.getElementById("jdFile").files[0],
    cvFile: document.getElementById("cvFile").files[0],
    difficulty: document.getElementById("difficulty").value,
    num_q: document.getElementById("numQ").value,
    model: document.getElementById("model").value,
    customModel: document.getElementById("customModel").value.trim(),
    safeMode: document.getElementById("safeMode").value,
    interviewMode: document.getElementById("interviewMode")?.value || "technical",
    timingMode: document.getElementById("timingMode")?.value || "count",
    timeLimitMin: document.getElementById("timeLimitMin")?.value || "0",
    micAlwaysOn: document.getElementById("micAlwaysOn")?.value || "false",
    showSpokenText: document.getElementById("showSpokenText")?.value ?? "false",
    finalSkills: finalSkillsClean,
  };
}

export function buildSetupFormData(payload) {
  const formData = new FormData();
  formData.append("jd", payload.jd);
  formData.append("cv", payload.cv);
  formData.append("difficulty", payload.difficulty);
  formData.append("num_q", payload.num_q);
  formData.append("model", payload.model);
  formData.append("custom_model", payload.customModel);
  formData.append("safe_mode", payload.safeMode);
  formData.append("interview_mode", payload.interviewMode);
  formData.append("timing_mode", String(payload.timingMode || "count"));
  formData.append("time_limit_sec", String(Math.max(0, Math.round(Number(payload.timeLimitMin || 0) * 60))));
  formData.append("mic_always_on", String(payload.micAlwaysOn || "false"));
  formData.append("show_spoken_text", String(payload.showSpokenText ?? "false"));
  formData.append("enable_transcript_input", String(payload.showSpokenText ?? "false"));
  formData.append("final_skills", payload.finalSkills);
  formData.append("candidate_name", payload.candidateName);
  formData.append("candidate_experience", payload.candidateExperience);
  formData.append("candidate_email", payload.candidateEmail);
  formData.append("candidate_role", payload.candidateRole);
  if (payload.jdFile) formData.append("jd_file", payload.jdFile);
  if (payload.cvFile) formData.append("cv_file", payload.cvFile);
  try {
    const jobId = (typeof window !== "undefined" && window.localStorage?.getItem("atsJobId")) || "";
    if (jobId) formData.append("jobId", String(jobId).trim());
  } catch (_) {
    /* ignore */
  }
  return formData;
}

function mergeSkillArrays(...arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    const list = Array.isArray(arr) ? arr : [];
    for (const raw of list) {
      const t = String(raw).trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function isPlaceholderFinalSkills(text) {
  const t = (text || "").trim().toLowerCase();
  return !t || t.startsWith("e.g.");
}

export function applyFinalSkillsFromServer(data, currentBox) {
  const box = document.getElementById("finalSkills");
  if (!box) return;
  const suggested = Array.isArray(data.suggested_final_skills) && data.suggested_final_skills.length
    ? data.suggested_final_skills
    : mergeSkillArrays(data.jd_skills_detected, data.cv_skills_detected, data.inferred_skills);
  if (!suggested.length) return;
  const cur = (currentBox !== undefined ? currentBox : box.value).trim();
  if (!cur || isPlaceholderFinalSkills(cur)) box.value = suggested.join(", ");
  else box.value = mergeSkillArrays(cur.split(",").map((s) => s.trim()).filter(Boolean), suggested).join(", ");
  document.dispatchEvent(new CustomEvent("kx-hr-setup-skills-updated"));
}

export function updateCandidateCard(profile) {
  const metaEl = document.getElementById("candidateMeta");
  if (!metaEl || !profile) return;
  const name = profile.name || "Candidate";
  const role = profile.role_hint || "Candidate";
  const exp = profile.experience || "Not specified";
  const email = profile.email || "Not available";
  metaEl.innerText = `Name: ${name} | Role: ${role} | Experience: ${exp} | Email: ${email}`;
}

function readAtsWeightsFromUi() {
  return {
    keywordMatch: Number(document.getElementById("atsWKeyword")?.value || 40),
    skillRelevance: Number(document.getElementById("atsWRelevance")?.value || 25),
    experienceMatch: Number(document.getElementById("atsWExperience")?.value || 20),
    educationMatch: Number(document.getElementById("atsWEducation")?.value || 10),
    behaviorScore: Number(document.getElementById("atsWBehavior")?.value || 5),
  };
}

function readJobConfigFromUi() {
  return {
    jobTitle: document.getElementById("atsJobTitle")?.value?.trim() || "",
    domain: document.getElementById("atsDomain")?.value?.trim() || "",
    requiredSkills: document.getElementById("atsRequiredSkills")?.value?.trim() || "",
    optionalSkills: document.getElementById("atsOptionalSkills")?.value?.trim() || "",
    expMin: Number(document.getElementById("atsExpMin")?.value || 0),
    expMax: Number(document.getElementById("atsExpMax")?.value || 0),
    jdText: document.getElementById("atsJdText")?.value?.trim() || "",
    weights: readAtsWeightsFromUi(),
  };
}

export async function saveJobConfig() {
  const status = document.getElementById("atsStatus");
  try {
    const job = readJobConfigFromUi();
    if (!job.jobTitle) throw new Error("Job Title is required for job config.");
    if (!job.requiredSkills) throw new Error("Required Skills are required.");
    const fd = new FormData();
    fd.append("jobTitle", job.jobTitle);
    fd.append("domain", job.domain);
    fd.append("requiredSkills", job.requiredSkills);
    fd.append("optionalSkills", job.optionalSkills);
    fd.append("expMin", String(job.expMin || 0));
    fd.append("expMax", String(job.expMax || 0));
    fd.append("jdText", job.jdText);
    fd.append("weights", JSON.stringify(job.weights));
    const res = await handleJson(await apiFetch("/job/config", { method: "POST", body: fd }));
    if (status) status.innerText = `Job config saved. jobId=${res.job?.jobId || "-"}`;
    window.localStorage.setItem("atsJobId", String(res.job?.jobId || ""));
    return res.job;
  } catch (err) {
    if (status) status.innerText = `Job config error: ${err.message}`;
    return null;
  }
}

export async function computeAtsPreview() {
  const status = document.getElementById("atsStatus");
  try {
    const job = readJobConfigFromUi();
    const resumeText = document.getElementById("atsResumeText")?.value?.trim() || "";
    if (!job.jobTitle || !job.requiredSkills) throw new Error("Fill Job Title + Required Skills first.");
    if (!resumeText) throw new Error("Paste resume text for preview.");
    const fd = new FormData();
    const jobId = window.localStorage.getItem("atsJobId") || "";
    if (jobId) fd.append("jobId", jobId);
    fd.append("jobTitle", job.jobTitle);
    fd.append("domain", job.domain);
    fd.append("requiredSkills", job.requiredSkills);
    fd.append("optionalSkills", job.optionalSkills);
    fd.append("expMin", String(job.expMin || 0));
    fd.append("expMax", String(job.expMax || 0));
    fd.append("jdText", job.jdText);
    fd.append("resumeText", resumeText);
    fd.append("interviewAnswers", "[]");
    fd.append("weights", JSON.stringify(job.weights));
    if (status) status.innerText = "Computing ATS score (deterministic + explainable)...";
    const data = await handleJson(await apiFetch("/ats/score", { method: "POST", body: fd }));
    document.getElementById("atsScoreBig").innerText = String(data.atsScore ?? "--");
    document.getElementById("atsGrade").innerText = String(data.grade ?? "--");
    document.getElementById("atsHireProb").innerText = String(data.hireProbability ?? "--");
    document.getElementById("atsStrongSkills").value = (data.strongSkills || []).join(", ");
    document.getElementById("atsMissingSkills").value = (data.missingSkills || []).join(", ");
    if (status) status.innerText = data.recommendation || "ATS computed.";
  } catch (err) {
    if (status) status.innerText = `ATS preview error: ${err.message}`;
  }
}

let _jobConfigsCache = [];

function _setAtsStatus(text) {
  const status = document.getElementById("atsStatus");
  if (status) status.innerText = text || "";
}

let _candidateAutocompleteReady = false;

function setInputExpanded(input, open) {
  if (input) input.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeSuggestionBox(input, box) {
  if (box) {
    box.classList.remove("is-open");
    box.innerHTML = "";
  }
  setInputExpanded(input, false);
}

function renderCandidateSuggestions({ input, box, rows, activeIndex, query, onPick }) {
  if (!box) return;
  box.innerHTML = "";
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "kx-suggestion-empty";
    empty.textContent = query.trim().length >= 2 ? "No saved candidate found. Continue with manual entry." : "Type at least 2 characters to search.";
    box.appendChild(empty);
    box.classList.add("is-open");
    setInputExpanded(input, true);
    return;
  }
  list.forEach((candidate, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `kx-suggestion-item${idx === activeIndex ? " is-active" : ""}`;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", idx === activeIndex ? "true" : "false");
    const name = document.createElement("span");
    name.className = "kx-suggestion-name";
    name.textContent = candidate.name || candidate.email || "Candidate";
    const email = document.createElement("span");
    email.className = "kx-suggestion-email";
    email.textContent = candidate.email || "No email saved";
    btn.appendChild(name);
    btn.appendChild(email);
    btn.addEventListener("mousedown", (event) => event.preventDefault());
    btn.addEventListener("click", () => onPick(candidate));
    box.appendChild(btn);
  });
  box.classList.add("is-open");
  setInputExpanded(input, true);
}

export function initCandidateAutocomplete() {
  if (_candidateAutocompleteReady) return;
  const nameInput = document.getElementById("candidateName");
  const emailInput = document.getElementById("candidateEmail");
  const nameBox = document.getElementById("candidateNameSuggestions");
  const emailBox = document.getElementById("candidateEmailSuggestions");
  if (!nameInput || !emailInput || !nameBox || !emailBox) return;
  _candidateAutocompleteReady = true;

  const state = {
    rows: [],
    activeIndex: 0,
    source: "name",
    timer: 0,
    controller: null,
  };

  const pick = (candidate) => {
    if (!candidate) return;
    if (candidate.name) nameInput.value = candidate.name;
    if (candidate.email) emailInput.value = candidate.email;
    closeSuggestionBox(nameInput, nameBox);
    closeSuggestionBox(emailInput, emailBox);
  };

  const activeInput = () => (state.source === "email" ? emailInput : nameInput);
  const activeBox = () => (state.source === "email" ? emailBox : nameBox);

  const search = (source) => {
    state.source = source;
    const input = activeInput();
    const box = activeBox();
    const query = String(input.value || "").trim();
    window.clearTimeout(state.timer);
    closeSuggestionBox(source === "email" ? nameInput : emailInput, source === "email" ? nameBox : emailBox);
    if (query.length < 2) {
      state.rows = [];
      state.activeIndex = 0;
      renderCandidateSuggestions({ input, box, rows: [], activeIndex: 0, query, onPick: pick });
      return;
    }
    state.timer = window.setTimeout(async () => {
      try {
        if (state.controller) state.controller.abort();
        state.controller = new AbortController();
        const data = await handleJson(
          await apiFetch(`/hr/candidates/suggest?q=${encodeURIComponent(query)}&limit=8`, {
            method: "GET",
            signal: state.controller.signal,
          })
        );
        state.rows = Array.isArray(data.candidates) ? data.candidates : [];
      } catch (err) {
        if (err?.name === "AbortError") return;
        state.rows = [];
      } finally {
        state.activeIndex = 0;
        renderCandidateSuggestions({ input, box, rows: state.rows, activeIndex: state.activeIndex, query, onPick: pick });
      }
    }, 220);
  };

  const handleKeys = (event, source) => {
    const box = source === "email" ? emailBox : nameBox;
    const input = source === "email" ? emailInput : nameInput;
    const open = box.classList.contains("is-open");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) search(source);
      state.activeIndex = state.rows.length ? (state.activeIndex + 1) % state.rows.length : 0;
      renderCandidateSuggestions({ input, box, rows: state.rows, activeIndex: state.activeIndex, query: input.value || "", onPick: pick });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeIndex = state.rows.length ? (state.activeIndex - 1 + state.rows.length) % state.rows.length : 0;
      renderCandidateSuggestions({ input, box, rows: state.rows, activeIndex: state.activeIndex, query: input.value || "", onPick: pick });
    } else if (event.key === "Enter" && open && state.rows.length) {
      event.preventDefault();
      pick(state.rows[state.activeIndex]);
    } else if (event.key === "Escape") {
      closeSuggestionBox(input, box);
    }
  };

  nameInput.addEventListener("input", () => search("name"));
  emailInput.addEventListener("input", () => search("email"));
  nameInput.addEventListener("focus", () => search("name"));
  emailInput.addEventListener("focus", () => search("email"));
  nameInput.addEventListener("keydown", (event) => handleKeys(event, "name"));
  emailInput.addEventListener("keydown", (event) => handleKeys(event, "email"));
  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (target instanceof Node && (nameBox.contains(target) || emailBox.contains(target) || nameInput.contains(target) || emailInput.contains(target))) {
      return;
    }
    closeSuggestionBox(nameInput, nameBox);
    closeSuggestionBox(emailInput, emailBox);
  });
}

function _normalizeWeight(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function _applyJobConfigToUi(job) {
  if (!job) return;
  // Apply template to HR setup inputs (no ATS UI on this page anymore).
  const roleBox = document.getElementById("candidateRole");
  if (roleBox) roleBox.value = job.jobTitle || roleBox.value;
  const finalSkills = document.getElementById("finalSkills");
  if (finalSkills) {
    const req = Array.isArray(job.requiredSkills) ? job.requiredSkills : String(job.requiredSkills || "").split(",");
    const opt = Array.isArray(job.optionalSkills) ? job.optionalSkills : String(job.optionalSkills || "").split(",");
    const merged = [...req, ...opt].map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    finalSkills.value = Array.from(new Set(merged)).join(", ");
  }
  const jdBox = document.getElementById("jdText");
  if (jdBox && !jdBox.value.trim()) {
    jdBox.value = job.jdText || jdBox.value;
  }

  // Also apply interview configuration (stored inside template)
  const diff = String(job.difficulty || "medium").trim().toLowerCase();
  const numQ = Number(job.numQ || job.num_q || 5);
  const mode = String(job.interviewMode || job.interview_mode || "technical").trim().toLowerCase();
  const timingMode = String(job.timingMode || job.timing_mode || "count").trim().toLowerCase();
  const timeLimitSec = Number(job.timeLimitSec || job.time_limit_sec || 0);
  const micAlwaysOn = job.micAlwaysOn !== undefined ? Boolean(job.micAlwaysOn) : Boolean(job.mic_always_on ?? false);

  const difficultyEl = document.getElementById("difficulty");
  if (difficultyEl) {
    const v = diff === "easy" || diff === "hard" ? diff : "medium";
    difficultyEl.value = v.charAt(0).toUpperCase() + v.slice(1);
  }
  const numEl = document.getElementById("numQ");
  if (numEl) numEl.value = String(Math.max(1, Math.min(100, Number.isFinite(numQ) ? Math.round(numQ) : 5)));
  const interviewEl = document.getElementById("interviewMode");
  if (interviewEl) {
    const hrModes = new Set(["hr", "standard", "false"]);
    interviewEl.value = hrModes.has(mode) ? "hr" : "technical";
  }
  const timingEl = document.getElementById("timingMode");
  if (timingEl) timingEl.value = timingMode === "time" ? "time" : "count";
  const timeEl = document.getElementById("timeLimitMin");
  if (timeEl) timeEl.value = String(Math.max(0, Math.round((Number.isFinite(timeLimitSec) ? timeLimitSec : 0) / 60)));
  const micEl = document.getElementById("micAlwaysOn");
  if (micEl) micEl.value = micAlwaysOn ? "true" : "false";
  const showSpoken = toBoolean(job.enableTranscriptInput ?? job.enable_transcript_input ?? job.showSpokenText ?? job.show_spoken_text, false);
  const spokenEl = document.getElementById("showSpokenText");
  if (spokenEl) spokenEl.value = showSpoken ? "true" : "false";
  updateHrSetupProfilePreview(job);
  document.dispatchEvent(new CustomEvent("kx-hr-setup-skills-updated", { detail: { job } }));
}

export async function loadJobConfigs() {
  const select = document.getElementById("jobConfigSelect");
  try {
    if (select) {
      select.classList.add("is-loading");
      select.innerHTML = `<option value="">Loading templates...</option>`;
    }
    const data = await handleJson(await apiFetch("/job/configs", { method: "GET" }));
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    _jobConfigsCache = jobs;
    if (!select) return jobs;
    select.classList.remove("is-loading");
    if (!jobs.length) {
      select.innerHTML = `<option value="">No templates yet — save a Job Config below</option>`;
      return jobs;
    }
    select.innerHTML = `<option value="">Select a template...</option>` + jobs
      .map((j) => {
        const id = String(j.jobId || "").trim();
        const title = String(j.jobTitle || "Job").trim();
        const label = id ? `${title} (${id})` : title;
        return `<option value="${id}">${label}</option>`;
      })
      .join("");

    const saved = window.localStorage.getItem("atsJobId") || "";
    if (saved && jobs.some((j) => String(j.jobId || "") === saved)) {
      select.value = saved;
      _applyJobConfigToUi(jobs.find((j) => String(j.jobId || "") === saved) || null);
    }
    return jobs;
  } catch (err) {
    if (select) {
      select.classList.remove("is-loading");
      select.innerHTML = `<option value="">Unable to load templates</option>`;
    }
    _setAtsStatus(`Template load error: ${err.message}`);
    return [];
  }
}

export function applySelectedJobConfig() {
  const select = document.getElementById("jobConfigSelect");
  const id = String(select?.value || "").trim();
  if (!id) {
    _setAtsStatus("Select a template first.");
    return;
  }
  const job = _jobConfigsCache.find((j) => String(j.jobId || "") === id) || null;
  if (!job) {
    _setAtsStatus("Selected template was not found. Refresh templates.");
    return;
  }
  window.localStorage.setItem("atsJobId", id);
  _applyJobConfigToUi(job);
  _setAtsStatus(`Template applied: ${job.jobTitle || id}`);
}

function renderRankTable(rows) {
  const el = document.getElementById("atsRankTable");
  if (!el) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    el.innerHTML = `<div class="status">No candidates found to rank yet. Complete at least one interview to generate records.</div>`;
    return;
  }
  const html = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Email</th>
            <th style="text-align:center;">ATS</th>
            <th>Grade</th>
            <th>Hire</th>
            <th>Strong</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (r) => `
              <tr>
                <td style="font-weight:800;">${r.candidate_name || "Candidate"}</td>
                <td>${r.candidate_email || "-"}</td>
                <td style="text-align:center; font-weight:900;">${r.atsScore ?? 0}</td>
                <td>${r.grade || ""}</td>
                <td>${r.hireProbability || ""}</td>
                <td>${(r.strongSkills || []).slice(0, 6).join(", ")}</td>
                <td>${(r.missingSkills || []).slice(0, 6).join(", ")}</td>
              </tr>
            `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  el.innerHTML = html;
}

export async function loadRankedCandidates() {
  const status = document.getElementById("atsStatus");
  try {
    const jobId = window.localStorage.getItem("atsJobId") || "";
    if (!jobId) throw new Error("Save Job Config first (creates jobId).");
    if (status) status.innerText = "Ranking candidates by ATS score...";
    const data = await handleJson(await apiFetch(`/candidates/ranked?jobId=${encodeURIComponent(jobId)}`, { method: "GET" }));
    renderRankTable(data.ranked || []);
    if (status) status.innerText = `Ranked ${Array.isArray(data.ranked) ? data.ranked.length : 0} candidates.`;
  } catch (err) {
    if (status) status.innerText = `Ranking error: ${err.message}`;
  }
}

export function showDetectedSkills(jdSkills, cvSkills) {
  const status = document.getElementById("hrStatus");
  const jdArea = document.getElementById("jdSkillsDetected");
  const cvArea = document.getElementById("cvSkillsDetected");
  const jdList = Array.isArray(jdSkills) ? jdSkills : [];
  const cvList = Array.isArray(cvSkills) ? cvSkills : [];
  if (jdArea) jdArea.value = jdList.join(", ");
  if (cvArea) cvArea.value = cvList.join(", ");
  if (status) {
    status.innerText = `JD Skills: ${jdList.length} detected | CV Skills: ${cvList.length} detected. Key Evaluation Skills are populated from the selected template or extraction.`;
  }
}

export function createShowScreen() {
  return function showScreen(screen) {
    const screens = {
      hr: "screenHr",
      candidate: "screenCandidate",
    };
    const tabs = { hr: "tabHr", candidate: "tabCandidate" };
    Object.values(screens).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("active");
      el.classList.remove("anim-in");
    });
    Object.values(tabs).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });
    const target = document.getElementById(screens[screen]);
    if (target) {
      target.classList.add("active");
      // Force reflow so repeated tab switches always replay the transition.
      void target.offsetWidth;
      target.classList.add("anim-in");
    }
    const tab = document.getElementById(tabs[screen]);
    if (tab) tab.classList.add("active");
    if (screen !== "candidate") document.body.classList.remove("interview-mode");
    if (screen === "hr") loadHrRecords();
  };
}

export function createSetupInterview(showScreen) {
  return async function setupInterview() {
    const payload = getHrFormValues();
    const { jd, cv, jdFile, cvFile, finalSkills, candidateName, candidateEmail } = payload;
    const status = document.getElementById("hrStatus");
    if (!candidateName) {
      status.innerText = "Candidate name is required.";
      return;
    }
    if (!candidateEmail) {
      status.innerText = "Candidate email is required.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
      status.innerText = "Enter a valid candidate email address.";
      return;
    }
    if (!finalSkills) {
      status.innerText = "Key Evaluation Skills are required. Select a template or extract skills before starting.";
      return;
    }
    const formData = buildSetupFormData(payload);
    const loadingOverlay = document.getElementById("loadingOverlay");
    try {
      if (loadingOverlay) loadingOverlay.classList.add("active");
      await assertBackendOnline();
      status.innerText = "Processing inputs and generating ChatGPT-style interview...";
      const setupData = await handleJson(await apiFetch("/setup", { method: "POST", body: formData }));
      status.innerText = setupData.warning
        ? `Interview ready. ${setupData.warning}`
        : "Interview ready. Switching to candidate screen.";
      showDetectedSkills(setupData.jd_skills_detected || [], setupData.cv_skills_detected || []);
      applyFinalSkillsFromServer(setupData, finalSkills);
      updateCandidateCard(setupData.candidate_profile);
      const modeTag =
        String(payload.interviewMode || "technical").toLowerCase() === "hr" ? "HR Interview" : "Technical Interview";
      setModeTag(modeTag);
      setInterviewRuntimeConfig({
        timingMode: setupData.timing_mode || payload.timingMode,
        timeLimitSec: Number(setupData.time_limit_sec || 0) || Math.max(0, Math.round(Number(payload.timeLimitMin || 0) * 60)),
        micAlwaysOn: !!setupData.mic_always_on || String(payload.micAlwaysOn).toLowerCase() === "true",
        showSpokenText: setupData.enable_transcript_input === true || setupData.show_spoken_text === true,
      });
      document.body.classList.add("interview-mode");
      showScreen("candidate");
      await loadQuestion();
      startInterviewTimer();
    } catch (err) {
      status.innerText = `Setup failed: ${err.message}`;
    } finally {
      if (loadingOverlay) loadingOverlay.classList.remove("active");
    }
  };
}

export async function extractSkillsOnly() {
  const payload = getHrFormValues();
  const { jd, cv, jdFile, cvFile } = payload;
  const status = document.getElementById("hrStatus");
  if (!jd && !cv && !jdFile && !cvFile) {
    status.innerText = "Upload or paste JD/CV first.";
    return;
  }
  try {
    await assertBackendOnline();
    status.innerText = "Extracting skills from JD/CV...";
    const formData = new FormData();
    formData.append("jd", payload.jd);
    formData.append("cv", payload.cv);
    formData.append("model", payload.model);
    formData.append("custom_model", payload.customModel);
    formData.append("safe_mode", payload.safeMode);
    formData.append("candidate_name", payload.candidateName);
    formData.append("candidate_experience", payload.candidateExperience);
    formData.append("candidate_email", payload.candidateEmail);
    formData.append("candidate_role", payload.candidateRole);
    if (payload.jdFile) formData.append("jd_file", payload.jdFile);
    if (payload.cvFile) formData.append("cv_file", payload.cvFile);
    const data = await handleJson(await apiFetch("/extract-skills", { method: "POST", body: formData }));
    showDetectedSkills(data.jd_skills_detected || [], data.cv_skills_detected || []);
    applyFinalSkillsFromServer(data, document.getElementById("finalSkills").value.trim());
    updateCandidateCard(data.candidate_profile || {});
    status.innerText = "Skills extracted. Review the read-only Key Evaluation Skills, then schedule and share the invite link.";
  } catch (err) {
    status.innerText = `Skill extraction failed: ${err.message}`;
  }
}

function renderSchedulesTable(items) {
  const box = document.getElementById("scheduleTable");
  if (!box) return;
  const rows = Array.isArray(items) ? items : [];
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.invite_token || ""}|${row.candidate_email || ""}|${row.scheduled_at_local || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  box.innerHTML = "";
  const status = document.getElementById("scheduleStatus");
  if (status && unique.length !== rows.length) {
    status.innerText = `Interview scheduled successfully. Removed ${rows.length - unique.length} duplicate schedule entr${rows.length - unique.length === 1 ? "y" : "ies"} from view.`;
  }
}

export function setScheduleFilter(filter) {
  window.localStorage.setItem("scheduleFilter", String(filter || "all"));
  loadInterviewSchedules();
}

export async function loadInterviewSchedules() {
  const status = document.getElementById("scheduleStatus");
  try {
    const data = await handleJson(await apiFetch("/hr/schedules", { method: "GET" }));
    const rows = data.schedules || [];
    renderSchedulesTable(rows);
    setHrSchedulerSchedules(rows);
    document.dispatchEvent(
      new CustomEvent("kx-hr-schedules-updated", { detail: { schedules: rows } })
    );
    if (status) status.innerText = "";
  } catch (err) {
    if (status) status.innerText = `Unable to load schedules: ${err.message}`;
  }
}

export async function scheduleInterview() {
  const status = document.getElementById("scheduleStatus");
  const inviteEl = document.getElementById("generatedInviteLink");
  const candidateName = (document.getElementById("candidateName")?.value || "").trim();
  const candidateEmail = (document.getElementById("candidateEmail")?.value || "").trim();
  const scheduledAt = (document.getElementById("scheduleDateTime")?.value || "").trim();
  const notes = (document.getElementById("scheduleNotes")?.value || "").trim();
  const finalSkills = (document.getElementById("finalSkills")?.value || "").trim();
  const numQ = (document.getElementById("numQ")?.value || "5").trim();
  const difficulty = (document.getElementById("difficulty")?.value || "medium").trim();
  const timingMode = (document.getElementById("timingMode")?.value || "count").trim();
  const timeLimitMin = (document.getElementById("timeLimitMin")?.value || "0").trim();
  const micAlwaysOn = (document.getElementById("micAlwaysOn")?.value || "false").trim();
  const showSpokenText = (document.getElementById("showSpokenText")?.value ?? "false").trim();
    // No model in the schedule: the server picks it when the interview starts.
    const model = "";
    const jobId = (() => {
      try {
        return (window.localStorage.getItem("atsJobId") || "").trim();
      } catch (_) {
        return "";
      }
    })();
    if (!candidateName || !candidateEmail || !scheduledAt) {
    if (status) status.innerText = "Candidate name, candidate email, and interview date/time are required.";
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
    if (status) status.innerText = "Enter a valid candidate email address before scheduling.";
    return;
  }
  if (!finalSkills) {
    if (status) status.innerText = "Final Skills are required before scheduling the interview.";
    return;
  }
  try {
    if (status) status.innerText = "Scheduling interview...";
    const data = await handleJson(
      await apiFetch("/hr/schedule-interview", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          candidate_name: candidateName,
          candidate_email: candidateEmail,
          scheduled_at_local: scheduledAt,
          notes,
          final_skills: finalSkills,
          num_q: numQ,
          difficulty,
          timing_mode: timingMode,
          time_limit_sec: String(Math.max(0, Math.round(Number(timeLimitMin || 0) * 60))),
          mic_always_on: micAlwaysOn,
          show_spoken_text: showSpokenText,
          enable_transcript_input: showSpokenText,
          model,
          ...(jobId ? { jobId } : {}),
        }),
      })
    );
    const invite = data.invite_url || "";
    if (inviteEl) inviteEl.value = invite;
    const accessKey = data.access_key || "";
    showCandidateAccessDetails({
      inviteUrl: invite,
      accessKey,
      scheduledAt,
      status: "Interview Scheduled",
      candidateEmail,
    });
    if (status) {
      const whenLabel = formatHrDateTimeDisplay(scheduledAt);
      let msg = "Interview scheduled successfully.";
      if (whenLabel && whenLabel !== "—") {
        msg += ` Slot: ${whenLabel}.`;
      }
      if (data.email_sent) {
        msg += " Invite link and access key were sent to the candidate email.";
      } else if (data.email_error) {
        msg += ` Email: ${data.email_error}`;
      } else if (!data.smtp_configured) {
        msg += " Copy the invite link and access key below to share with the candidate.";
      }
      if (accessKey && !data.email_sent) {
        msg += ` Access Key: ${accessKey}`;
      }
      status.innerText = msg;
    }
    await loadInterviewSchedules();
  } catch (err) {
    if (status) status.innerText = `Scheduling failed: ${err.message}`;
  }
}
