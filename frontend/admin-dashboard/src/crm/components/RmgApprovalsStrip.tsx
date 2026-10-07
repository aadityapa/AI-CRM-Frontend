/**
 * RmgApprovalsStrip (28 Sep 2026) — the positions waiting for RMG's approval,
 * on the Screening Desk. The server sends the list ONLY to a caller whose
 * `user_may(requirement.engineering_approve)` is true (meta.approvals), so
 * the strip never shows a button the click would 403.
 *
 * Approve = the JD & skills dialog in "approve" mode (POST …/engineering-approve
 * with the JD text, the skills and a note); Reject = a reason (≥ 10 chars) to
 * POST …/engineering-reject. Both are the requirement page's own endpoints.
 */
import { useState } from "react";
import { ChevronRight, ClipboardList, ExternalLink } from "lucide-react";

import { crmGet, crmPost } from "../api";
import { fmtDateShort } from "../../lib/datetime";
import { CrmLink } from "../routerHooks";
import { JdSkillsModal, type JdSkillsReq } from "./JdSkillsModal";
import { STATE_CHIP } from "./controlTower";
import { Field, Modal, btnDanger, btnPrimary, btnSecondary, inputCls } from "./ui";

export type ApprovalItem = {
  requirement_id: number; req_number: string; title: string; positions: number;
  opportunity_id: number; opp_id: string; opportunity_title: string;
  customer_id: number | null; customer_name: string | null; created_at: string | null;
  description: string | null; rmg_jd_text: string | null; has_jd_file: boolean;
  skills: { skill_id: number; skill_name: string | null; is_mandatory: boolean; min_rating: number | null }[];
  exp_min: number | null; exp_max: number | null;
};

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

export function RmgApprovalsStrip({ items, onChanged, showToast }: {
  items: ApprovalItem[];
  onChanged: () => void;
  showToast: ToastFn;
}) {
  const [open, setOpen] = useState(true);
  const [approving, setApproving] = useState<ApprovalItem | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalItem | null>(null);
  if (!items.length) return null;
  return (
    <section className="rounded-card border border-warning/40 bg-surface-1 shadow-raised" aria-label="Positions waiting for RMG approval">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <ChevronRight size={15} className={`text-muted transition-transform duration-micro ${open ? "rotate-90" : ""}`} aria-hidden />
          <ClipboardList size={15} className="text-warning" /> {items.length} position{items.length === 1 ? "" : "s"} waiting for your RMG approval
        </span>
        <span className="text-xs text-muted">TA cannot source until you approve the JD &amp; skills</span>
      </button>
      {open && (
        <ul className="divide-y divide-subtle border-t border-subtle">
          {items.map((it) => {
            const jdOk = !!(it.rmg_jd_text || "").trim() || it.has_jd_file;
            return (
              <li key={it.requirement_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-primary">{it.title}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{it.positions} position{it.positions === 1 ? "" : "s"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${jdOk ? STATE_CHIP.ok : STATE_CHIP.warn}`}>{jdOk ? "JD ready" : "JD missing"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${it.skills.length ? STATE_CHIP.ok : STATE_CHIP.warn}`}>
                      {it.skills.length ? `${it.skills.length} skill${it.skills.length === 1 ? "" : "s"}` : "No skills"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {it.customer_name || "—"} · {it.opp_id} · {it.opportunity_title} · raised {fmtDateShort(it.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" className={`${btnPrimary} !py-1 text-xs`} onClick={() => setApproving(it)}>Review &amp; approve</button>
                  <button type="button" className={`${btnDanger} !py-1 text-xs`} onClick={() => setRejecting(it)}>Reject</button>
                  <CrmLink to={`requirements/${it.requirement_id}`} className="text-muted hover:text-brand-600" title="Open the position"><ExternalLink size={14} /></CrmLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {approving && (
        <JdSkillsModal
          mode="approve"
          hasJdFile={approving.has_jd_file}
          req={{
            id: approving.requirement_id, title: approving.title, req_number: approving.req_number,
            opportunity_opp_id: approving.opp_id, status: "Pending_Engineering_Review",
            description: approving.description, rmg_jd_text: approving.rmg_jd_text, skills: approving.skills,
          }}
          onClose={() => setApproving(null)}
          onSaved={() => onChanged()}
          toast={showToast}
        />
      )}
      {rejecting && (
        <RejectPositionModal item={rejecting} onClose={() => setRejecting(null)} onDone={(m) => { setRejecting(null); showToast(m); onChanged(); }} showToast={showToast} />
      )}
    </section>
  );
}

/**
 * Approve / Reject a position from ANY list row (7 Oct 2026, user ask: "RMG / GM can
 * approve 98 / 99 right from the Opportunities list, no need to go to the Screening
 * Desk"). Same two dialogs and endpoints as the strip above; the position is read
 * (`GET /api/requirements/{id}`) only when Approve is clicked. The caller shows it
 * only to `useCanApprove("requirement.engineering_approve")` on a row whose
 * requirement awaits RMG review — the server refuses anyone else anyway.
 */
export function RmgApproveRowButtons({ requirementId, title, oppId, onChanged, showToast, compact = true }: {
  requirementId: number;
  title: string;
  oppId?: string | null;
  onChanged: () => void;
  showToast: ToastFn;
  compact?: boolean;
}) {
  const [approving, setApproving] = useState<(JdSkillsReq & { hasJdFile: boolean }) | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const openApprove = async () => {
    setLoading(true);
    try {
      const res = await crmGet<any>(`/api/requirements/${requirementId}`);
      const r = res.data || {};
      setApproving({
        id: requirementId, title: r.title || title, req_number: r.req_number,
        opportunity_opp_id: r.opportunity_opp_id || oppId, status: r.status || "Pending_Engineering_Review",
        description: r.description, rmg_jd_text: r.rmg_jd_text, skills: r.skills || [],
        hasJdFile: Array.isArray(r.rmg_jd_attachments) && r.rmg_jd_attachments.length > 0,
      });
    } catch (e: any) {
      showToast(e?.message || "Could not open the position", "err");
    } finally {
      setLoading(false);
    }
  };
  const size = compact ? "!px-2 !py-1 text-[11px]" : "!py-1 text-xs";
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`${btnPrimary} ${size}`} onClick={() => void openApprove()} disabled={loading}
        title="Review the JD & skills and approve the position for sourcing">
        {loading ? "Opening…" : "RMG approve"}
      </button>
      <button type="button" className={`${btnDanger} ${size}`} onClick={() => setRejecting(true)}
        title="Send the position back to Sales with a reason">Reject</button>
      {approving && (
        <JdSkillsModal mode="approve" hasJdFile={approving.hasJdFile} req={approving}
          onClose={() => setApproving(null)} onSaved={() => { setApproving(null); onChanged(); }} toast={showToast} />
      )}
      {rejecting && (
        <RejectPositionModal item={{ requirement_id: requirementId, title, opp_id: oppId || "" }}
          onClose={() => setRejecting(false)}
          onDone={(m) => { setRejecting(false); showToast(m); onChanged(); }} showToast={showToast} />
      )}
    </span>
  );
}

function RejectPositionModal({ item, onClose, onDone, showToast }: {
  item: Pick<ApprovalItem, "requirement_id" | "title" | "opp_id">;
  onClose: () => void; onDone: (msg: string) => void; showToast: ToastFn;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 10) { setErr("Give a reason of at least 10 characters — Sales reads it"); return; }
    setBusy(true);
    try {
      const res = await crmPost(`/api/requirements/${item.requirement_id}/engineering-reject`, { reason: reason.trim() });
      onDone(res.message || "Position sent back to Sales");
    } catch (e: any) {
      showToast(e?.message || "Could not reject", "err");
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reject ${item.title}`} onClose={() => { if (!busy) onClose(); }} dirty={reason.trim().length > 0}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">Sales ({item.opp_id}) is told and can fix and resubmit the position.</p>
        <Field label="Reason" required error={err}>
          <textarea className={`${inputCls}${err ? " input-error" : ""}`} rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} placeholder="What is missing or wrong with this position?" />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={btnDanger} onClick={() => void submit()} disabled={busy}>{busy ? "Sending…" : "Reject position"}</button>
        </div>
      </div>
    </Modal>
  );
}
