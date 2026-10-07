/**
 * JdSkillsModal (extracted 28 Sep 2026 from Requirements.tsx; redesigned 30 Sep 2026 on the
 * dialog kit) — the ONE "Edit JD & skills" dialog: `PATCH /api/requirements/{id}/jd-skills`.
 * Shared by the requirement page, the Screening Desk (a position with no JD and no skills
 * cannot be ATS-scored and is fixed from the position header) and RMG's approvals strip
 * (`mode="approve"` → `POST …/engineering-approve`).
 *
 * Layout: hero (position · status · where the JD goes) → three numbered steps — the JD
 * (file drop zone FIRST, the text is read out of it; then the text box), the skills TA
 * sources against (cards, mandatory toggle, required level), the requirement description
 * (optional) — beside a sticky readiness card that says what the ATS / AI interview will
 * have to work with, and a footer that names what is still missing.
 *
 * Who may save is the server's JD_EDIT_ROLES (RMG · Sales · Sales Head · TA, Admin/CEO
 * implicit; a GM comes through the requirements Edit grant) — the same list for the
 * text, the skills and the file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, CheckCircle2, ClipboardCheck, FileText, ScanLine, Sparkles,
  UploadCloud, Users, X, type LucideIcon,
} from "lucide-react";

import { crmDelete, crmGet, crmPatch, crmPost, crmUpload } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { DialogActions, DialogFailure, DialogHero, DialogSection, WhatHappens, useCtrlEnter, type DialogTone } from "./dialogKit";
import { FileLink } from "./FileUpload";
import { SkillListEditor, mergeSkillRows, newSkillKey, type SkillMaster, type SkillRow } from "./SkillListEditor";
import { Modal, focusRing, inputCls } from "./ui";
import { TaPicker, fetchTaAssignments, type TaOption } from "./PositionTeamPanel";

/** A JD file on the requirement (`kind: "rmg_jd"`). */
export type JdFile = { id: number; file_url: string; file_name: string | null; kind?: string | null };
const JD_FILE_ACCEPT = ".pdf,.doc,.docx,.txt";
const JD_FILE_MAX_MB = 15;
/** Below this the JD text is too thin for the ATS keyword pass to mean much. */
const JD_THIN_CHARS = 120;

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

/** The slice of a requirement the dialog reads — the desk's position header carries it. */
export type JdSkillsReq = {
  id: number;
  title: string;
  req_number?: string | null;
  opportunity_opp_id?: string | null;
  status: string;
  description?: string | null;
  rmg_jd_text?: string | null;
  skills?: { skill_id: number; is_mandatory: boolean; min_rating: number | null }[] | null;
};

/** The requirement's skills as editor rows — a skill stored twice is merged once. */
function initialRows(req: JdSkillsReq): SkillRow[] {
  return mergeSkillRows((req.skills || []).map((s) => ({
    key: newSkillKey(),
    skill_id: String(s.skill_id),
    is_mandatory: s.is_mandatory,
    min_rating: s.min_rating != null ? String(s.min_rating) : "",
  })));
}
/** What a save compares and sends — the rows without their UI keys. */
const rowsSignature = (rows: SkillRow[]) =>
  JSON.stringify(rows.map((r) => [r.skill_id, r.is_mandatory, r.min_rating]));

/** PURE — the readiness the right-hand card and the footer both print. */
export function jdReadiness(jdText: string, hasFile: boolean, skills: { skill_id: string; is_mandatory: boolean }[]) {
  const chars = jdText.trim().length;
  const mandatory = skills.filter((s) => s.skill_id && s.is_mandatory).length;
  const picked = skills.filter((s) => s.skill_id).length;
  const missing: string[] = [];
  if (!chars && !hasFile) missing.push("the JD");
  if (picked === 0) missing.push("at least one skill");
  return { chars, thin: chars > 0 && chars < JD_THIN_CHARS, hasFile, picked, mandatory, missing };
}

export function JdSkillsModal({
  req, onClose, onSaved, toast, mode = "edit", hasJdFile = false,
}: {
  req: JdSkillsReq;
  onClose: () => void;
  onSaved: (updated: any) => void;
  toast: ToastFn;
  /** "approve" (28 Sep 2026, Screening Desk): the same JD + skills form, but the
   *  save is RMG's approval — `POST …/engineering-approve` with the JD, the
   *  skills and a comment — so a position is approved without leaving the desk. */
  mode?: "edit" | "approve";
  /** Approve mode: a JD file already on the requirement satisfies the JD rule. */
  hasJdFile?: boolean;
}) {
  const approve = mode === "approve";
  const tone: DialogTone = approve ? "emerald" : "indigo";
  /* The JD as a file (30 Sep 2026, user ask): PDF / Word dropped here is
     attached as the RMG JD; the server reads its text and fills a blank JD
     text field with it — the ATS and the AI interview score against the TEXT.
     The list is fetched fresh, so a file added on the requirement page shows. */
  const [jdFiles, setJdFiles] = useState<JdFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [readFrom, setReadFrom] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    crmGet<JdFile[]>(`/api/requirements/${req.id}/attachments`)
      .then((r) => { if (!cancelled) setJdFiles((r.data || []).filter((a) => (a.kind || "rmg_jd") === "rmg_jd")); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [req.id]);

  const [comment, setComment] = useState("");
  const [description, setDescription] = useState(req.description || "");
  const [rmgJdText, setRmgJdText] = useState(req.rmg_jd_text || "");
  const [skillOpts, setSkillOpts] = useState<SkillMaster[]>([]);
  const [skillRows, setSkillRows] = useState<SkillRow[]>(() => initialRows(req));
  const initialSignature = useMemo(() => rowsSignature(initialRows(req)), [req]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* Approve mode (1 Oct 2026, user ask): the sourcing team is picked in the
     same click as the approval — `ta_user_ids` on `engineering-approve`. The
     options come from the team endpoint (a writer gets them). */
  const [taOptions, setTaOptions] = useState<TaOption[]>([]);
  const [taPicked, setTaPicked] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (!approve) return;
    let cancelled = false;
    fetchTaAssignments(req.id)
      .then((r) => {
        if (cancelled) return;
        setTaOptions(r.options);
        setTaPicked(new Set(r.assignments.map((a) => a.user_id)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [approve, req.id]);
  const toggleTa = (id: number) => setTaPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const uploadJd = async (file: File) => {
    setErr("");
    if (!/\.(pdf|docx?|txt)$/i.test(file.name)) { setErr("Upload the JD as a PDF, Word or text file."); return; }
    if (file.size > JD_FILE_MAX_MB * 1024 * 1024) { setErr(`The file is larger than ${JD_FILE_MAX_MB} MB.`); return; }
    setUploading(true);
    try {
      const res = await crmUpload<JdFile & { extracted_text?: string | null; jd_text_filled?: boolean }>(
        `/api/requirements/${req.id}/attachments`, file, { kind: "rmg_jd" });
      const added = res.data;
      setJdFiles((fs) => [added, ...fs]);
      const text = (added?.extracted_text || "").trim();
      if (text && !rmgJdText.trim()) {
        setRmgJdText(text);
        setReadFrom(added.file_name || file.name);
        toast(added.jd_text_filled ? "JD text read from the file and saved" : "JD text read from the file — review and save");
      } else if (text) {
        toast("File attached. The JD text already written is kept — paste over it if the file is newer.");
      } else {
        toast("File attached. No text could be read from it (a scan?) — paste the JD text as well.", "err");
      }
      onSaved(null);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const removeJd = async (f: JdFile) => {
    try {
      await crmDelete(`/api/requirements/attachments/${f.id}`);
      setJdFiles((fs) => fs.filter((x) => x.id !== f.id));
      onSaved(null);
    } catch (e: any) {
      setErr(e?.message || "Could not remove the file");
    }
  };
  const jdFileOnRecord = hasJdFile || jdFiles.length > 0;

  useEffect(() => {
    let cancelled = false;
    fetchAllMaster<any>("/api/skills").then((rows) => { if (!cancelled) setSkillOpts(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /** Creates a skill in the master (Enter on a new name in the editor). */
  const createSkill = async (name: string): Promise<SkillMaster | null> => {
    try {
      const res = await crmPost<SkillMaster>("/api/skills", { name });
      const created = res.data;
      if (created?.id == null) return null;
      setSkillOpts((opts) => (opts.some((o) => String(o.id) === String(created.id)) ? opts : [...opts, created]));
      return created;
    } catch (e: any) {
      toast(e?.message || `Could not create the skill "${name}"`, "err");
      return null;
    }
  };

  const dirty =
    description !== (req.description || "") ||
    rmgJdText !== (req.rmg_jd_text || "") ||
    rowsSignature(skillRows) !== initialSignature;

  const ready = jdReadiness(rmgJdText, jdFileOnRecord, skillRows);

  const save = async () => {
    if (busy) return;
    setErr("");
    if (skillRows.some((r) => !r.skill_id)) { setErr("Pick a skill on every row or remove the empty row."); return; }
    if (approve && !rmgJdText.trim() && !jdFileOnRecord) { setErr("Add the JD before approving — TA sources and the ATS scores against it."); return; }
    if (approve && skillRows.length === 0) { setErr("Add at least one skill before approving."); return; }
    setBusy(true);
    try {
      const skills = mergeSkillRows(skillRows).map((r) => ({
        skill_id: Number(r.skill_id),
        is_mandatory: r.is_mandatory,
        min_rating: r.min_rating ? Number(r.min_rating) : null,
      }));
      if (approve) {
        const res = await crmPost<any>(`/api/requirements/${req.id}/engineering-approve`, {
          comment: comment.trim() || undefined,
          rmg_jd_text: rmgJdText,
          skills,
          ...(taOptions.length ? { ta_user_ids: Array.from(taPicked) } : {}),
        });
        toast(res.message || "Position approved — TA can source now");
        onSaved(res.data);
        onClose();
        return;
      }
      const res = await crmPatch<any>(`/api/requirements/${req.id}/jd-skills`, { description, rmg_jd_text: rmgJdText, skills });
      toast("JD & skills updated");
      onSaved(res.data);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  };
  useCtrlEnter(() => void save());

  const title = approve ? "Approve position — confirm the JD & skills" : "Edit JD & skills";
  const positionRef = [req.opportunity_opp_id, req.req_number].filter(Boolean).join(" · ");
  const statusWord = String(req.status || "").replace(/_/g, " ");
  const confirmDisabled = approve ? ready.missing.length > 0 : !dirty;
  const hint = approve
    ? (ready.missing.length ? <span className="text-warning">Still needed: {ready.missing.join(" · ")}</span> : "Ctrl + Enter to approve")
    : (!dirty ? "Nothing changed yet" : ready.missing.length ? <span className="text-warning">Saves, but TA still needs {ready.missing.join(" and ")}</span> : "Ctrl + Enter to save");

  const HeroIcon: LucideIcon = approve ? ClipboardCheck : FileText;

  return (
    <Modal
      title={title}
      xl
      onClose={() => { if (!busy) onClose(); }}
      dirty={dirty || comment.trim().length > 0}
      hero={
        <DialogHero tone={tone} icon={HeroIcon} eyebrow={approve ? "RMG review" : "Position"} title={title}
          subtitle={approve
            ? "Approving opens the position for sourcing — TA sources against these skills and the ATS scores every resume on them."
            : "What is written here is what the ATS scores resumes on and what the AI interview asks about. Budget, positions and status are not editable here."}
          person={{ name: req.title, meta: positionRef || undefined }}
          chips={<span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/20">{statusWord}</span>}
          flow={{ steps: ["JD & skills", "ATS scores resumes", "AI L1 asks on them", "TA sources"], current: 0 }} />
      }
      footer={
        <div className="space-y-2">
          <DialogFailure message={err} />
          <DialogActions tone={tone} icon={approve ? ClipboardCheck : CheckCircle2}
            label={approve ? "Approve position" : "Save changes"} busyLabel={approve ? "Approving…" : "Saving…"}
            busy={busy} disabled={confirmDisabled} onCancel={onClose} onConfirm={() => void save()} hint={hint} />
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <DialogSection n={1} title="The job description" tone={tone} done={ready.chars > 0 || ready.hasFile}
            hint="Drop the customer's JD — the text is read out of the file and lands in the box. Or paste it.">
            <input ref={fileInput} type="file" accept={JD_FILE_ACCEPT} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadJd(f); }} />
            <button type="button" disabled={uploading}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void uploadJd(f); }}
              className={`flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-left transition-colors duration-micro ${focusRing} ${
                dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-subtle bg-surface-2 hover:border-strong"}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow">
                <UploadCloud size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-primary">{uploading ? "Reading the file…" : "Drop the JD file here, or click to choose"}</span>
                <span className="block text-xs text-muted">PDF, Word or text · up to {JD_FILE_MAX_MB} MB · the text is read into the box below</span>
              </span>
            </button>
            {jdFiles.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {jdFiles.map((f) => (
                  <li key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-subtle bg-surface-1 py-1 pl-2.5 pr-1 text-xs">
                    <FileText size={13} className="shrink-0 text-indigo-600" aria-hidden />
                    <span className="min-w-0 truncate"><FileLink url={f.file_url} label={f.file_name || "JD file"} /></span>
                    <button type="button" onClick={() => void removeJd(f)} aria-label={`Remove ${f.file_name || "file"}`}
                      className="rounded-full p-1 text-muted hover:bg-danger-soft hover:text-danger"><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="jd-text" className="text-xs font-semibold text-secondary">JD text (what the ATS and the AI interview read)</label>
                <span className="text-[11px] tabular-nums text-muted">
                  {readFrom ? <span className="mr-2 rounded-full bg-indigo-50 px-2 py-px font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">read from {readFrom}</span> : null}
                  {ready.chars.toLocaleString()} characters
                </span>
              </div>
              <textarea id="jd-text" rows={9}
                className={`${inputCls} !h-auto min-h-[180px] resize-y`}
                value={rmgJdText}
                onChange={(e) => { setRmgJdText(e.target.value); setReadFrom(null); }}
                placeholder="Paste the full JD text — responsibilities, must-have skills, experience, location, shift…"
              />
              {ready.thin && <p className="mt-1 text-xs font-semibold text-warning">That is a very short JD — the ATS keyword match will be thin. Paste the full text if you have it.</p>}
            </div>
          </DialogSection>

          <DialogSection n={2} title="Skills TA sources against" tone={tone} done={ready.picked > 0}
            hint="Mandatory skills drive the ATS score. Set the level the customer expects."
>
            <SkillListEditor rows={skillRows} onChange={setSkillRows} master={skillOpts}
              onCreate={createSkill} jdText={rmgJdText} disabled={busy} />
          </DialogSection>

          <DialogSection n={3} title="Requirement description" tone={tone} optional done={description.trim().length > 0}
            hint="The one-paragraph summary TA reads on the position list — role, team, what matters most.">
            <textarea
              rows={3}
              className={`${inputCls} !h-auto min-h-[72px] resize-y`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the customer needs — role summary, team, must-haves"
            />
          </DialogSection>

          {approve && (
            <DialogSection n={4} title="Who sources it" tone={tone} optional done={taPicked.size > 0}
              hint="Tick the TAs to work this position — they are told the moment you approve. Leave empty to let every TA pick it up.">
              <TaPicker options={taOptions} picked={taPicked} onToggle={toggleTa} />
            </DialogSection>
          )}

          {approve && (
            <DialogSection n={5} title="Note for TA" tone={tone} optional done={comment.trim().length > 0}
              hint="Anything the recruiter should know when sourcing — goes with the approval.">
              <input className={inputCls} value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. Customer wants automotive background; night shift; joining within 30 days" />
            </DialogSection>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">What the ATS will have</p>
            <ul className="space-y-2 text-xs">
              <Check ok={ready.chars > 0} label="JD text" detail={ready.chars ? `${ready.chars.toLocaleString()} characters` : "none yet"} />
              <Check ok={ready.hasFile} label="JD file on record" detail={ready.hasFile ? `${jdFiles.length || 1} file${(jdFiles.length || 1) === 1 ? "" : "s"}` : "optional"} soft />
              <Check ok={ready.picked > 0} label="Skills" detail={ready.picked ? `${ready.picked} picked · ${ready.mandatory} mandatory` : "none yet"} />
            </ul>
          </div>
          <WhatHappens tone={tone} title={approve ? "When you approve" : "Once saved"} items={[
            { icon: ScanLine, text: "Every resume on this position is ATS-scored on the mandatory skills and the JD keywords." },
            { icon: Bot, text: "The AI L1 interview asks questions from this JD." },
            { icon: Users, text: approve
                ? (taPicked.size ? `The position opens for sourcing — the ${taPicked.size} assigned TA(s) are told.` : "The position opens for sourcing — every TA is told.")
                : "Suggested Candidates are matched against these skills." },
            ...(approve ? [{ icon: Sparkles, text: "The approval is logged with your note." }] : []),
          ]} />
        </aside>
      </div>
    </Modal>
  );
}

function Check({ ok, label, detail, soft }: { ok: boolean; label: string; detail: string; soft?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full ${
        ok ? "bg-emerald-600 text-white" : soft ? "bg-surface-2 text-muted" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`} aria-hidden>
        {ok ? <CheckCircle2 size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span className="min-w-0">
        <span className="font-semibold text-primary">{label}</span>
        <span className="text-muted"> · {detail}</span>
      </span>
    </li>
  );
}
