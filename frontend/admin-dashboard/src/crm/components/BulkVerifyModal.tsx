/** Bulk-upload verify wizard (28 Aug 2026, user request): after a ZIP upload
 * the TA steps through each uploaded resume — the FILE on the left, what the
 * tool read on the right — confirms or corrects, then moves to the next.
 *
 * Two kinds of rows:
 *  - applied     → edits go to the CANDIDATE record (PUT /api/candidates/{id})
 *  - held        → possible duplicate, NOT applied. The parsed fields are
 *                  editable too (the parser does misread names — "Key Skills")
 *                  and save to the RESUME row (PUT /api/resumes/{id}), never to
 *                  the matched existing candidate. TA then decides Apply
 *                  anyway / Dismiss right here.
 */
import React, { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { crmGet, crmPost, crmPut } from "../api";
import { Field, Modal, Spinner, btnPrimary, btnSecondary, inputCls } from "./ui";
import { FilePreviewPane } from "./FileUpload";

/** held = bulk upload matched an existing candidate (email/phone) and did NOT
 *  apply — the TA decides Apply anyway / Dismiss right here in the flow. */
export type VerifyQueueItem = { resume_id: number; name: string; held?: boolean };

/** Held-row editable fields → ResumeUpdateIn keys (all stored on the resume). */
const HELD_FIELDS: [label: string, key: string][] = [
  ["Name", "candidate_name"],
  ["Email", "email"],
  ["Phone", "phone"],
  ["Experience", "experience"],
  ["Current company", "current_company"],
  ["Designation", "designation"],
  ["Notice period", "notice_period"],
  ["Current CTC", "current_ctc"],
  ["Expected CTC", "expected_ctc"],
  ["Education", "education"],
  ["Technical domain", "technical_domain"],
  ["Location", "preferred_location"],
  ["LinkedIn", "linkedin_url"],
  ["Certifications", "certifications"],
];

export function BulkVerifyModal({ queue, onClose, notify }: {
  queue: VerifyQueueItem[];
  onClose: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resume, setResume] = useState<any | null>(null);
  const [cand, setCand] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [heldForm, setHeldForm] = useState<Record<string, string>>({});
  const [heldOrig, setHeldOrig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  /* Held rows the TA already resolved (applied or dismissed) this session —
     so Back doesn't re-offer a decision that was already made. */
  const [resolved, setResolved] = useState<Record<number, "applied" | "dismissed">>({});

  const item = queue[idx];
  const isHeld = !!item?.held && !resolved[item.resume_id];

  useEffect(() => {
    if (!item) return;
    let alive = true;
    setLoading(true);
    setError("");
    setResume(null);
    setCand(null);
    crmGet<any>(`/api/resumes/${item.resume_id}/review`)
      .then((r) => {
        if (!alive) return;
        const c = r.data?.candidate;
        const res = r.data?.resume;
        setResume(res || null);
        setCand(c || null);
        const s = (v: any) => (v == null ? "" : String(v));
        setForm({
          first_name: s(c?.first_name),
          last_name: s(c?.last_name),
          email: s(c?.email),
          phone: s(c?.phone),
          experience_years: s(c?.experience_years),
          notice_period: s(c?.notice_period),
          current_ctc: s(c?.current_ctc),
          expected_ctc: s(c?.expected_ctc),
          city: s(c?.city),
          preferred_locations: s(c?.preferred_locations),
          technical_domain: s(c?.technical_domain),
        });
        const d = (res?.application_details || {}) as Record<string, unknown>;
        const held: Record<string, string> = {
          candidate_name: s(res?.candidate_name),
          email: s(res?.email),
          phone: s(res?.phone),
          experience: s(res?.applicant_experience),
        };
        for (const [, key] of HELD_FIELDS) {
          if (!(key in held)) held[key] = s(d[key]);
        }
        held.skills = s(d.skills);
        setHeldForm(held);
        setHeldOrig(held);
      })
      .catch((e: any) => { if (alive) setError(e?.message || "Failed to load this candidate"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [item?.resume_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setHeld = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setHeldForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const advance = () => {
    if (idx + 1 < queue.length) setIdx(idx + 1);
    else { notify("All candidates verified"); onClose(); }
  };

  /** Persist any corrections the TA typed on a HELD row to the resume record
   *  (never to the matched existing candidate). No-op when nothing changed. */
  const saveHeldEdits = async () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(heldForm)) {
      if ((heldForm[k] ?? "") !== (heldOrig[k] ?? "")) changed[k] = heldForm[k].trim();
    }
    if (changed.candidate_name === "") delete changed.candidate_name; // never blank the name
    if (Object.keys(changed).length === 0) return;
    await crmPut(`/api/resumes/${item.resume_id}`, changed);
  };

  /** Held duplicate: apply the EXISTING candidate to this opportunity (no
   *  duplicate record; server fills the existing record's empty fields from
   *  this CV) — or keep the CV without applying. Corrections save first. */
  const decideHeld = async (action: "apply-duplicate" | "dismiss-duplicate") => {
    setSaving(true);
    try {
      await saveHeldEdits();
      await crmPost(`/api/resumes/${item.resume_id}/${action}`);
      setResolved((r) => ({ ...r, [item.resume_id]: action === "apply-duplicate" ? "applied" : "dismissed" }));
      notify(action === "apply-duplicate"
        ? `${heldForm.candidate_name || item.name} applied to this opportunity`
        : `${heldForm.candidate_name || item.name} — CV kept, not applied`);
      advance();
    } catch (e: any) {
      notify(e?.message || "Action failed", "err");
    } finally {
      setSaving(false);
    }
  };

  /** Fresh AI extraction of the stored file (bypasses the parse cache) —
   *  fills EMPTY fields only, never clobbering what the TA already typed. */
  const reparse = async () => {
    setReparsing(true);
    try {
      const res = await crmPost<any>(`/api/resumes/${item.resume_id}/reparse`);
      const r2 = res.data;
      setResume(r2);
      const d2 = (r2?.application_details || {}) as Record<string, unknown>;
      const s = (v: any) => (v == null ? "" : String(v));
      setHeldForm((f) => {
        const next = { ...f };
        const base: Record<string, string> = {
          candidate_name: s(r2?.candidate_name), email: s(r2?.email),
          phone: s(r2?.phone), experience: s(r2?.applicant_experience),
        };
        for (const [, key] of HELD_FIELDS) {
          const v = key in base ? base[key] : s(d2[key]);
          if (!(next[key] || "").trim() && v) next[key] = v;
        }
        if (!(next.skills || "").trim() && s(d2.skills)) next.skills = s(d2.skills);
        return next;
      });
      setForm((f) => {
        const next = { ...f };
        const fill = (k: string, v: string) => { if (!(next[k] || "").trim() && v) next[k] = v; };
        const n = (v: string) => {
          const cleaned = v.replace(/[, ]/g, "");
          return cleaned && !Number.isNaN(Number(cleaned)) ? String(Number(cleaned)) : "";
        };
        fill("notice_period", s(d2.notice_period));
        fill("technical_domain", s(d2.technical_domain));
        fill("city", s(d2.preferred_location));
        fill("preferred_locations", s(d2.preferred_location));
        fill("current_ctc", n(s(d2.current_ctc)));
        fill("expected_ctc", n(s(d2.expected_ctc)));
        return next;
      });
      notify(res.message || "Resume re-read");
    } catch (e: any) {
      notify(e?.message || "Re-read failed", "err");
    } finally {
      setReparsing(false);
    }
  };

  const save = async () => {
    if (!cand) { advance(); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        last_name: form.last_name.trim() || null,
        phone: form.phone.trim() || null,
        experience_years: num(form.experience_years),
        notice_period: form.notice_period.trim() || null,
        current_ctc: num(form.current_ctc),
        expected_ctc: num(form.expected_ctc),
        city: form.city.trim() || null,
        preferred_locations: form.preferred_locations.trim() || null,
        technical_domain: form.technical_domain.trim() || null,
      };
      // Identity fields are never blanked from here — correcting them is
      // fine, deleting them would break dedupe and outreach.
      if (form.first_name.trim()) body.first_name = form.first_name.trim();
      if (form.email.trim()) body.email = form.email.trim();
      await crmPut(`/api/candidates/${cand.id}`, body);
      notify(`${form.first_name.trim() || item.name} verified`);
      advance();
    } catch (e: any) {
      notify(e?.message || "Failed to save", "err");
    } finally {
      setSaving(false);
    }
  };

  const details = (resume?.application_details || {}) as Record<string, unknown>;
  const parsedBits = [
    resume?.applicant_experience ? `Experience: ${resume.applicant_experience}` : null,
    details.current_company ? `Company: ${details.current_company}` : null,
    details.designation ? `Role: ${details.designation}` : null,
    details.notice_period ? `Notice: ${details.notice_period}` : null,
    details.current_ctc ? `CTC: ${details.current_ctc}` : null,
    details.expected_ctc ? `Expected: ${details.expected_ctc}` : null,
    details.education ? `Education: ${details.education}` : null,
    details.preferred_location ? `Location: ${details.preferred_location}` : null,
    details.certifications ? `Certifications: ${details.certifications}` : null,
  ].filter(Boolean) as string[];

  const txt = (label: string, key: string, type: "text" | "number" | "email" = "text") => (
    <Field label={label}>
      <input type={type} className={inputCls} value={form[key] ?? ""} onChange={set(key)} />
    </Field>
  );

  return (
    <Modal
      title={`Verify candidates — ${idx + 1} of ${queue.length}`}
      onClose={onClose}
      xl
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ---- left: the resume itself ---- */}
        <div className="min-w-0">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
            Resume — {isHeld ? heldForm.candidate_name || item.name : item.name}
          </div>
          {resume?.resume_file_url ? (
            <FilePreviewPane url={resume.resume_file_url} title={item.name} />
          ) : loading ? (
            <Spinner label="Loading resume…" />
          ) : (
            <p className="py-8 text-center text-sm text-muted">No resume file for this candidate.</p>
          )}
        </div>

        {/* ---- right: the record the parser created ---- */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">
              {isHeld ? "Details the tool read — correct, then decide" : "Candidate details — confirm or correct"}
            </span>
            <button type="button" className={`${btnSecondary} !px-2 !py-1 text-xs`}
              disabled={reparsing || loading}
              title="Run the AI extraction again on this file and fill any empty fields below"
              onClick={() => void reparse()}>
              {reparsing ? "Reading…" : "Re-read resume (AI)"}
            </button>
          </div>
          {loading ? (
            <Spinner label="Loading details…" />
          ) : error ? (
            <p className="rounded-card bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : isHeld ? (
            /* Possible duplicate: NOT applied yet. Every parsed field is
               editable (misread names happen); edits save to the RESUME row
               when the TA decides — the matched candidate stays untouched
               until Apply anyway. */
            <div className="space-y-3">
              <div className="rounded-card border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning">
                <b>Possible duplicate — not applied.</b> Matches existing candidate{" "}
                <b>{[cand?.first_name, cand?.last_name].filter(Boolean).join(" ") || "?"}</b>
                {cand?.email ? <> · {cand.email}</> : null}.{" "}
                <b>Apply anyway</b> applies that existing candidate (no duplicate record);{" "}
                <b>Dismiss</b> keeps the CV only.
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {HELD_FIELDS.map(([label, key]) => (
                  <Field key={key} label={label}>
                    <input className={inputCls} value={heldForm[key] ?? ""} onChange={setHeld(key)} />
                  </Field>
                ))}
              </div>
              <Field label="Skills (comma-separated)">
                <input className={inputCls} value={heldForm.skills ?? ""} onChange={setHeld("skills")} />
              </Field>
              {details.summary ? (
                <p className="rounded-card border border-subtle bg-surface-2/60 px-3 py-2 text-xs text-secondary">
                  <span className="font-bold text-muted">Profile summary: </span>{String(details.summary)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {parsedBits.length > 0 && (
                <div className="rounded-card border border-subtle bg-surface-2/60 px-3 py-2 text-xs text-secondary">
                  <span className="font-bold text-muted">Parsed from the resume: </span>
                  {parsedBits.join(" · ")}
                </div>
              )}
              {details.summary ? (
                <p className="rounded-card border border-subtle bg-surface-2/60 px-3 py-2 text-xs text-secondary">
                  <span className="font-bold text-muted">Profile summary: </span>{String(details.summary)}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {txt("First name", "first_name")}
                {txt("Last name", "last_name")}
                {txt("Email", "email", "email")}
                {txt("Phone", "phone")}
                {txt("Experience (years)", "experience_years", "number")}
                {txt("Notice period", "notice_period")}
                {txt("Current CTC", "current_ctc", "number")}
                {txt("Expected CTC", "expected_ctc", "number")}
                {txt("City", "city")}
                {txt("Preferred locations", "preferred_locations")}
              </div>
              {txt("Technical domain", "technical_domain")}
              {Array.isArray(cand?.skills) && cand.skills.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-muted">
                    Skills mapped from the resume (edit on the candidate page)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cand.skills.map((s: any) => (
                      <span key={s.skill_id} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- footer ---- */}
      <div className="mt-5 flex items-center gap-2 border-t border-subtle pt-4">
        {idx > 0 && (
          <button className={btnSecondary} disabled={saving} onClick={() => setIdx(idx - 1)}>
            <ChevronLeft size={14} /> Back
          </button>
        )}
        <span className="text-xs text-muted">{idx + 1} of {queue.length}</span>
        <button className={`${btnSecondary} ml-auto`} disabled={saving} onClick={advance}
          title={isHeld ? "Decide later — the amber duplicate badge stays on the Resumes list"
            : "Move on without saving changes to this candidate"}>
          Skip
        </button>
        {isHeld ? (
          <>
            <button className={btnSecondary} disabled={saving || loading}
              title="Keep the CV on file but do NOT apply this person here"
              onClick={() => void decideHeld("dismiss-duplicate")}>
              Dismiss
            </button>
            <button className={btnPrimary} disabled={saving || loading}
              onClick={() => void decideHeld("apply-duplicate")}>
              {saving ? "Working…" : "Apply anyway & Next"}
            </button>
          </>
        ) : (
          <button className={btnPrimary} disabled={saving || loading} onClick={() => void save()}>
            {saving ? "Saving…" : idx + 1 < queue.length ? "Save & Next" : "Save & Finish"}
          </button>
        )}
      </div>
    </Modal>
  );
}
