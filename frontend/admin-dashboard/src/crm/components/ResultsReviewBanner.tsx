/**
 * "Interview done — review the result" (28 Sep 2026; shared 7 Oct 2026 so the
 * Screening Desk AND Opportunity ▸ Applied Candidates print the same banner).
 * Every finished interview on the candidate that no screener has marked
 * reviewed (server `new_results`); Mark reviewed →
 * POST /api/screening-desk/results-reviewed.
 */
import { useState } from "react";
import { Check, ExternalLink, Sparkles } from "lucide-react";

import { crmPost } from "../api";
import { fmtDateTime12 } from "../../lib/datetime";
import { CrmLink } from "../routerHooks";
import { STATE_CHIP } from "./controlTower";
import { btnPrimary } from "./ui";

export type NewResult = {
  key: string; kind: "ai" | "round"; label: string; result: string; score: number | null;
  when: string | null; by: string | null; passed: boolean;
  /** AI L1 only: `/admin/?view=candidateReport&cid=…&iid=…` (server `ai_report_link`). */
  report_link?: string | null;
};

const linkCls = "font-semibold text-brand-600 hover:underline";

export function ResultsReviewBanner({ profileId, results, onReviewed, onError, compact = false }: {
  profileId: number;
  results: NewResult[] | null | undefined;
  onReviewed: (msg: string) => void;
  onError: (msg: string) => void;
  /** A list row: one line with the count + Mark reviewed. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const list = results || [];
  if (!list.length) return null;
  const markReviewed = async () => {
    setBusy(true);
    try {
      const res = await crmPost<{ marked: number }>("/api/screening-desk/results-reviewed", { profile_id: profileId });
      onReviewed(res.message || "Marked reviewed");
    } catch (e: any) {
      onError(e?.message || "Could not mark it reviewed");
    } finally {
      setBusy(false);
    }
  };
  if (compact) {
    const first = list[0];
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-success bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success"
        title={list.map((r) => `${r.label}: ${r.result}${r.score != null ? ` (${Math.round(r.score)}%)` : ""}`).join("\n")}>
        <Sparkles size={11} aria-hidden />
        New result: {first.label} · {first.result}{list.length > 1 ? ` (+${list.length - 1})` : ""}
        <button type="button" className="rounded-full bg-success px-1.5 text-[10px] text-[#fff] hover:opacity-90"
          disabled={busy} onClick={(e) => { e.stopPropagation(); void markReviewed(); }}>
          {busy ? "…" : "Mark reviewed"}
        </button>
      </span>
    );
  }
  return (
    <div className="mt-3 rounded-control border border-success bg-success-soft px-3 py-2.5" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="text-success" aria-hidden />
        <b className="text-sm text-success">Interview done — review the result</b>
        <button type="button" className={`${btnPrimary} ml-auto !py-1 text-xs`} disabled={busy} onClick={() => void markReviewed()}>
          <Check size={13} /> {busy ? "Saving…" : "Mark reviewed"}
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {list.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="font-bold text-primary">{r.label}</span>
            <span className={`rounded-full px-2 py-0.5 font-bold ${r.passed ? STATE_CHIP.ok : STATE_CHIP.bad}`}>
              {r.result}{r.score != null ? ` · ${Math.round(r.score)}%` : ""}
            </span>
            {r.when && <span className="text-muted">{fmtDateTime12(r.when)}</span>}
            {r.by && <span className="text-muted">· {r.by}</span>}
            {r.kind === "ai" && r.report_link ? (
              /* The AI interview's own report (Reports tab), this interview — not the profile. */
              <a href={r.report_link} target="_blank" rel="noopener noreferrer" className={`ml-auto ${linkCls}`}>
                Open report <ExternalLink size={11} className="inline" aria-hidden />
              </a>
            ) : (
              <CrmLink to={`profiles/${profileId}?tab=${r.kind === "ai" ? "ai" : "interviews"}`}
                className={`ml-auto ${linkCls}`}>
                {r.kind === "ai" ? "Open interview" : "Open feedback"} <ExternalLink size={11} className="inline" aria-hidden />
              </CrmLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
