/**
 * The opportunity's Applicants tab (8 Oct 2026, user ask: "give this page
 * whatever Sales needs — today Sales uses the Candidate Profiles page for the
 * next step; let them do it from here too — and make it colourful").
 *
 * Every row carries the moves THIS login may make (`?with_actions=true` →
 * `allowed_next_statuses` + the pending `offer`, B-V2 `list_profiles`), so the
 * row offers the SAME buttons as the profile page's Next-step bar:
 *
 *   * a stage move (Submit to customer · Customer L1 / L2 · Shortlisted ·
 *     reject …) → the status dialog (`Profiles.TransitionModal`);
 *   * Customer Shortlisted → Submit / Resubmit terms (`SubmitForApprovalModal`);
 *   * Customer Approval, for whoever approves → Approve · Send back · Reject;
 *   * Interviews → the rounds pop-up, where a customer round's feedback is
 *     recorded in place.
 *
 * The server decides every button (`allowed_next_statuses`); nothing is
 * guessed from roles. The dialogs are the ones My Tasks uses
 * (`SalesActionLauncher`), so both screens behave identically.
 */
import { useMemo, useState } from "react";
import { CalendarClock, ClipboardCheck, FileText, Search, UserPlus, Users } from "lucide-react";

import { AiInterviewCell, type AiInterviewFields } from "./AiInterviewCell";
import { CandidateStatusBadge } from "./CandidateStatusBadge";
import { InterviewRoundsModal } from "./InterviewRoundsModal";
import { FLOW_BTN } from "./flowButtons";
import { SalesActionLauncher, SalesItemActions, TermsLine, type SalesAct, type SalesDeskItem } from "./SalesDeskActions";
import type { OfferTerms } from "./OfferApprovalGate";
import { FileLink } from "./FileUpload";
import { CANDIDATE_STAGE_BUCKETS, STAGE_TONE } from "../lib/candidateStageBuckets";
import { CrmLink } from "../router";
import { fmtDateShort, fmtDateTime12 } from "../../lib/datetime";
import type { Meta } from "../api";

export type ApplicantRow = AiInterviewFields & {
  id: number;
  candidate_id: number;
  pipeline_status: string;
  candidate_name?: string | null;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  technical_domain?: string | null;
  cv_url?: string | null;
  current_ctc?: number | null;
  expected_ctc?: number | null;
  hike_percent?: number | null;
  candidate_current_ctc?: number | null;
  candidate_expected_ctc?: number | null;
  created_at?: string | null;
  applied_on?: string | null;
  candidate_status?: any;
  withdrawn_from_status?: string | null;
  next_interview?: { label?: string | null; when?: string | null; round?: string | null } | null;
  allowed_next_statuses?: string[];
  offer?: OfferTerms | null;
  approved_ctc_budget?: number | null;
  ctc_slab_band?: string | null;
  opportunity_opp_id?: string | null;
  opportunity_title?: string | null;
  [k: string]: any;
};

const AVATAR = [
  "from-indigo-500 to-violet-600", "from-sky-500 to-cyan-600", "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600", "from-rose-500 to-pink-600", "from-fuchsia-500 to-purple-600",
];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const lakhs = (v?: number | null) => (v == null ? null : `${(Number(v) / 100_000).toFixed(2).replace(/\.00$/, "")} L`);

/** The desk-item shape the shared Sales dialogs read. PURE. */
export function applicantAsItem(r: ApplicantRow): SalesDeskItem {
  return {
    key: `p${r.id}`, title: r.candidate_name || `Candidate #${r.candidate_id}`, profile_id: r.id,
    path: `profiles/${r.id}`, action: null, current_status: r.pipeline_status,
    allowed: r.allowed_next_statuses || [], offer: r.offer ?? null,
    expected_ctc: r.expected_ctc ?? r.candidate_expected_ctc ?? null,
    current_ctc: r.current_ctc ?? r.candidate_current_ctc ?? null,
    approved_ctc_budget: r.approved_ctc_budget ?? null, ctc_slab_band: r.ctc_slab_band ?? null,
    opportunity_label: [r.opportunity_opp_id, r.opportunity_title].filter(Boolean).join(" · ") || null,
    status_label: r.candidate_status?.label ?? null, chip: r.candidate_status?.label ?? null,
  };
}

/** Which Sales action set a row gets — the same tabs My Tasks uses. PURE. */
export function applicantActionTab(r: ApplicantRow): string | null {
  const allowed = r.allowed_next_statuses || [];
  if (!allowed.length) return null;
  if (r.pipeline_status === "Shortlisted") return "sales_terms";
  if (r.pipeline_status === "Customer_Approval") return "sales_approval";
  return "sales_submit";
}

export function ApplicantsBoard({ rows, meta, search, onSearch, page, onPage, stage, onStage, canApply, onApply, onChanged, toast }: {
  rows: ApplicantRow[];
  meta?: (Meta & { phase_counts?: Record<string, number> }) | null;
  search: string;
  onSearch: (q: string) => void;
  page: number;
  onPage: (p: number) => void;
  stage: string;
  onStage: (key: string) => void;
  canApply: boolean;
  onApply: () => void;
  onChanged: () => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [act, setAct] = useState<SalesAct | null>(null);
  const [rounds, setRounds] = useState<{ profileId: number; name: string } | null>(null);
  const counts = meta?.phase_counts || {};
  const total = useMemo(() => Object.entries(counts).filter(([k]) => k !== "archive")
    .reduce((t, [, n]) => t + (Number(n) || 0), 0), [counts]);
  const pages = Math.max(1, meta?.pages || 1);

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <header className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><Users size={18} aria-hidden /> Applicants
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-sm font-semibold tabular-nums">{meta?.total ?? rows.length}</span>
            </h2>
            <p className="mt-0.5 text-sm text-white/85">Every candidate on this opportunity — move them on, submit the terms, record the customer's feedback, right here.</p>
          </div>
          {canApply && (
            <button type="button" onClick={onApply}
              className="inline-flex items-center gap-1.5 rounded-control bg-[#fff] px-3 py-2 text-sm font-semibold text-[#4338ca] shadow-raised hover:brightness-95">
              <UserPlus size={15} aria-hidden /> Apply a candidate
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b border-subtle bg-surface-2 px-5 py-3" role="tablist" aria-label="Stages">
        {CANDIDATE_STAGE_BUCKETS.map((b) => {
          const on = stage === b.key;
          const n = b.key === "all" ? total : counts[b.key];
          return (
            <button key={b.key} type="button" role="tab" aria-selected={on} onClick={() => onStage(b.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${on
                ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-raised"
                : `${STAGE_TONE[b.key] || STAGE_TONE.all} hover:ring-2 hover:ring-indigo-200`}`}>
              {b.label}
              {n != null && <span className={`rounded-full px-1.5 tabular-nums ${on ? "bg-white/25" : "bg-white/60 dark:bg-black/20"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <span className="sr-only">Search applicants</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, email or phone…"
            className="h-9 w-full rounded-control border border-subtle bg-surface-1 pl-8 pr-3 text-sm text-primary focus:border-indigo-400 focus:outline-none" />
        </label>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {meta ? `${meta.total} applicant${meta.total === 1 ? "" : "s"} · page ${meta.page}/${pages}` : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-muted">
          {search ? "No applicant matches your search." : stage === "all" ? "No candidates have applied to this opportunity yet." : "No applicants in this stage right now."}
        </p>
      ) : (
        <ul className="divide-y divide-subtle border-t border-subtle">
          {rows.map((r, i) => {
            const name = r.candidate_name || `Candidate #${r.candidate_id}`;
            const item = applicantAsItem(r);
            const tab = applicantActionTab(r);
            const cur = lakhs(r.current_ctc ?? r.candidate_current_ctc);
            const exp = lakhs(r.expected_ctc ?? r.candidate_expected_ctc);
            const ni = r.next_interview;
            return (
              <li key={r.id} className="grid gap-3 px-5 py-3 transition-colors hover:bg-surface-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-raised ${AVATAR[i % AVATAR.length]}`} aria-hidden>
                    {initials(name)}
                  </span>
                  <div className="min-w-0">
                    <CrmLink to={`profiles/${r.id}`} className="block truncate text-sm font-bold text-primary hover:text-indigo-700 hover:underline dark:hover:text-indigo-300">{name}</CrmLink>
                    <div className="truncate text-xs text-muted">{[r.email, r.phone].filter(Boolean).join(" · ") || "—"}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.experience_years != null && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{r.experience_years} yrs</span>}
                      {(cur || exp) && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          {cur || "—"} → {exp || "—"}{r.hike_percent != null ? ` · +${Number(r.hike_percent).toFixed(0)}%` : ""}
                        </span>
                      )}
                      {r.notice_period && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Notice {r.notice_period}</span>}
                      {r.cv_url && <span className="inline-flex items-center gap-1 text-[11px]"><FileText size={11} aria-hidden /><FileLink url={r.cv_url} label="Resume" /></span>}
                    </div>
                  </div>
                </div>

                <div className="min-w-0 space-y-1">
                  <CandidateStatusBadge status={r.candidate_status} stage={r.pipeline_status} withdrawnFrom={r.withdrawn_from_status} />
                  {ni?.when && (
                    <div className="flex items-center gap-1 text-[11px] text-secondary">
                      <CalendarClock size={12} aria-hidden /> {ni.label || "Next interview"} · {fmtDateTime12(ni.when, ni.when)}
                    </div>
                  )}
                  <div className="text-[11px] text-muted">Applied {fmtDateShort(r.applied_on || r.created_at || "") || "—"}</div>
                  <AiInterviewCell row={r} />
                </div>

                <div className="min-w-0">
                  {tab === "sales_approval" || (r.pipeline_status === "Customer_Approval" && r.offer) ? <TermsLine offer={r.offer} /> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {tab ? (
                      <SalesItemActions tabKey={tab} item={item} onAct={setAct} />
                    ) : (
                      <CrmLink to={`profiles/${r.id}`} className={FLOW_BTN.view}>Open</CrmLink>
                    )}
                    <button type="button" className={FLOW_BTN.neutral} onClick={() => setRounds({ profileId: r.id, name })}
                      title="Every interview — record the customer's feedback in place">
                      <ClipboardCheck size={13} aria-hidden /> Interviews
                    </button>
                  </div>
                  {!tab && r.pipeline_status === "Customer_Approval" && (
                    <p className="mt-1 text-[11px] text-muted">With the Sales Head for approval.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-subtle px-5 py-2.5 text-xs">
          <button type="button" className={FLOW_BTN.neutral} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <span className="tabular-nums text-muted">{page} / {pages}</span>
          <button type="button" className={FLOW_BTN.neutral} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        </div>
      )}

      {act && (
        <SalesActionLauncher act={act} onClose={() => setAct(null)}
          onDone={(msg) => { setAct(null); toast(msg || "Done"); onChanged(); }} />
      )}
      {rounds && (
        <InterviewRoundsModal profileId={rounds.profileId} candidateName={rounds.name}
          onClose={() => setRounds(null)} onChanged={(msg) => { if (msg) toast(msg); onChanged(); }} />
      )}
    </section>
  );
}
