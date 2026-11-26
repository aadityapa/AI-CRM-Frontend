/**
 * The company resume — one format for every employee (23 Nov 2026).
 *
 * User ask: "we set one resume template; they just update the fields and the
 * resume is created automatically; RMG, GM and CEO see it; the file name is
 * the person's name". The format is HR's sample ("Abhishek Singh.docx"): name +
 * headline, contact line, a rule, then PROFESSIONAL SUMMARY · TECHNICAL SKILLS ·
 * PROFESSIONAL EXPERIENCE · PROJECT DETAILS · EDUCATION (+ CERTIFICATIONS when
 * filled). The SERVER draws the Word / PDF (`services/employee_resume.py`); this
 * component edits the data and shows a live preview in the same layout.
 *
 * Used by Bench & Deployed (`/api/bench/{id}/resume`, RMG / GM edit) and My
 * Workspace (`/api/my-workspace/resume`, the employee edits). `base` is the
 * resume URL; `${base}.docx` / `${base}.pdf` are the downloads.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, CheckCircle2, Download, Eye, FileText, History, PenLine, Plus, Save, Trash2,
} from "lucide-react";
import { crmGet, crmPut } from "../../api";
import { authFetch } from "../../../api/client";
import { ErrorBox, btnPrimary, btnSecondary, inputCls } from "../ui";
import { fmtDateTime12 } from "../../../lib/datetime";

export type SkillRow = { label: string; items: string };
export type ExpRow = { title: string; company: string; period: string; bullets: string[] };
export type ProjectRow = { title: string; duration: string; bullets: string[] };
export type EduRow = { institute: string; degree: string; score: string; year: string };
export type ResumeData = {
  name: string; headline: string; email: string; phone: string; location: string; summary: string;
  skills: SkillRow[]; experience: ExpRow[]; projects: ProjectRow[]; education: EduRow[]; certifications: string[];
};
export type ResumePayload = {
  data: ResumeData;
  completeness: { percent: number; done: number; total: number; missing: string[] };
  saved: boolean;
  updated_at: string | null;
  updated_by_name: string | null;
  file_name: string;
  versions: { id: number; saved_at: string | null; by: string | null; note: string | null }[];
};

export const SUMMARY_MIN = 120;
const BLUE = "#1F4E79";

export const EMPTY_RESUME: ResumeData = {
  name: "", headline: "", email: "", phone: "", location: "", summary: "",
  skills: [], experience: [], projects: [], education: [], certifications: [],
};

/** The server's `completeness` rule, live while typing. PURE. */
export function completenessOf(d: ResumeData): { percent: number; missing: string[] } {
  const checks: [string, boolean][] = [
    ["Name", !!d.name.trim()],
    ["Headline (your role)", !!d.headline.trim()],
    ["Email and phone", !!(d.email.trim() && d.phone.trim())],
    ["Location", !!d.location.trim()],
    [`Professional summary (${SUMMARY_MIN}+ characters)`, d.summary.trim().length >= SUMMARY_MIN],
    ["Technical skills", d.skills.some((s) => s.items.trim())],
    ["Experience or a project with 2+ points",
      [...d.experience, ...d.projects].some((r) => r.bullets.filter((b) => b.trim()).length >= 2)],
    ["Education", d.education.some((e) => e.institute.trim() || e.degree.trim())],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { percent: Math.round((done * 100) / checks.length), missing: checks.filter(([, ok]) => !ok).map(([l]) => l) };
}

/** Bullet lines ⇄ textarea text (one point per line). PURE. */
export const bulletsToText = (b: string[]) => b.join("\n");
export const textToBullets = (t: string) =>
  t.split("\n").map((x) => x.replace(/^\s*(?:[-*•·▪]|\d+[.)])\s*/, "").trim()).filter(Boolean);

function normalise(d: Partial<ResumeData> | null | undefined): ResumeData {
  return { ...EMPTY_RESUME, ...(d || {}),
    skills: d?.skills || [], experience: d?.experience || [], projects: d?.projects || [],
    education: d?.education || [], certifications: d?.certifications || [] };
}

export async function downloadResume(path: string, fallback: string): Promise<void> {
  const res = await authFetch(path);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = utf ? decodeURIComponent(utf[1]) : plain?.[1] || fallback;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/* ------------------------------------------------------------------ preview */

export function ResumePreview({ d }: { d: ResumeData }) {
  const contact = [d.email, d.phone, d.location].filter(Boolean).join("  |  ");
  const H = ({ children }: { children: string }) => (
    <h3 className="mt-5 mb-2 text-[17px] font-bold" style={{ color: BLUE }}>{children}</h3>
  );
  return (
    <div className="mx-auto max-w-[680px] bg-[#ffffff] px-10 py-9 text-[12.5px] leading-relaxed text-[#1e293b] shadow-raised ring-1 ring-black/5"
         style={{ fontFamily: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" }}>
      <div className="text-[22px] font-bold" style={{ color: BLUE }}>{d.name || "Your name"}</div>
      {d.headline && <div className="text-[16px]">{d.headline}</div>}
      <div className="mt-1 border-b border-[#a0a0a0] pb-2 text-[12px]">{contact || "email  |  phone  |  location"}</div>
      {d.summary && (<><H>PROFESSIONAL SUMMARY</H><p className="pl-8 text-justify">{d.summary}</p></>)}
      {d.skills.length > 0 && (<><H>TECHNICAL SKILLS</H>
        {d.skills.map((s, i) => (
          <p key={i} className="mb-1.5 pl-8">{s.label && <b>{s.label}: </b>}{s.items}</p>
        ))}</>)}
      {d.experience.length > 0 && (<><H>PROFESSIONAL EXPERIENCE</H>
        {d.experience.map((x, i) => (
          <div key={i} className="mb-2 pl-4">
            <div className="text-[14px] font-bold">{x.title || x.company}</div>
            {(x.title && x.company) || x.period ? (
              <div className="text-[12px] text-[#595959]">{[x.title ? x.company : "", x.period].filter(Boolean).join(" · ")}</div>
            ) : null}
            <ul className="mt-1 list-disc pl-10 text-justify">{x.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          </div>
        ))}</>)}
      {d.projects.length > 0 && (<><H>PROJECT DETAILS</H>
        {d.projects.map((x, i) => (
          <div key={i} className="mb-2 pl-4">
            <div className="text-[14px]"><b>Project {i + 1}: {x.title}</b>{x.duration && ` (${x.duration})`}</div>
            <ul className="mt-1 list-disc pl-10 text-justify">{x.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          </div>
        ))}</>)}
      {d.education.length > 0 && (<><H>EDUCATION</H>
        {d.education.map((e, i) => (
          <div key={i} className="mb-2 pl-8">
            {e.institute && <div className="font-bold">{e.institute}</div>}
            <div className="flex gap-12"><span>{e.degree}{e.year && ` (${e.year})`}</span>{e.score && <span>{e.score}</span>}</div>
          </div>
        ))}</>)}
      {d.certifications.length > 0 && (<><H>CERTIFICATIONS</H>
        <ul className="list-disc pl-12">{d.certifications.map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

const ROW_BTN = "inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40";
const ADD_BTN = "inline-flex items-center gap-1.5 rounded-control border border-dashed border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30";

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function RowTools({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (by: number) => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" className={ROW_BTN} disabled={i === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp size={14} /></button>
      <button type="button" className={ROW_BTN} disabled={i === n - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown size={14} /></button>
      <button type="button" className={`${ROW_BTN} hover:!text-danger`} onClick={onRemove} aria-label="Remove"><Trash2 size={14} /></button>
    </div>
  );
}

function Section({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <header className="mb-3 flex items-start gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-emerald-500 text-white" : "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"}`}>
          {done ? <CheckCircle2 size={15} /> : n}
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-primary">{title}</h4>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Txt({ label, value, onChange, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-secondary">{label}</span>
      <input className={inputCls} value={value} placeholder={placeholder} disabled={disabled}
             onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Bullets({ value, onChange, disabled, placeholder }: {
  value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string;
}) {
  // Keep the raw text while typing (blank lines included); store the cleaned list.
  const [text, setText] = useState(bulletsToText(value));
  useEffect(() => { setText((t) => (textToBullets(t).join("\n") === value.join("\n") ? t : bulletsToText(value))); }, [value]);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-secondary">Points — one per line ({value.length})</span>
      <textarea className={`${inputCls} !min-h-[96px] font-normal`} value={text} disabled={disabled}
                rows={Math.min(18, Math.max(4, Math.ceil(text.length / 90) + text.split("\n").length))}
                placeholder={placeholder || "Performed functional and system testing of …\nAutomated regression tests in Python …"}
                onChange={(e) => { setText(e.target.value); onChange(textToBullets(e.target.value)); }} />
    </label>
  );
}

export function ResumeEditor({ base, canEdit, toast, title = "Resume", onSaved }: {
  base: string;
  canEdit: boolean;
  toast: (msg: string, kind?: "ok" | "err") => void;
  title?: string;
  onSaved?: () => void;
}) {
  const [payload, setPayload] = useState<ResumePayload | null>(null);
  const [d, setD] = useState<ResumeData>(EMPTY_RESUME);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"edit" | "preview">(canEdit ? "edit" : "preview");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await crmGet<ResumePayload>(base);
      setPayload(r.data);
      setD(normalise(r.data.data));
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const live = useMemo(() => completenessOf(d), [d]);
  const set = <K extends keyof ResumeData>(k: K, v: ResumeData[K]) => { setD((p) => ({ ...p, [k]: v })); setDirty(true); };

  const save = async () => {
    setBusy(true);
    try {
      const r = await crmPut<ResumePayload>(base, { data: d, note: note.trim() || null });
      setPayload(r.data);
      setD(normalise(r.data.data));
      setDirty(false);
      setNote("");
      toast(r.message || "Resume saved");
      onSaved?.();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const download = async (ext: "docx" | "pdf") => {
    if (dirty) { toast("Save your changes first — the file is made from the saved resume", "err"); return; }
    try {
      await downloadResume(`${base}.${ext}`, `${payload?.file_name || "Resume"}.${ext}`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!payload) return <div className="p-6 text-sm text-muted">Loading the resume…</div>;
  const ro = !canEdit;

  return (
    <div className="space-y-4">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
        <div className="relative h-14 w-14 shrink-0" title={`${live.percent}% complete`}>
          <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-surface-2" />
            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" strokeLinecap="round"
                    stroke={live.percent >= 100 ? "#059669" : live.percent >= 60 ? "#d97706" : "#e11d48"}
                    strokeDasharray={`${(live.percent / 100) * 97.4} 97.4`} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary">{live.percent}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-primary">
            <FileText size={16} className="text-brand-600" /> {title}
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">
              File: {payload.file_name}.docx / .pdf
            </span>
            {!payload.saved && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Draft from HR records — not saved yet</span>}
            {dirty && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">Unsaved changes</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {live.missing.length ? `Still to fill: ${live.missing.join(" · ")}` : "Ready to send to a customer."}
            {payload.updated_at && ` · Last saved ${fmtDateTime12(payload.updated_at)} by ${payload.updated_by_name || "—"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <div className="inline-flex rounded-control border border-subtle p-0.5" role="tablist" aria-label="Resume view">
              {(["edit", "preview"] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v}
                        className={`inline-flex items-center gap-1 rounded-control px-2.5 py-1 text-xs font-semibold ${
                          view === v ? "bg-brand-600 text-white" : "text-secondary hover:bg-surface-2"}`}
                        onClick={() => setView(v)}>
                  {v === "edit" ? <PenLine size={13} /> : <Eye size={13} />}{v === "edit" ? "Edit" : "Preview"}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={btnSecondary} onClick={() => void download("docx")}><Download size={14} /> Word</button>
          <button type="button" className={btnSecondary} onClick={() => void download("pdf")}><Download size={14} /> PDF</button>
        </div>
      </div>

      {view === "preview" || ro ? (
        <div className="rounded-card bg-surface-2 p-4"><ResumePreview d={d} /></div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <div className="space-y-4">
            <Section n={1} title="About you" hint="Printed at the top of the resume." done={!!(d.name && d.headline && d.email && d.phone && d.location)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Txt label="Full name" value={d.name} onChange={(v) => set("name", v)} placeholder="Abhishek Singh" />
                <Txt label="Headline (your role)" value={d.headline} onChange={(v) => set("headline", v)} placeholder="Automotive Software Tester" />
                <Txt label="Email" value={d.email} onChange={(v) => set("email", v)} />
                <Txt label="Phone" value={d.phone} onChange={(v) => set("phone", v)} placeholder="+91-98…" />
                <Txt label="Location" value={d.location} onChange={(v) => set("location", v)} placeholder="Pune, India" />
              </div>
            </Section>

            <Section n={2} title="Professional summary" done={d.summary.trim().length >= SUMMARY_MIN}
                     hint={`3–5 lines: years of experience, the domain, the main tools. ${d.summary.trim().length} / ${SUMMARY_MIN}+ characters`}>
              <textarea className={`${inputCls} !min-h-[120px]`} value={d.summary} onChange={(e) => set("summary", e.target.value)}
                        rows={Math.min(14, Math.max(5, Math.ceil(d.summary.length / 90) + 1))}
                        placeholder="Automotive Software Test Engineer with 3+ years of experience in …" />
            </Section>

            <Section n={3} title="Technical skills" hint="One line per group, e.g. Automation: Python, CAPL." done={d.skills.some((s) => s.items.trim())}>
              {d.skills.map((s, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="w-44 shrink-0"><Txt label="Group" value={s.label} onChange={(v) => set("skills", d.skills.map((x, j) => (j === i ? { ...x, label: v } : x)))} placeholder="Automation" /></div>
                  <div className="min-w-0 flex-1"><Txt label="Skills" value={s.items} onChange={(v) => set("skills", d.skills.map((x, j) => (j === i ? { ...x, items: v } : x)))} placeholder="Python, CAPL" /></div>
                  <RowTools i={i} n={d.skills.length} onMove={(by) => set("skills", move(d.skills, i, by))} onRemove={() => set("skills", d.skills.filter((_, j) => j !== i))} />
                </div>
              ))}
              <button type="button" className={ADD_BTN} onClick={() => set("skills", [...d.skills, { label: "", items: "" }])}><Plus size={13} /> Add a skill group</button>
            </Section>

            <Section n={4} title="Professional experience" hint="Your role and what you did — 4 to 8 points." done={d.experience.some((x) => x.bullets.length >= 2)}>
              {d.experience.map((x, i) => (
                <div key={i} className="rounded-control border border-subtle p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                      <div className="sm:col-span-3"><Txt label="Role | focus" value={x.title} onChange={(v) => set("experience", d.experience.map((r, j) => (j === i ? { ...r, title: v } : r)))} placeholder="Automotive Software Test Engineer | Python Automation" /></div>
                      <div className="sm:col-span-2"><Txt label="Company (optional)" value={x.company} onChange={(v) => set("experience", d.experience.map((r, j) => (j === i ? { ...r, company: v } : r)))} /></div>
                      <Txt label="Period (optional)" value={x.period} onChange={(v) => set("experience", d.experience.map((r, j) => (j === i ? { ...r, period: v } : r)))} placeholder="Jan 2023 – Present" />
                    </div>
                    <RowTools i={i} n={d.experience.length} onMove={(by) => set("experience", move(d.experience, i, by))} onRemove={() => set("experience", d.experience.filter((_, j) => j !== i))} />
                  </div>
                  <Bullets value={x.bullets} onChange={(v) => set("experience", d.experience.map((r, j) => (j === i ? { ...r, bullets: v } : r)))} />
                </div>
              ))}
              <button type="button" className={ADD_BTN} onClick={() => set("experience", [...d.experience, { title: "", company: "", period: "", bullets: [] }])}><Plus size={13} /> Add experience</button>
            </Section>

            <Section n={5} title="Project details" hint="Never name the customer — describe the product and your work." done={d.projects.some((x) => x.bullets.length >= 2)}>
              {d.projects.map((x, i) => (
                <div key={i} className="rounded-control border border-subtle p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                      <div className="sm:col-span-2"><Txt label={`Project ${i + 1} title`} value={x.title} onChange={(v) => set("projects", d.projects.map((r, j) => (j === i ? { ...r, title: v } : r)))} placeholder="Android Infotainment (IVI) Validation" /></div>
                      <Txt label="Duration" value={x.duration} onChange={(v) => set("projects", d.projects.map((r, j) => (j === i ? { ...r, duration: v } : r)))} placeholder="1.5 years - current" />
                    </div>
                    <RowTools i={i} n={d.projects.length} onMove={(by) => set("projects", move(d.projects, i, by))} onRemove={() => set("projects", d.projects.filter((_, j) => j !== i))} />
                  </div>
                  <Bullets value={x.bullets} onChange={(v) => set("projects", d.projects.map((r, j) => (j === i ? { ...r, bullets: v } : r)))} />
                </div>
              ))}
              <button type="button" className={ADD_BTN} onClick={() => set("projects", [...d.projects, { title: "", duration: "", bullets: [] }])}><Plus size={13} /> Add a project</button>
            </Section>

            <Section n={6} title="Education" done={d.education.some((e) => e.institute || e.degree)}>
              {d.education.map((e, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-4">
                    <div className="sm:col-span-2"><Txt label="College / university" value={e.institute} onChange={(v) => set("education", d.education.map((r, j) => (j === i ? { ...r, institute: v } : r)))} /></div>
                    <Txt label="Degree" value={e.degree} onChange={(v) => set("education", d.education.map((r, j) => (j === i ? { ...r, degree: v } : r)))} placeholder="BE" />
                    <Txt label="Score" value={e.score} onChange={(v) => set("education", d.education.map((r, j) => (j === i ? { ...r, score: v } : r)))} placeholder="GPA: 8.06/10" />
                  </div>
                  <RowTools i={i} n={d.education.length} onMove={(by) => set("education", move(d.education, i, by))} onRemove={() => set("education", d.education.filter((_, j) => j !== i))} />
                </div>
              ))}
              <button type="button" className={ADD_BTN} onClick={() => set("education", [...d.education, { institute: "", degree: "", score: "", year: "" }])}><Plus size={13} /> Add education</button>
            </Section>

            <Section n={7} title="Certifications (optional)" hint="Printed only when filled. One per line." done={d.certifications.length > 0}>
              <Bullets value={d.certifications} onChange={(v) => set("certifications", v)} placeholder="ISTQB Foundation Level" />
            </Section>

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-card border border-subtle bg-surface-1 p-3 shadow-overlay">
              <input className={`${inputCls} !w-auto min-w-0 flex-1`} placeholder="What changed? (optional — kept in the history)"
                     value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              <button type="button" className={btnPrimary} disabled={busy || !d.name.trim()} onClick={() => void save()}>
                <Save size={14} /> {busy ? "Saving…" : "Save resume"}
              </button>
            </div>
          </div>
          <div className="hidden xl:block">
            <div className="sticky top-2 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-card bg-surface-2 p-3">
              <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">Live preview — the Word / PDF looks like this</p>
              <ResumePreview d={d} />
            </div>
          </div>
        </div>
      )}

      {payload.versions.length > 0 && (
        <details className="rounded-card border border-subtle bg-surface-1 p-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-secondary"><History size={14} /> Change history ({payload.versions.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-secondary">
            {payload.versions.map((v) => (
              <li key={v.id}>{fmtDateTime12(v.saved_at)} — {v.by || "—"}{v.note ? ` · ${v.note}` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
