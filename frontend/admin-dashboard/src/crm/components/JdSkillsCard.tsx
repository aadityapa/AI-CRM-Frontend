/**
 * JdSkillsCard (1 Oct 2026, user ask: "when an opportunity is missing the JD, TA or any
 * role can upload the JD & skills — show it like this, make it the best").
 *
 * ONE card on the position page's Details tab in place of the amber banner + the
 * Skills card + the Job Description card. It reads the requirement the page already
 * holds (no fetch of its own) and opens the shared `JdSkillsModal` for every change —
 * the text, the file (PDF / Word) and the skills all go through that dialog, so the
 * server's JD_EDIT_ROLES (RMG · Sales · Sales Head · TA, Admin/CEO implicit, a GM through
 * the requirements Edit grant) stays the one rule.
 *
 *  - header: a readiness ring over the three things the ATS / AI L1 need (JD text ·
 *    JD file · skills) + the Edit / Add button; a reader without the grant sees who to ask.
 *  - MISSING: a setup panel — three checklist tiles (done / to do), why it matters, one
 *    big "Add JD & skills" call to action (the dialog's drop zone takes the file).
 *  - skills: mandatory first (star, solid), optional after, each with its required level;
 *    a count line that says what the ATS scores against.
 *  - job description: the RMG JD (collapsed past `JD_PREVIEW_LINES` with Show more, the
 *    files as chips) beside the customer's reference JD from the opportunity.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, FileText, FileUp,
  ListChecks, Pencil, Plus, ScanLine, Sparkles, Star, Users,
} from "lucide-react";

import { crmGet, crmUpload } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { useCanAct, useCanApprove } from "../useAccess";
import { FileLink } from "./FileUpload";
import { JdSkillsModal, type JdSkillsReq } from "./JdSkillsModal";
import { focusRing } from "./ui";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;
type Skill = { skill_id: number; name?: string | null; is_mandatory: boolean; min_rating: number | null };
type JdFile = { id: number; file_url: string; file_name: string | null };

export type JdSkillsCardReq = Omit<JdSkillsReq, "skills"> & {
  skills: Skill[];
  rmg_jd_attachments?: JdFile[] | null;
  customer_jd_attachments?: JdFile[] | null;
};

/** Lines of the RMG JD shown before "Show more". */
const JD_PREVIEW_LINES = 14;
const LEVEL_WORD: Record<number, string> = { 1: "Aware", 2: "Basic", 3: "Working", 4: "Strong", 5: "Expert" };

/** PURE — what the position has and what it lacks (the ring, the tiles, the chips). */
export function jdSkillsState(req: Pick<JdSkillsCardReq, "rmg_jd_text" | "rmg_jd_attachments" | "skills">) {
  const text = (req.rmg_jd_text || "").trim();
  const files = req.rmg_jd_attachments || [];
  const skills = req.skills || [];
  const mandatory = skills.filter((s) => s.is_mandatory).length;
  const hasJd = text.length > 0 || files.length > 0;
  const items = [
    { key: "text", label: "JD text", ok: text.length > 0, hint: text.length ? `${text.length.toLocaleString("en-IN")} characters` : "Paste it, or upload a file and it is read out" },
    { key: "file", label: "JD file (PDF / Word)", ok: files.length > 0, hint: files.length ? `${files.length} on record` : "Optional — the customer's or RMG's document" },
    { key: "skills", label: "Skills to source against", ok: skills.length > 0, hint: skills.length ? `${skills.length} skill${skills.length === 1 ? "" : "s"} · ${mandatory} mandatory` : "At least one; mark the must-haves" },
  ];
  const done = items.filter((i) => i.ok).length;
  const missing: string[] = [];
  if (!hasJd) missing.push("the JD");
  if (skills.length === 0) missing.push("the skills");
  return { text, files, skills, mandatory, hasJd, items, done, total: items.length, ready: hasJd && skills.length > 0, missing };
}

function Ring({ done, total, ready }: { done: number; total: number; ready: boolean }) {
  const r = 17; const c = 2 * Math.PI * r; const pct = total ? done / total : 0;
  const tone = ready ? "text-emerald-500" : done ? "text-amber-500" : "text-rose-500";
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center" aria-label={`${done} of ${total} ready`}>
      <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-current text-surface-2" />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className={`stroke-current ${tone}`} />
      </svg>
      <span className="absolute text-[11px] font-bold text-primary">{done}/{total}</span>
    </span>
  );
}

/** Customer JD files the card accepts (the server caps every attachment at 15 MB). */
const CUSTOMER_JD_ACCEPT = ".pdf,.doc,.docx,.txt";
const MAX_JD_BYTES = 15 * 1024 * 1024;

/** The dashed "add it here" tile a missing section shows to someone who may fill it
 *  (2 Oct 2026, user ask: RMG / GM add the missing skills, RMG JD and customer JD
 *  straight from the card). */
function AddTile({ label, hint, onClick, busy }: {
  label: string; hint: string; onClick: () => void; busy?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`flex w-full items-center gap-3 rounded-control border-2 border-dashed border-brand-200 bg-brand-50 px-3 py-2.5 text-left transition-colors duration-micro hover:border-brand-400 hover:bg-surface-1 disabled:opacity-60 dark:border-brand-800 dark:bg-surface-2 ${focusRing}`}>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-600 text-white shadow-raised">
        <Plus size={15} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-brand-700 dark:text-brand-300">{busy ? "Uploading…" : label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  );
}

/** A small header action ("Edit", "+ Add another") beside a section title. */
function SectionAction({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`ml-auto inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-60 dark:hover:bg-surface-2 ${focusRing}`}>
      {children}
    </button>
  );
}

const WHY = [
  { icon: ScanLine, text: "The ATS scores every resume against the JD and skills" },
  { icon: Bot, text: "The AI L1 interview asks on these skills" },
  { icon: Users, text: "TA sources and Suggested Candidates match on them" },
];

export function JdSkillsCard({ req, canEdit, toast, onSaved, defaultOpen = true }: {
  req: JdSkillsCardReq;
  /** The caller's JD_EDIT_ROLES answer (non-terminal status + role / grant). */
  canEdit: boolean;
  toast: ToastFn;
  onSaved: (updated: any) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const st = useMemo(() => jdSkillsState(req), [req]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /* The customer's reference JD (2 Oct 2026): stored on the OPPORTUNITY (kind
     customer_jd) through the position's attachment route, so the same JD-edit
     gate (RMG · GM · Sales · Sales Head · TA) lets anyone on the position add it. */
  const uploadCustomerJd = async (file: File) => {
    if (file.size > MAX_JD_BYTES) { toast("The file is larger than 15 MB", "err"); return; }
    setUploading(true);
    try {
      const res = await crmUpload(`/api/requirements/${req.id}/attachments`, file, { kind: "customer_jd" });
      toast(res.message || "Customer JD added");
      onSaved(null);
    } catch (e: any) {
      toast(e?.message || "Could not upload the customer JD", "err");
    } finally {
      setUploading(false);
    }
  };

  const jdLines = st.text ? st.text.split(/\r?\n/) : [];
  const clipped = !showAll && jdLines.length > JD_PREVIEW_LINES;
  const jdShown = clipped ? jdLines.slice(0, JD_PREVIEW_LINES).join("\n") : st.text;
  const mandatory = st.skills.filter((s) => s.is_mandatory);
  const optional = st.skills.filter((s) => !s.is_mandatory);
  const customerJd = req.customer_jd_attachments || [];

  const headTone = st.ready
    ? "from-emerald-500 to-teal-600"
    : st.done ? "from-amber-500 to-orange-600" : "from-rose-500 to-pink-600";

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-subtle px-4 py-3 sm:px-5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className={`flex min-w-0 flex-1 items-center gap-3 text-left ${focusRing} rounded-control`}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-gradient-to-br text-white shadow-raised ${headTone}`}>
            <ClipboardCheck size={16} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-primary">JD &amp; skills</span>
            <span className="block truncate text-xs text-muted">
              {st.ready
                ? `${st.skills.length} skill${st.skills.length === 1 ? "" : "s"} · ${st.mandatory} mandatory · JD ${st.text ? "written" : "on file"}${st.files.length ? ` · ${st.files.length} file${st.files.length === 1 ? "" : "s"}` : ""}`
                : `Missing ${st.missing.join(" and ")} — the ATS and AI L1 cannot score this position yet`}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          <Ring done={st.done} total={st.total} ready={st.ready} />
          {canEdit ? (
            <button type="button" onClick={() => setEditing(true)}
              className={`inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-xs font-semibold text-white shadow-raised transition-colors duration-micro ${focusRing} ${
                st.ready ? "bg-brand-600 hover:bg-brand-700" : "bg-amber-600 hover:bg-amber-700"}`}>
              {st.ready ? <><Pencil size={13} aria-hidden /> Edit JD &amp; skills</> : <><Plus size={13} aria-hidden /> Add JD &amp; skills</>}
            </button>
          ) : !st.ready ? (
            <span className="text-xs text-muted">Ask RMG / GM, Sales or TA to add it</span>
          ) : null}
          <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)}
            className={`rounded-control p-1 text-muted hover:bg-surface-2 ${focusRing}`}>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-5 px-4 py-4 sm:px-5">
          {/* setup panel — only while something is missing */}
          {!st.ready && (
            <div className="rounded-card border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 dark:border-amber-800 dark:from-amber-950/40 dark:to-orange-950/30">
              <div className="flex flex-wrap items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-amber-500 text-white shadow-raised">
                  <AlertTriangle size={16} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-primary">Set this position up for scoring</div>
                  <p className="mt-0.5 text-xs text-secondary">
                    Upload the JD as a PDF / Word file — the text is read out of it — or paste it, then pick the skills TA sources against.
                    {canEdit ? " Anyone on the position (RMG · GM · Sales · Sales Head · TA) can do it — or add each part below." : ""}
                  </p>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => setEditing(true)}
                    className={`inline-flex items-center gap-1.5 rounded-control bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white shadow-raised hover:bg-amber-700 ${focusRing}`}>
                    <FileUp size={15} aria-hidden /> Upload JD &amp; add skills
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {st.items.map((it) => (
                  <div key={it.key} className={`flex items-start gap-2 rounded-control border px-3 py-2 ${
                    it.ok ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-amber-200 bg-surface-1 dark:border-amber-800"}`}>
                    {it.ok
                      ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                      : <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 rounded-full border-2 border-amber-400" aria-hidden />}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-primary">{it.label}</div>
                      <div className="text-[11px] text-muted">{it.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-secondary">
                {WHY.map(({ icon: Icon, text }) => (
                  <li key={text} className="inline-flex items-center gap-1"><Icon size={12} className="text-amber-600" aria-hidden /> {text}</li>
                ))}
              </ul>
            </div>
          )}

          {/* skills */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <ListChecks size={14} className="text-sky-600" aria-hidden />
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted">Skills ({st.skills.length})</h4>
              {st.skills.length > 0 && (
                <span className="text-[11px] text-muted">· {st.mandatory} mandatory drive the ATS score · {optional.length} optional</span>
              )}
              {canEdit && st.skills.length > 0 && (
                <SectionAction onClick={() => setEditing(true)}><Pencil size={11} aria-hidden /> Edit skills</SectionAction>
              )}
            </div>
            {st.skills.length === 0 ? (
              canEdit ? (
                <AddTile label="Add skills" hint="Pick from the skills master and mark the must-haves — the ATS scores against them"
                  onClick={() => setEditing(true)} />
              ) : <p className="text-sm text-muted">No skills yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {[...mandatory, ...optional].map((s) => (
                  <span key={s.skill_id}
                    title={`${s.is_mandatory ? "Mandatory" : "Optional"}${s.min_rating != null ? ` · level ${s.min_rating} (${LEVEL_WORD[s.min_rating] || s.min_rating})` : ""}`}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      s.is_mandatory ? "bg-sky-600 text-white shadow-raised" : "border border-strong bg-surface-1 text-secondary"}`}>
                    {s.is_mandatory && <Star size={11} className="fill-current" aria-hidden />}
                    {s.name || `Skill #${s.skill_id}`}
                    {s.min_rating != null && <span className="opacity-75">· {s.min_rating}+</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* job description */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <FileText size={14} className="text-violet-600" aria-hidden />
                <h4 className="text-xs font-bold uppercase tracking-wide text-muted">RMG job description</h4>
                {canEdit && st.hasJd && (
                  <SectionAction onClick={() => setEditing(true)}><Pencil size={11} aria-hidden /> Edit JD</SectionAction>
                )}
                {st.files.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                    <FileUp size={11} aria-hidden /><FileLink url={a.file_url} label={a.file_name || "JD file"} />
                  </span>
                ))}
              </div>
              {st.text ? (
                <div className="rounded-control border border-subtle bg-surface-2 p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-primary">{jdShown}</p>
                  {jdLines.length > JD_PREVIEW_LINES && (
                    <button type="button" onClick={() => setShowAll((v) => !v)}
                      className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline ${focusRing}`}>
                      {showAll ? <><ChevronUp size={13} /> Show less</> : <><ChevronDown size={13} /> Show the full JD ({jdLines.length - JD_PREVIEW_LINES} more lines)</>}
                    </button>
                  )}
                </div>
              ) : st.files.length ? (
                <p className="text-sm text-muted">The JD is on file (above) — no text could be read from it.{canEdit ? " Paste the text so the ATS can score against it." : ""}</p>
              ) : canEdit ? (
                <AddTile label="Add the RMG JD" hint="Paste it, or upload a PDF / Word file and the text is read out"
                  onClick={() => setEditing(true)} />
              ) : (
                <p className="text-sm text-muted">No RMG JD yet.</p>
              )}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-slate-500" aria-hidden />
                <h4 className="text-xs font-bold uppercase tracking-wide text-muted">Customer JD (reference)</h4>
                {canEdit && customerJd.length > 0 && (
                  <SectionAction onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Plus size={11} aria-hidden /> {uploading ? "Uploading…" : "Add another"}
                  </SectionAction>
                )}
              </div>
              {canEdit && (
                <input ref={fileRef} type="file" accept={CUSTOMER_JD_ACCEPT} className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadCustomerJd(f);
                  }} />
              )}
              {customerJd.length === 0 ? (
                canEdit ? (
                  <AddTile label="Upload the customer's JD" hint="PDF / Word — kept on the opportunity as the reference"
                    busy={uploading} onClick={() => fileRef.current?.click()} />
                ) : <p className="text-sm text-muted">None uploaded on the opportunity.</p>
              ) : (
                <ul className="space-y-1.5">
                  {customerJd.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm">
                      <FileText size={14} className="shrink-0 text-slate-500" aria-hidden />
                      <FileLink url={a.file_url} label={a.file_name || "Customer JD"} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <JdSkillsModal req={req} toast={toast} onClose={() => setEditing(false)} onSaved={onSaved} />
      )}
    </section>
  );
}

/** Statuses where the JD can no longer change (mirror of the server's refusal). */
const TERMINAL = ["Fulfilled", "Closed", "Cancelled"];

/**
 * The same card for the OPPORTUNITY page, which holds only the requirement id —
 * Sales has no route to the position page, and RMG / GM work from here. Fetches
 * `/api/requirements/{id}` once, opens EXPANDED only while something is missing,
 * and re-reads after every save. Renders nothing it cannot load (a 404 for a role
 * the requirement is not shared with is not an error worth a banner).
 */
export function JdSkillsCardForRequirement({ requirementId, toast, onSaved }: {
  requirementId: number; toast: ToastFn; onSaved?: () => void;
}) {
  const me = useMe();
  const grant = useCanAct("requirements", "edit", useHasRole("RMG", "Sales", "Sales_Head", "TA"));
  /* …or whoever screens as RMG (a GM custom role) — the server's JD_EDIT_GATE. */
  const screener = useCanApprove("profile.rmg_screening");
  const isAdmin = me.roles.includes("Admin") || me.roles.includes("CEO");
  const [req, setReq] = useState<JdSkillsCardReq | null>(null);
  const load = useCallback(() => {
    let alive = true;
    crmGet<JdSkillsCardReq>(`/api/requirements/${requirementId}`)
      .then((r) => { if (alive && r.data) setReq({ ...r.data, skills: r.data.skills || [] }); })
      .catch(() => { if (alive) setReq(null); });
    return () => { alive = false; };
  }, [requirementId]);
  useEffect(() => load(), [load]);
  if (!req) return null;
  const canEdit = !TERMINAL.includes(req.status) && (isAdmin || grant || screener);
  return (
    <JdSkillsCard
      req={req}
      canEdit={canEdit}
      toast={toast}
      defaultOpen={!jdSkillsState(req).ready}
      onSaved={(u) => { if (u) setReq({ ...u, skills: u.skills || [] }); else load(); onSaved?.(); }}
    />
  );
}
