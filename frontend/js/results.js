import { state } from "./state.js";
import { apiFetch, assertBackendOnline, escapeHtml, handleJson, handleJsonOrText } from "./core.js";
let reportRefreshTimer = null;

/** Shows or hides the HR Result panel progress strip (spinner + message). */
export function setReportLoader(show, title = "Generating report…", sub = "Evaluating answers and building HR-ready scores.") {
  const wrap = document.getElementById("reportLoader");
  const titleEl = document.getElementById("reportLoaderText");
  const subEl = document.getElementById("reportLoaderSub");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
  wrap.setAttribute("aria-busy", show ? "true" : "false");
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;
}

export async function loadHrRecords() {
  const select = document.getElementById("recordSelect");
  const status = document.getElementById("recordStatus");
  if (!select) return;
  try {
    const data = await handleJson(await apiFetch("/hr-records"));
    const records = Array.isArray(data.records) ? data.records : [];
    select.innerHTML = "";
    if (records.length === 0) {
      setReportLoader(false);
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No saved candidate records yet";
      select.appendChild(opt);
      if (status) status.innerText = "No saved data yet. Submit an interview to store candidate history.";
      return;
    }
    let pendingCount = 0;
    records.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.id;
      const reportTag = r.has_report ? "report ready" : "report pending";
      if (!r.has_report && r.submitted) pendingCount += 1;
      const dateIst = (r.updated_date_ist || r.created_date_ist || "").trim();
      const timeIst = (r.updated_time_ist || r.created_time_ist || "").trim();
      const whenIst = dateIst ? `${dateIst}${timeIst ? ` ${timeIst}` : ""} IST` : "IST N/A";
      opt.textContent = `${r.candidate_name} | ${reportTag} | ${whenIst}`;
      select.appendChild(opt);
    });
    if (pendingCount > 0) {
      if (status) status.innerText = `Generating ${pendingCount} report(s)... please wait, refreshing automatically.`;
      setReportLoader(
        true,
        `Generating ${pendingCount} report(s)…`,
        "Refreshing the list until the evaluation is saved. This usually takes a few seconds."
      );
    } else {
      if (status) status.innerText = `${records.length} saved candidate record(s) available for download.`;
      setReportLoader(false);
    }
    if (reportRefreshTimer) {
      clearTimeout(reportRefreshTimer);
      reportRefreshTimer = null;
    }
    if (pendingCount > 0) {
      reportRefreshTimer = window.setTimeout(() => {
        loadHrRecords();
      }, 2500);
    }
  } catch (err) {
    setReportLoader(false);
    if (status) status.innerText = `Could not load saved data: ${err.message}`;
  }
}

export async function downloadBlobReport(id, format, statusEl) {
  const res = await apiFetch(`/hr-record/${encodeURIComponent(id)}/download?format=${encodeURIComponent(format)}`);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `HTTP ${res.status}`);
  }
  if (format.toLowerCase() === "xlsx") {
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `karnex-interview-${String(id).slice(0, 8)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (statusEl) statusEl.innerText = "Excel report downloaded.";
    return;
  }
  const data = await handleJsonOrText(res);
  let content = "";
  let mime = "application/json";
  let ext = "json";
  if (typeof data === "string") {
    content = data;
    mime = "text/plain";
    ext = "txt";
  } else {
    if (data && data.error) throw new Error(data.error);
    content = JSON.stringify(data.record || data, null, 2);
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `candidate-${id}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  if (statusEl) statusEl.innerText = `Downloaded candidate-${id}.${ext}`;
}

export async function downloadLatestReportExcel() {
  const statusEl = document.getElementById("resultStatus");
  if (!state.lastInterviewId) {
    if (statusEl) statusEl.innerText = "Unlock evaluation first, then download Excel.";
    return;
  }
  try {
    if (statusEl) statusEl.innerText = "Preparing Excel…";
    await downloadBlobReport(state.lastInterviewId, "xlsx", statusEl);
  } catch (err) {
    if (statusEl) statusEl.innerText = `Excel download failed: ${err.message}`;
  }
}

async function fetchCurrentInterviewRecord() {
  let recordId = state.lastInterviewId;
  if (!recordId) {
    const selected = document.getElementById("recordSelect");
    if (selected && selected.value) recordId = selected.value;
  }
  if (!recordId) {
    const recordsData = await handleJson(await apiFetch("/hr-records"));
    const records = Array.isArray(recordsData.records) ? recordsData.records : [];
    if (records.length > 0) recordId = records[0].id;
  }
  if (!recordId) throw new Error("No interview record found. Unlock evaluation or select a saved record.");
  const data = await handleJson(await apiFetch(`/hr-record/${encodeURIComponent(recordId)}`));
  const record = data.record || {};
  if (!record || !Array.isArray(record.questions)) {
    throw new Error("Interview record is unavailable.");
  }
  state.lastInterviewId = record.id || recordId;
  return record;
}

function qaExportText(record) {
  const profile = record.candidate_profile || {};
  const name = profile.name || record.candidate_name || "Candidate";
  const role = profile.role_hint || "Candidate";
  const email = profile.email || record.candidate_email || "Not available";
  const skills = Array.isArray(record.skills) ? record.skills.join(", ") : "";
  const createdDateIst = record.created_date_ist || "N/A";
  const createdTimeIst = record.created_time_ist || "N/A";
  const updatedDateIst = record.updated_date_ist || "N/A";
  const updatedTimeIst = record.updated_time_ist || "N/A";
  const questions = Array.isArray(record.questions) ? record.questions : [];
  const answers = Array.isArray(record.answers) ? record.answers : [];
  const lines = [
    "Karnex Orbit — AI Interview Q&A Export",
    `Interview ID: ${record.id || state.lastInterviewId || ""}`,
    `Candidate: ${name}`,
    `Role: ${role}`,
    `Email: ${email}`,
    `Created (IST): ${createdDateIst} ${createdTimeIst}`,
    `Updated (IST): ${updatedDateIst} ${updatedTimeIst}`,
    `Skills: ${skills || "N/A"}`,
    "",
    "Questions and Answers:",
  ];
  questions.forEach((q, idx) => {
    const a = answers[idx] || "";
    lines.push(`${idx + 1}. Q: ${q || "Question not available"}`);
    lines.push(`   A: ${a || "No answer submitted."}`);
    lines.push("");
  });
  return lines.join("\n");
}

export async function downloadInterviewQaTxt() {
  const statusEl = document.getElementById("resultStatus");
  try {
    if (statusEl) statusEl.innerText = "Preparing Q&A TXT download...";
    const record = await fetchCurrentInterviewRecord();
    const content = qaExportText(record);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `karnex-qa-${String(record.id || state.lastInterviewId).slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (statusEl) statusEl.innerText = "Q&A TXT downloaded.";
  } catch (err) {
    if (statusEl) statusEl.innerText = `Q&A TXT download failed: ${err.message}`;
  }
}

export async function downloadInterviewQaPdf() {
  const statusEl = document.getElementById("resultStatus");
  try {
    if (statusEl) statusEl.innerText = "Preparing Q&A PDF view...";
    const record = await fetchCurrentInterviewRecord();
    const text = qaExportText(record)
      .split("\n")
      .map((line) => escapeHtml(line))
      .join("<br>");
    const w = window.open("", "_blank", "width=980,height=760");
    if (!w) throw new Error("Popup blocked. Allow popups to export PDF.");
    w.document.write(`<!doctype html><html><head><title>Karnex Orbit — Q&A PDF</title>
      <style>
      body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1d3448;line-height:1.5}
      h1{margin:0 0 12px;font-size:22px}
      .box{white-space:normal;border:1px solid #c5d6e6;border-radius:10px;padding:16px;background:#f8fbff}
      </style></head><body>
      <h1>Karnex Orbit — Interview Q&A</h1><div class="box">${text}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
    if (statusEl) statusEl.innerText = "Q&A PDF opened. Use Save as PDF in print dialog.";
  } catch (err) {
    if (statusEl) statusEl.innerText = `Q&A PDF export failed: ${err.message}`;
  }
}

export async function downloadSelectedRecord(format) {
  const select = document.getElementById("recordSelect");
  const status = document.getElementById("recordStatus");
  if (!select || !select.value) {
    if (status) status.innerText = "Select a candidate record first.";
    return;
  }
  try {
    if (status) status.innerText = `Preparing ${format.toUpperCase()} download...`;
    await downloadBlobReport(select.value, format, status);
  } catch (err) {
    if (status) status.innerText = `Download failed: ${err.message}`;
  }
}

export function renderSkillMatrix(skillScores) {
  const wrap = document.getElementById("skillMatrix");
  if (!wrap) return;
  if (!Array.isArray(skillScores) || skillScores.length === 0) {
    wrap.innerHTML = "<div class='status'>No skill-wise data available.</div>";
    return;
  }
  wrap.innerHTML = skillScores.map((s) => {
    const score = Math.max(0, Math.min(10, Number(s.score) || 0));
    const pct = Math.round((score / 10) * 100);
    return `
      <div class="matrix-row">
        <div class="matrix-label"><span>${escapeHtml(s.skill)}</span><span>${score}/10</span></div>
        <div class="matrix-track"><div class="matrix-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join("");
}

export function updateScoreTiles(resultText) {
  const scoreEl = document.getElementById("tileScore");
  const bandEl = document.getElementById("tileBand");
  const recEl = document.getElementById("tileRec");
  if (!scoreEl || !bandEl || !recEl) return;
  if (!resultText || typeof resultText !== "object") {
    scoreEl.textContent = "-";
    bandEl.textContent = "-";
    recEl.textContent = "-";
    scoreEl.className = "v";
    return;
  }
  const score = typeof resultText.overall_score === "number" ? resultText.overall_score : null;
  if (score === null || Number.isNaN(score)) {
    scoreEl.textContent = "N/A";
    bandEl.textContent = "Review";
    recEl.textContent = "Manual";
    scoreEl.className = "v";
    return;
  }
  scoreEl.textContent = `${score}/10`;
  let band = "Average";
  let css = "v warn";
  let rec = "Consider";
  if (score >= 8) {
    band = "Strong";
    css = "v good";
    rec = "Hire";
  } else if (score <= 4) {
    band = "Low";
    css = "v bad";
    rec = "Reject";
  }
  scoreEl.className = css;
  bandEl.textContent = band;
  recEl.textContent = resultText.recommendation || rec;
  renderSkillMatrix(resultText.skill_scores || []);
}

export function formatEvaluation(result) {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result, null, 2);
  }
  const lines = [];
  lines.push(`Overall Score: ${result.overall_score ?? "N/A"}/10`);
  lines.push(`Overall Fitment: ${result.overall_fitment ?? "N/A"}`);
  lines.push(`Recommendation: ${result.recommendation ?? "N/A"}`);
  lines.push("");
  lines.push("Skill-wise Evaluation:");
  (result.skill_scores || []).forEach((s, idx) => {
    lines.push(`${idx + 1}. ${s.skill}: ${s.score}/10`);
    lines.push(`   Evidence: ${s.evidence}`);
  });
  if (result.strengths?.length) lines.push("", `Strengths: ${result.strengths.join(" | ")}`);
  if (result.gaps?.length) lines.push(`Gaps: ${result.gaps.join(" | ")}`);
  if (result.summary) lines.push("", `Summary: ${result.summary}`);
  return lines.join("\n");
}

export function renderReportTables(meta, result) {
  const summaryWrap = document.getElementById("resultSummaryTable");
  const scoreWrap = document.getElementById("resultScoreTable");
  const weakWrap = document.getElementById("resultWeakAreas");
  const mgmtWrap = document.getElementById("managementReportBody");
  if (!summaryWrap || !scoreWrap || !weakWrap || !mgmtWrap) return;
  const profile = (meta && meta.candidate_profile) || {};
  const name = profile.name || "Candidate";
  const exp = profile.experience || "Not specified";
  const email = profile.email || "Not available";
  const role = profile.role_hint || "Candidate";
  const createdDateIst = meta?.created_date_ist || "N/A";
  const createdTimeIst = meta?.created_time_ist || "N/A";
  summaryWrap.innerHTML = `
    <table class="result-table">
      <tr><th>Candidate Name</th><td>${escapeHtml(name)}</td><th>Role</th><td>${escapeHtml(role)}</td></tr>
      <tr><th>Experience</th><td>${escapeHtml(exp)}</td><th>Email</th><td>${escapeHtml(email)}</td></tr>
      <tr><th>Interview Date (IST)</th><td>${escapeHtml(createdDateIst)}</td><th>Interview Time (IST)</th><td>${escapeHtml(createdTimeIst)}</td></tr>
      <tr><th>Overall Score</th><td>${escapeHtml(String(result?.overall_score ?? "N/A"))}/10</td><th>Recommendation</th><td>${escapeHtml(String(result?.recommendation ?? "N/A"))}</td></tr>
      <tr><th>Fitment</th><td colspan="3">${escapeHtml(String(result?.overall_fitment ?? "N/A"))}</td></tr>
    </table>
  `;
  const rows = Array.isArray(result?.skill_scores) ? result.skill_scores : [];
  if (!rows.length) {
    scoreWrap.innerHTML = "<div class='status'>No area-wise scores available.</div>";
  } else {
    const body = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.skill || "Skill")}</td>
        <td>${escapeHtml(String(r.score ?? "N/A"))}/10</td>
        <td>${escapeHtml(r.evidence || "")}</td>
      </tr>
    `).join("");
    scoreWrap.innerHTML = `<table class="result-table"><tr><th>Area / Skill</th><th>Score</th><th>Evidence</th></tr>${body}</table>`;
  }
  const gaps = Array.isArray(result?.gaps) ? result.gaps : [];
  weakWrap.innerHTML = gaps.length
    ? `<ul class="weak-list">${gaps.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ul>`
    : "<div class='status'>No weak areas reported.</div>";
  mgmtWrap.innerHTML = `
    <table class="result-table">
      <tr><th>Candidate Name</th><td>${escapeHtml(name)}</td><th>Role</th><td>${escapeHtml(role)}</td></tr>
      <tr><th>Experience</th><td>${escapeHtml(exp)}</td><th>Email</th><td>${escapeHtml(email)}</td></tr>
      <tr><th>Interview Date (IST)</th><td>${escapeHtml(createdDateIst)}</td><th>Interview Time (IST)</th><td>${escapeHtml(createdTimeIst)}</td></tr>
      <tr><th>Overall Score</th><td>${escapeHtml(String(result?.overall_score ?? "N/A"))}/10</td><th>Recommendation</th><td>${escapeHtml(String(result?.recommendation ?? "N/A"))}</td></tr>
      <tr><th>Fitment</th><td colspan="3">${escapeHtml(String(result?.overall_fitment ?? "N/A"))}</td></tr>
      <tr><th>Weak Areas</th><td colspan="3">${gaps.length ? escapeHtml(gaps.join(" | ")) : "None reported"}</td></tr>
    </table>
  `;
}

function weakPriorityInfo(score) {
  if (score <= 3) return { key: "high", label: "High" };
  if (score <= 5) return { key: "medium", label: "Medium" };
  return { key: "moderate", label: "Moderate" };
}

function buildDeepWeakAnalysis(skill, score, evidence) {
  const priority = weakPriorityInfo(score);
  const safeSkill = skill || "this skill";
  const safeEvidence = evidence || "Limited concrete technical evidence was observed in the candidate answers.";
  const impact = score <= 3
    ? `This is a critical hiring risk. Low depth in ${safeSkill} can impact production reliability, debugging speed, and delivery confidence.`
    : score <= 5
      ? `This is a moderate hiring risk. Current ${safeSkill} responses show partial understanding but not strong execution confidence.`
      : `This is a mild-to-moderate risk. Candidate understands basics of ${safeSkill}, but advanced production judgement is not yet clear.`;
  const expected = `Expected for this role: clear project example, architecture choices, debugging process, measurable result, and trade-off reasoning in ${safeSkill}.`;
  const action = score <= 3
    ? `Recommended HR action: run a focused practical round (45-60 min) for ${safeSkill}, including debugging and test validation, before final decision.`
    : score <= 5
      ? `Recommended HR action: ask 2 targeted follow-up questions and one scenario-based task in ${safeSkill} to validate real project ownership.`
      : `Recommended HR action: keep candidate in pipeline, but request one deeper case discussion in ${safeSkill} during next technical round.`;
  return { priority, impact, expected, action, evidence: safeEvidence };
}

export function renderWeakAreaDetails(result) {
  const wrap = document.getElementById("resultWeakDetail");
  if (!wrap) return;
  const rows = Array.isArray(result?.skill_scores) ? result.skill_scores : [];
  const weakRows = rows.filter((r) => Number(r.score) <= 6);
  const gaps = Array.isArray(result?.gaps) ? result.gaps : [];
  if (!weakRows.length && !gaps.length) {
    wrap.innerHTML = "<div class='status'>No detailed weak-area explanation needed.</div>";
    return;
  }
  const fromScores = weakRows.map((r) => {
    const score = Number(r.score) || 0;
    const analysis = buildDeepWeakAnalysis(r.skill || "Skill Gap", score, r.evidence || "");
    return `
      <div class="weak-detail-item">
        <div class="weak-detail-head">
          ${escapeHtml(r.skill || "Skill Gap")}
          <span class="weak-priority ${escapeHtml(analysis.priority.key)}">${escapeHtml(analysis.priority.label)} Priority</span>
        </div>
        <div class="weak-detail-meta">Score: ${escapeHtml(String(score))}/10</div>
        <div class="weak-detail-section-title">Observed Evidence</div>
        <div class="weak-detail-action">${escapeHtml(analysis.evidence)}</div>
        <div class="weak-detail-section-title">Risk Impact</div>
        <div class="weak-detail-action">${escapeHtml(analysis.impact)}</div>
        <div class="weak-detail-section-title">Expected Level for This Role</div>
        <div class="weak-detail-action">${escapeHtml(analysis.expected)}</div>
        <div class="weak-detail-section-title">Recommended HR Action</div>
        <div class="weak-detail-action">${escapeHtml(analysis.action)}</div>
      </div>
    `;
  });
  const fromGaps = gaps.map((g) => `
    <div class="weak-detail-item">
      <div class="weak-detail-head">General Gap <span class="weak-priority medium">Medium Priority</span></div>
      <div class="weak-detail-section-title">Observation</div>
      <div class="weak-detail-action">${escapeHtml(g)}</div>
      <div class="weak-detail-section-title">Recommended HR Action</div>
      <div class="weak-detail-action">Re-validate this topic in the next round using one direct scenario question plus one practical follow-up.</div>
    </div>
  `);
  wrap.innerHTML = `<div class="weak-detail-list">${fromScores.join("")}${fromGaps.join("")}</div>`;
}

export function renderInterviewQa(questions, answers) {
  const qaWrap = document.getElementById("resultQaList");
  if (!qaWrap) return;
  const qs = Array.isArray(questions) ? questions : [];
  const ans = Array.isArray(answers) ? answers : [];
  if (!qs.length) {
    qaWrap.innerHTML = "<div class='status'>No interview Q&A available.</div>";
    return;
  }
  const report = state.lastReportResult && typeof state.lastReportResult === "object" ? state.lastReportResult : {};
  const boundary = report.boundary_question && typeof report.boundary_question === "object" ? report.boundary_question : null;
  const boundaryTurn = boundary && Number.isFinite(Number(boundary.report_turn)) ? Number(boundary.report_turn) : null;
  const boundaryLabel = boundary && boundary.label ? String(boundary.label) : "";
  qaWrap.innerHTML = `<div class="qa-list">${
    qs.map((q, idx) => {
      const a = (ans[idx] || "").trim();
      const badge =
        boundaryTurn === idx + 1 && boundaryLabel
          ? `<span class="qa-boundary-badge">${escapeHtml(boundaryLabel)}</span> `
          : "";
      return `
        <div class="qa-item">
          <div class="qa-q">Q${idx + 1}. ${badge}${escapeHtml(q || "Question not available")}</div>
          <div class="qa-a">${a ? escapeHtml(a) : "<span class='qa-empty'>No answer submitted.</span>"}</div>
        </div>
      `;
    }).join("")
  }</div>`;
}

export function renderCommunicationEvaluation(commEval) {
  const wrap = document.getElementById("resultCommPres");
  if (!wrap) return;
  if (!commEval || typeof commEval !== "object" || Object.keys(commEval).length === 0) {
    wrap.innerHTML = "<div class='status'>No Communication & Presentation evaluation available.</div>";
    return;
  }
  const commScore = commEval.communication_score ?? "N/A";
  const presScore = commEval.presentation_score ?? "N/A";
  const overall = commEval.overall_score ?? "N/A";
  const summary = commEval.summary || "No summary available.";
  const strengths = Array.isArray(commEval.strengths) ? commEval.strengths.join(", ") : "N/A";
  const improvements = Array.isArray(commEval.improvements) ? commEval.improvements.join(", ") : "N/A";
  
  wrap.innerHTML = `
    <table class="result-table">
      <tr>
        <th>Overall Score</th><td><b>${overall}/10</b></td>
        <th>Communication Score</th><td>${commScore}/10</td>
        <th>Presentation Score</th><td>${presScore}/10</td>
      </tr>
      <tr><td colspan="6" style="padding:12px;">
        <div style="margin-bottom:8px;"><b>Summary:</b> ${escapeHtml(summary)}</div>
        <div style="margin-bottom:8px;"><b>Strengths:</b> ${escapeHtml(strengths)}</div>
        <div><b>Areas for Improvement:</b> ${escapeHtml(improvements)}</div>
      </td></tr>
    </table>
  `;
}

export async function unlockResult() {
  const secret = document.getElementById("resultCode").value.trim();
  const reportEl = document.getElementById("resultBox");
  const statusEl = document.getElementById("resultStatus");
  try {
    await assertBackendOnline();
    setReportLoader(true, "Unlocking evaluation…", "Validating HR access code and loading the latest report.");
    statusEl.innerText = "Validating code and generating evaluation...";
    const data = await handleJson(
      await apiFetch("/report", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret }),
      })
    );
    statusEl.innerText = "Result unlocked.";
    setReportLoader(false);
    state.lastInterviewId = data.interview_id || null;
    state.lastReportResult = data.result || null;
    reportEl.innerText = formatEvaluation(data.result || {});
    renderReportTables(data.meta || {}, data.result || {});
    renderWeakAreaDetails(data.result || {});
    updateScoreTiles(data.result || {});
    renderCommunicationEvaluation(data.result?.communication_evaluation || {});
    if (state.lastInterviewId) {
      try {
        const recordResp = await handleJson(await apiFetch(`/hr-record/${encodeURIComponent(state.lastInterviewId)}`));
        const record = recordResp.record || {};
        renderInterviewQa(record.questions || [], record.answers || []);
      } catch {
        renderInterviewQa([], []);
      }
    } else {
      renderInterviewQa([], []);
    }
    await loadHrRecords();
  } catch (err) {
    setReportLoader(false);
    statusEl.innerText = "";
    reportEl.innerText = `Error: ${err.message}`;
    updateScoreTiles("");
    renderWeakAreaDetails({});
    renderCommunicationEvaluation({});
    renderInterviewQa([], []);
  }
}

export function printManagementReport() {
  window.print();
}
