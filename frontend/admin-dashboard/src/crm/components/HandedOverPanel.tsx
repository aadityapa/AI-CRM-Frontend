/**
 * "Submitted to Sales" — what RMG / GM handed over recently and where each
 * candidate is NOW (29 Sep 2026 report: the "Submit to Sales" task showed
 * nothing right after a submission; the to-do list empties the moment the job
 * is done). ONE read, `GET /api/screening-desk/handed-over` (B-V2
 * `rmg_tasks.recent_handovers`); the status chip is the one every screen prints.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Send, Zap } from "lucide-react";

import { crmGet } from "../api";
import { fmtDateTime12 } from "../../lib/datetime";
import { CrmLink } from "../router";
import { CandidateStatusBadge, type CandidateStatus } from "./CandidateStatusBadge";
import { FLOW_BTN } from "./flowButtons";

type Handover = {
  profile_id: number; candidate_name: string; opportunity_ref: string | null; opportunity_title: string | null;
  submitted_at: string | null; submitted_by: string | null; fast_track: boolean; note: string | null;
  status: CandidateStatus | null; path: string;
};

export function HandedOverPanel({ reloadKey }: { reloadKey?: unknown }) {
  const [rows, setRows] = useState<Handover[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);
  const [openNote, setOpenNote] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    crmGet<Handover[]>("/api/screening-desk/handed-over")
      .then((r) => { if (alive) { setRows(r.data || []); setError(""); } })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load the hand-overs"); });
    return () => { alive = false; };
  }, [reloadKey]);

  return (
    <section className="rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label="Submitted to Sales">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-card bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
            <Send size={15} aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-bold text-primary">Submitted to Sales — last 30 days</span>
            <span className="block text-xs text-muted">
              {rows == null ? "Loading…" : `${rows.length} candidate${rows.length === 1 ? "" : "s"} handed over · where each one is now`}
            </span>
          </span>
        </span>
        {open ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
      </button>
      {open && (
        <div className="border-t border-subtle">
          {error ? (
            <p className="px-4 py-4 text-sm text-danger">{error}</p>
          ) : rows && rows.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">Nobody handed over in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {(rows || []).map((r) => (
                <li key={r.profile_id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
                        <span className="truncate">{r.candidate_name}</span>
                        {r.fast_track && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            <Zap size={11} aria-hidden /> Fast-tracked
                          </span>
                        )}
                        {r.status && <CandidateStatusBadge status={r.status} />}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[[r.opportunity_ref, r.opportunity_title].filter(Boolean).join(" — "),
                          r.submitted_at ? `submitted ${fmtDateTime12(r.submitted_at)}` : "",
                          r.submitted_by ? `by ${r.submitted_by}` : ""].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span className="flex items-center gap-2">
                      {r.note && (
                        <button type="button" className={FLOW_BTN.neutral} aria-expanded={openNote === r.profile_id}
                          onClick={() => setOpenNote(openNote === r.profile_id ? null : r.profile_id)}>
                          Recommendation
                        </button>
                      )}
                      <CrmLink to={r.path} className={FLOW_BTN.view}>Open profile</CrmLink>
                    </span>
                  </div>
                  {openNote === r.profile_id && r.note && (
                    <p className="mt-2 whitespace-pre-wrap rounded-control bg-surface-2 px-3 py-2 text-xs text-secondary">{r.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
