/**
 * AI interview spend (28 Sep 2026) — `GET /api/ai-costs/interviews`, Admin/CEO only.
 * Shapes mirror B-V2 `services/ai_interview_costs.py`; every figure is computed
 * server-side (costs are priced per call at log time), the page only renders.
 */
import { authFetch } from "./client";
import { crmGet, qs } from "../crm/api";

export type Granularity = "day" | "week" | "month" | "quarter" | "fy";
export type CostSort = "cost" | "date" | "date_desc" | "candidate" | "duration" | "tokens";

export interface InterviewCostRow {
  interview_id: string;
  invite_token: string;
  candidate_name: string;
  candidate_email: string;
  template_name: string;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_min: number | null;
  questions_answered: number | null;
  scheduled_by: string | null;
  calls: number;
  failed_calls: number;
  tokens_in: number;
  tokens_out: number;
  tokens: number;
  audio_minutes: number;
  cost_usd: number;
  cost_chat_usd: number;
  cost_tts_usd: number;
  cost_stt_usd: number;
  /** Part of cost_usd that is ESTIMATED (audio before 28 Sep 2026 was not logged). */
  estimated_usd: number;
  cost_inr: number;
  day: string | null;
  first_at: string | null;
  last_at: string | null;
  profile_id: number | null;
  ai_result: string | null;
  ai_score: number | null;
  ta_owner_name: string | null;
  opportunity_id: number | null;
  opp_id: string | null;
  opportunity_title: string | null;
  customer_id: number | null;
  customer_name: string | null;
  /** Labels of the OpenAI models this interview's calls used, costliest first (9 Oct 2026). */
  models?: string[];
}

export interface CostBucket {
  key: string;
  label: string;
  interviews: number;
  cost_usd: number;
  cost_chat_usd: number;
  cost_tts_usd: number;
  cost_stt_usd: number;
  tokens: number;
  audio_minutes: number;
  avg_cost_usd: number;
}

export interface CostGroup {
  id: string | number | null;
  label: string;
  interviews: number;
  cost_usd: number;
  avg_cost_usd: number;
}

export interface InterviewCostReport {
  period: { date_from: string; date_to: string; granularity: Granularity; days: number };
  usd_inr_rate: number;
  summary: {
    interviews: number;
    completed: number;
    cost_usd: number;
    cost_inr: number;
    avg_cost_usd: number;
    avg_cost_inr: number;
    max_cost_usd: number;
    cost_chat_usd: number;
    cost_tts_usd: number;
    cost_stt_usd: number;
    estimated_usd: number;
    estimated_interviews: number;
    calls: number;
    failed_calls: number;
    tokens: number;
    audio_minutes: number;
    avg_duration_min: number | null;
    other_spend_usd: number;
    other_spend_inr: number;
    total_spend_usd: number;
    total_spend_inr: number;
  };
  series: CostBucket[];
  by_kind: { kind: "chat" | "tts" | "stt"; label: string; cost_usd: number }[];
  /** The interviews on screen, split by the OpenAI model that ran the calls. */
  by_model?: { model: string; label: string; calls: number; interviews: number; cost_usd: number; cost_inr: number }[];
  by_customer: CostGroup[];
  by_template: CostGroup[];
  by_ta: CostGroup[];
  other_spend: { cost_usd: number; families: { label: string; calls: number; cost_usd: number }[] };
  top_interviews: InterviewCostRow[];
  options: {
    customers: { id: number; name: string }[];
    ta_owners: string[];
    templates: string[];
    statuses: string[];
    granularities: Granularity[];
  };
  interviews: InterviewCostRow[];
}

export interface InterviewCostQuery {
  date_from?: string;
  date_to?: string;
  granularity?: Granularity;
  search?: string;
  customer_id?: number | "";
  ta?: string;
  status?: string;
  template?: string;
  sort?: CostSort;
  page?: number;
  limit?: number;
}

export async function getInterviewCosts(q: InterviewCostQuery) {
  return crmGet<InterviewCostReport>(`/api/ai-costs/interviews${qs(q as Record<string, string | number | undefined>)}`);
}

/** CSV of the same slice — streamed through authFetch (a bare <a href> carries no bearer). */
export async function downloadInterviewCostsCsv(q: InterviewCostQuery): Promise<void> {
  const { granularity: _g, page: _p, limit: _l, ...rest } = q;
  const res = await authFetch(`/api/ai-costs/interviews/export.csv${qs(rest as Record<string, string | number | undefined>)}`);
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const name = (res.headers.get("Content-Disposition") || "").match(/filename="?([^";]+)"?/)?.[1]
    || "ai-interview-costs.csv";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
