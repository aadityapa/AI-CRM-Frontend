/** HR Setup premium UI — scheduler, skills tags, profile preview (DOM sync only). */

import { apiFetch, handleJson } from "./core.js";

/** @type {Array<Record<string, unknown>>} */
let scheduleRows = [];
function todayDateOnly() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** @type {Date} */
let weekStart = startOfWeek(todayDateOnly());
/** @type {Date} */
let selectedDate = todayDateOnly();

const SLOT_BAR_MAX = 8;
const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function parseSkillsList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** 12-hour clock label for HR Setup displays (never 24-hour). */
export function formatTime12h(date) {
  let h = date.getHours();
  const min = String(date.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${min} ${ampm}`;
}

/** e.g. June 04, 2026 | 04:14 PM IST */
export function formatHrDateTimeDisplay(raw) {
  const dt = parseScheduleDateTime(raw);
  if (!dt) return raw ? String(raw) : "—";
  const month = dt.toLocaleString("en-US", { month: "long" });
  const day = String(dt.getDate()).padStart(2, "0");
  const year = dt.getFullYear();
  return `${month} ${day}, ${year} | ${formatTime12h(dt)} IST`;
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function sameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseScheduleDateTime(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const local = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (local) {
    const dt = new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4]),
      Number(local[5])
    );
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    const dt = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function isSameScheduleDay(dt, year, month, day) {
  return (
    dt &&
    dt.getFullYear() === year &&
    dt.getMonth() + 1 === month &&
    dt.getDate() === day
  );
}

function getSchedulesForDate(year, month, day) {
  return scheduleRows
    .map((row) => {
      const dt = parseScheduleDateTime(row.scheduled_at_local);
      return dt ? { row, dt } : null;
    })
    .filter((item) => item && isSameScheduleDay(item.dt, year, month, day))
    .sort((a, b) => a.dt.getTime() - b.dt.getTime());
}

function countSlotsOnDate(year, month, day) {
  return getSchedulesForDate(year, month, day).length;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSlotTime(dt) {
  return `${formatTime12h(dt)} IST`;
}

function formatSelectedDayTitle(date) {
  return date
    .toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}

function formatStatusLabel(row) {
  const session = String(row.session_status || "").trim().toLowerCase();
  const status = String(row.status || "").trim().toLowerCase();
  if (session === "completed" || status === "completed") return { text: "Completed", className: "completed" };
  if (session === "active" || session === "in_progress" || status === "in_progress") {
    return { text: "In progress", className: "in-progress" };
  }
  if (status) return { text: status.replace(/_/g, " "), className: "" };
  return { text: "Scheduled", className: "" };
}

function applyScheduleTimeToPicker(dt) {
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  const amBtn = document.getElementById("kxScheduleAm");
  const pmBtn = document.getElementById("kxSchedulePm");
  if (!hourEl || !minEl || !amBtn || !pmBtn) return;
  let h = dt.getHours();
  const pm = h >= 12;
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  setTimePickerValues(h, dt.getMinutes(), pm);
  syncScheduleDateTime();
}

function renderDaySlotsPanel() {
  const panel = document.getElementById("kxDaySlotsPanel");
  if (!panel) return;

  const y = selectedDate.getFullYear();
  const m = selectedDate.getMonth() + 1;
  const d = selectedDate.getDate();
  const booked = getSchedulesForDate(y, m, d);
  const count = booked.length;
  const countLabel =
    count === 0
      ? "No interviews booked"
      : count === 1
        ? "1 interview booked"
        : `${count} interviews booked`;

  let listHtml = "";
  if (!count) {
    listHtml =
      '<p class="kx-day-slots-empty">No interview slots booked on this date yet. Schedule a candidate below to add one.</p>';
  } else {
    listHtml = `<ul class="kx-day-slots-list">${booked
      .map(({ row, dt }, idx) => {
        const name = escapeHtml(row.candidate_name || "Candidate");
        const email = escapeHtml(row.candidate_email || "");
        const notes = escapeHtml(row.notes || "");
        const st = formatStatusLabel(row);
        const notesHtml = notes
          ? `<span class="kx-day-slot-notes">${notes}</span>`
          : "";
        return `
          <li>
            <button type="button" class="kx-day-slot-item${idx === 0 ? " is-active" : ""}" data-scheduled-at="${escapeHtml(row.scheduled_at_local || "")}">
              <span class="kx-day-slot-time">${formatSlotTime(dt)}</span>
              <span class="kx-day-slot-main">
                <span class="kx-day-slot-name">${name}</span>
                <span class="kx-day-slot-email">${email}</span>
                ${notesHtml}
              </span>
              <span class="kx-day-slot-status ${st.className}">${escapeHtml(st.text)}</span>
            </button>
          </li>`;
      })
      .join("")}</ul>`;
  }

  panel.innerHTML = `
    <div class="kx-day-slots-head">
      <h4 class="kx-day-slots-title">${formatSelectedDayTitle(selectedDate)}</h4>
      <span class="kx-day-slots-count${count ? "" : " is-empty"}">${countLabel}</span>
    </div>
    ${listHtml}
  `;

  panel.querySelectorAll(".kx-day-slot-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".kx-day-slot-item").forEach((el) => el.classList.remove("is-active"));
      btn.classList.add("is-active");
      const dt = parseScheduleDateTime(btn.getAttribute("data-scheduled-at"));
      if (dt) applyScheduleTimeToPicker(dt);
    });
  });
}

function formatSlotLabel(n) {
  return `${n} Slot${n === 1 ? "" : "s"}`;
}

function formatWeekRangeLabel(start) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const mStart = start.toLocaleString("en-US", { month: "long" }).toUpperCase();
  const mEnd = end.toLocaleString("en-US", { month: "long" }).toUpperCase();
  if (mStart === mEnd) {
    return `${mStart} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${mStart} ${start.getDate()} - ${mEnd} ${end.getDate()}, ${end.getFullYear()}`;
}

function formatIstSummary(date) {
  return formatHrDateTimeDisplay(toDatetimeLocalValue(date));
}

function toDatetimeLocalValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function getSelectedParts() {
  return {
    year: selectedDate.getFullYear(),
    month: selectedDate.getMonth() + 1,
    day: selectedDate.getDate(),
  };
}

function clampHour12(raw) {
  let h = parseInt(String(raw ?? "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(h)) return 12;
  if (h < 1) h = 1;
  if (h > 12) h = ((h - 1) % 12) + 1;
  return h;
}

function clampMinute(raw) {
  let m = parseInt(String(raw ?? "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(m)) return 0;
  if (m < 0) m = 0;
  if (m > 59) m = 59;
  return m;
}

function setTimePickerValues(hour12, minute, isPm) {
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  const amBtn = document.getElementById("kxScheduleAm");
  const pmBtn = document.getElementById("kxSchedulePm");
  const h = clampHour12(hour12);
  const m = clampMinute(minute);
  if (hourEl) hourEl.value = String(h).padStart(2, "0");
  if (minEl) minEl.value = String(m).padStart(2, "0");
  if (amBtn && pmBtn) {
    amBtn.classList.toggle("active", !isPm);
    pmBtn.classList.toggle("active", !!isPm);
    amBtn.setAttribute("aria-pressed", isPm ? "false" : "true");
    pmBtn.setAttribute("aria-pressed", isPm ? "true" : "false");
  }
}

function readScheduleParts() {
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  const pmBtn = document.getElementById("kxSchedulePm");
  const meta = getSelectedParts();
  let hour = clampHour12(hourEl?.value);
  const minute = clampMinute(minEl?.value);
  const isPm = pmBtn?.classList.contains("active");
  if (isPm && hour < 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  if (isPm && hour === 12) hour = 12;
  return {
    year: meta.year,
    month: meta.month,
    day: meta.day,
    hour,
    minute,
  };
}

function syncScheduleDateTime() {
  const input = document.getElementById("scheduleDateTime");
  const summary = document.getElementById("kxSelectedDateText");
  if (!input) return;
  const p = readScheduleParts();
  const dt = new Date(p.year, p.month - 1, p.day, p.hour, p.minute);
  input.value = toDatetimeLocalValue(dt);
  if (summary) summary.textContent = formatIstSummary(dt);
}

function setSkillsPanelMode(hasSkills) {
  const empty = document.getElementById("kxSkillsEmpty");
  const filled = document.getElementById("kxSkillsFilled");
  if (empty) empty.classList.toggle("is-hidden", hasSkills);
  if (filled) filled.classList.toggle("is-visible", hasSkills);
}

function renderSkillTags(skills) {
  const container = document.getElementById("kxSkillTagsContainer");
  if (!container) return;
  container.innerHTML = "";
  skills.forEach((name) => {
    const pill = document.createElement("div");
    pill.className = "kx-skill-pill";
    pill.innerHTML = `<span class="kx-skill-pill-name">${escapeHtml(name)}</span>`;
    container.appendChild(pill);
  });
}

export function refreshHrSetupSkillsUi() {
  const skills = parseSkillsList(document.getElementById("finalSkills")?.value);
  const hasSkills = skills.length > 0;
  setSkillsPanelMode(hasSkills);

  const templateName = document.getElementById("jobConfigSelect");
  const selected = templateName?.selectedOptions?.[0];
  const label = selected && selected.value ? selected.textContent : "";
  const shortLabel = label && label !== "Select a template..." ? label.split(" (")[0] : "";
  const nameEl = document.getElementById("kxSkillsTemplateName");
  if (nameEl) nameEl.textContent = shortLabel ? `[${shortLabel}]` : "[Template]";
  const smartRole = document.getElementById("kxSmartMatchRole");
  if (smartRole) smartRole.textContent = shortLabel || "template";

  if (!hasSkills) return;
  renderSkillTags(skills);
}

export function updateHrSetupProfilePreview(job) {
  const hintEl = document.getElementById("kxProfilePreviewHint");
  if (hintEl) {
    hintEl.textContent = job?.jobTitle
      ? `Optimized for ${job.jobTitle} role.`
      : "Select a template to preview assessment profile.";
  }
  refreshHrSetupSkillsUi();
}

function buildWeekDays() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const slots = countSlotsOnDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    days.push({
      day: DAY_LABELS[d.getDay()],
      date: d.getDate(),
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      slots,
      active: sameCalendarDay(d, selectedDate),
      dateObj: d,
    });
  }
  return days;
}

function scrollActiveDayIntoView() {
  const timeline = document.getElementById("kxTimelineScroll");
  const active = timeline?.querySelector(".kx-scheduler-day.active");
  active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
}

function selectScheduleDay(date, month, year, options = {}) {
  selectedDate = new Date(year, month - 1, date);
  const newWeekStart = startOfWeek(selectedDate);
  const weekChanged = newWeekStart.getTime() !== weekStart.getTime();
  weekStart = newWeekStart;

  if (weekChanged || options.forceTimeline) {
    renderTimeline();
  } else {
    updateTimelineActiveStates();
  }
  renderMiniCalendar();
  renderDaySlotsPanel();
  syncScheduleDateTime();
  if (options.scrollTimeline !== false) {
    requestAnimationFrame(scrollActiveDayIntoView);
  }
}

function updateTimelineActiveStates() {
  const timeline = document.getElementById("kxTimelineScroll");
  if (!timeline) return;
  timeline.querySelectorAll(".kx-scheduler-day").forEach((el) => {
    const y = Number(el.dataset.year);
    const m = Number(el.dataset.month);
    const d = Number(el.dataset.date);
    const active =
      y === selectedDate.getFullYear() &&
      m === selectedDate.getMonth() + 1 &&
      d === selectedDate.getDate();
    el.classList.toggle("active", active);
  });
}

function updateWeekLabel() {
  const label = document.getElementById("kxSchedulerWeekLabel");
  if (label) label.textContent = formatWeekRangeLabel(weekStart);
}

function renderTimeline() {
  const container = document.getElementById("kxTimelineScroll");
  if (!container) return;
  container.innerHTML = "";
  updateWeekLabel();

  const weekDays = buildWeekDays();
  const maxSlots = Math.max(SLOT_BAR_MAX, ...weekDays.map((d) => d.slots), 1);

  weekDays.forEach((item) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `kx-scheduler-day${item.active ? " active" : ""}`;
    el.dataset.date = String(item.date);
    el.dataset.month = String(item.month);
    el.dataset.year = String(item.year);
    const barPct = Math.min(100, Math.max(item.slots > 0 ? 10 : 0, (item.slots / maxSlots) * 100));
    el.innerHTML = `
      <span class="kx-sched-day-label">${item.day}</span>
      <span class="kx-sched-day-num">${item.date}</span>
      <div class="kx-sched-day-meta">
        <span class="kx-sched-day-slots">${formatSlotLabel(item.slots)}</span>
        <div class="kx-sched-day-bar" aria-hidden="true"><span style="width:${barPct}%"></span></div>
      </div>
    `;
    el.addEventListener("click", () =>
      selectScheduleDay(item.date, item.month, item.year)
    );
    container.appendChild(el);
  });
  renderDaySlotsPanel();
}

function renderMiniCalendar() {
  const container = document.getElementById("kxMiniCalendar");
  if (!container) return;
  container.innerHTML = "";

  const viewYear = selectedDate.getFullYear();
  const viewMonth = selectedDate.getMonth();
  const title = document.getElementById("kxMiniCalTitle");
  if (title) {
    title.textContent = new Date(viewYear, viewMonth, 1)
      .toLocaleString("en-US", { month: "long", year: "numeric" })
      .toUpperCase();
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startPad = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;

  for (let cell = 0; cell < totalCells; cell++) {
    const dayNum = cell - startPad + 1;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "kx-mini-day";

    if (dayNum < 1 || dayNum > daysInMonth) {
      const adj =
        dayNum < 1
          ? new Date(viewYear, viewMonth, 0).getDate() + dayNum
          : dayNum - daysInMonth;
      el.classList.add("muted");
      el.disabled = true;
      el.textContent = String(adj);
      container.appendChild(el);
      continue;
    }

    const cellDate = new Date(viewYear, viewMonth, dayNum);
    const inWeek =
      cellDate >= weekStart &&
      cellDate <= new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);

    el.textContent = String(dayNum);
    el.dataset.day = String(dayNum);
    el.dataset.month = String(viewMonth + 1);
    el.dataset.year = String(viewYear);
    el.title = `${formatSlotLabel(countSlotsOnDate(viewYear, viewMonth + 1, dayNum))} scheduled`;

    if (sameCalendarDay(cellDate, selectedDate)) {
      el.classList.add("active");
    }
    if (inWeek) {
      el.classList.add("in-week");
    }

    el.addEventListener("click", () => {
      selectScheduleDay(dayNum, viewMonth + 1, viewYear);
    });
    container.appendChild(el);
  }
}

function shiftWeek(delta) {
  weekStart = new Date(weekStart);
  weekStart.setDate(weekStart.getDate() + delta * 7);
  selectedDate = new Date(selectedDate);
  selectedDate.setDate(selectedDate.getDate() + delta * 7);
  renderTimeline();
  renderMiniCalendar();
  renderDaySlotsPanel();
  syncScheduleDateTime();
}

export function setHrSchedulerSchedules(rows) {
  scheduleRows = Array.isArray(rows) ? rows : [];
  renderTimeline();
  renderMiniCalendar();
  renderDaySlotsPanel();
}

export async function loadHrSchedulerSchedules() {
  try {
    const data = await handleJson(await apiFetch("/hr/schedules", { method: "GET" }));
    setHrSchedulerSchedules(data.schedules || []);
  } catch {
    setHrSchedulerSchedules([]);
  }
}

function populateTimeSelects() {
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  if (hourEl?.tagName === "SELECT" && !hourEl.options.length) {
    for (let h = 1; h <= 12; h += 1) {
      const val = String(h).padStart(2, "0");
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      hourEl.appendChild(opt);
    }
    hourEl.value = "12";
  }
  if (minEl?.tagName === "SELECT" && !minEl.options.length) {
    for (let m = 0; m < 60; m += 1) {
      const val = String(m).padStart(2, "0");
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      minEl.appendChild(opt);
    }
    minEl.value = "00";
  }
}

function normalizeTimeInputs() {
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  if (!hourEl || !minEl) return;
  const pmBtn = document.getElementById("kxSchedulePm");
  const isPm = pmBtn?.classList.contains("active");
  setTimePickerValues(hourEl.value, minEl.value, isPm);
}

function initTimePicker() {
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  const amBtn = document.getElementById("kxScheduleAm");
  const pmBtn = document.getElementById("kxSchedulePm");
  if (!hourEl || !minEl || !amBtn || !pmBtn) return;

  populateTimeSelects();

  const setAmPm = (pm) => {
    amBtn.classList.toggle("active", !pm);
    pmBtn.classList.toggle("active", pm);
    amBtn.setAttribute("aria-pressed", pm ? "false" : "true");
    pmBtn.setAttribute("aria-pressed", pm ? "true" : "false");
    syncScheduleDateTime();
  };
  amBtn.addEventListener("click", () => setAmPm(false));
  pmBtn.addEventListener("click", () => setAmPm(true));

  const bumpField = (field, delta) => {
    if (field === "hour") {
      let h = clampHour12(hourEl.value) + delta;
      if (h > 12) h = 1;
      if (h < 1) h = 12;
      hourEl.value = String(h).padStart(2, "0");
    } else {
      let m = clampMinute(minEl.value) + delta;
      if (m > 59) m = 0;
      if (m < 0) m = 59;
      minEl.value = String(m).padStart(2, "0");
    }
    syncScheduleDateTime();
  };

  document.querySelectorAll(".kx-time-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.getAttribute("data-field");
      const dir = Number(btn.getAttribute("data-dir") || 1);
      if (field === "hour" || field === "min") bumpField(field, dir);
    });
  });

  const onTimeFieldKey = (el, field) => (ev) => {
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      bumpField(field, 1);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      bumpField(field, -1);
      return;
    }
    if (/^\d$/.test(ev.key)) {
      const buf = (el.dataset.kxTypeBuf || "") + ev.key;
      const next = buf.slice(-2);
      el.dataset.kxTypeBuf = next;
      if (field === "hour") {
        el.value = String(clampHour12(next)).padStart(2, "0");
      } else {
        el.value = String(clampMinute(next)).padStart(2, "0");
      }
      syncScheduleDateTime();
      ev.preventDefault();
    }
  };

  const onTimeBlur = (el) => () => {
    delete el.dataset.kxTypeBuf;
    normalizeTimeInputs();
    syncScheduleDateTime();
  };

  hourEl.addEventListener("keydown", onTimeFieldKey(hourEl, "hour"));
  minEl.addEventListener("keydown", onTimeFieldKey(minEl, "min"));
  hourEl.addEventListener("change", () => {
    delete hourEl.dataset.kxTypeBuf;
    normalizeTimeInputs();
    syncScheduleDateTime();
  });
  minEl.addEventListener("change", () => {
    delete minEl.dataset.kxTypeBuf;
    normalizeTimeInputs();
    syncScheduleDateTime();
  });
  hourEl.addEventListener("blur", onTimeBlur(hourEl));
  minEl.addEventListener("blur", onTimeBlur(minEl));
}

function initScheduleFromInput() {
  const input = document.getElementById("scheduleDateTime");
  if (!input?.value) {
    syncScheduleDateTime();
    return;
  }
  const dt = new Date(input.value);
  if (Number.isNaN(dt.getTime())) {
    syncScheduleDateTime();
    return;
  }
  const hourEl = document.getElementById("kxScheduleHour");
  const minEl = document.getElementById("kxScheduleMin");
  const amBtn = document.getElementById("kxScheduleAm");
  const pmBtn = document.getElementById("kxSchedulePm");
  let h = dt.getHours();
  const pm = h >= 12;
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  setTimePickerValues(h, dt.getMinutes(), pm);
  selectScheduleDay(dt.getDate(), dt.getMonth() + 1, dt.getFullYear(), {
    scrollTimeline: false,
  });
}

function initSchedulerToNow() {
  const now = new Date();
  selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart = startOfWeek(selectedDate);
  applyScheduleTimeToPicker(now);
  renderTimeline();
  renderMiniCalendar();
  renderDaySlotsPanel();
  syncScheduleDateTime();
}

export function initHrSetupUi() {
  initTimePicker();
  const scheduleInput = document.getElementById("scheduleDateTime");
  if (scheduleInput?.value) {
    initScheduleFromInput();
  } else {
    initSchedulerToNow();
  }
  refreshHrSetupSkillsUi();
  const isInviteCandidateFlow = Boolean(new URLSearchParams(window.location.search).get("invite"));
  if (!isInviteCandidateFlow) {
    loadHrSchedulerSchedules();
  }

  document.addEventListener("kx-hr-setup-skills-updated", refreshHrSetupSkillsUi);
  document.addEventListener("kx-hr-schedules-updated", (e) => {
    setHrSchedulerSchedules(e.detail?.schedules || []);
  });

  const finalSkills = document.getElementById("finalSkills");
  if (finalSkills) {
    finalSkills.addEventListener("input", refreshHrSetupSkillsUi);
    finalSkills.addEventListener("change", refreshHrSetupSkillsUi);
  }

  const jobSelect = document.getElementById("jobConfigSelect");
  if (jobSelect) jobSelect.addEventListener("change", () => setTimeout(refreshHrSetupSkillsUi, 0));

  document.getElementById("kxWeekPrev")?.addEventListener("click", () => shiftWeek(-1));
  document.getElementById("kxWeekNext")?.addEventListener("click", () => shiftWeek(1));

  document.getElementById("kxChangeZoneBtn")?.addEventListener("click", () => {
    document.querySelector(".kx-scheduler-side")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  document.getElementById("kxSkillsEditLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    const box = document.getElementById("finalSkills");
    if (!box) return;
    const manual = window.prompt("Enter skills (comma-separated):", box.value || "");
    if (manual !== null) {
      box.value = manual.trim();
      refreshHrSetupSkillsUi();
    }
  });

  const modelEl = document.getElementById("customModel") || document.getElementById("model");
  const providerEl = document.getElementById("kxAiProviderLabel");
  if (providerEl && modelEl) {
    const sync = () => {
      providerEl.textContent = `AI provider: OpenAI ${(modelEl.value || "gpt-4o-mini").trim()} optimized`;
    };
    sync();
    modelEl.addEventListener("change", sync);
  }
}
