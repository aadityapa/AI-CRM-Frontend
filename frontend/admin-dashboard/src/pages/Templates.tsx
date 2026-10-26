/** Interview Templates (redesigned 21 Oct 2026).
 *
 *  One card per template: who it is for (opportunity · customer), how its
 *  questions are made (we write them / AI writes them), how long it runs, its
 *  skills — and Edit / Use in HR Setup / Delete. Search, customer and
 *  question-source filters and a sort sit above the cards; Active / Archive
 *  are pills with counts (a template of a closed deal is archived by the
 *  server and returns by itself when the deal reopens). */
import { useEffect, useMemo, useState } from "react";
import {
  Archive, ArrowUpRight, Bot, Clock, LayoutTemplate, ListChecks, MessagesSquare, Pencil, Plus, RefreshCw, Search,
  Sparkles, Trash2, X,
} from "lucide-react";
import { apiDelete, apiGet } from "../api/client";
import { ConfirmModal, Spinner } from "../crm/components/ui";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../crm/components/PageHeader";
import { onlyActiveNames, useActiveCustomerList } from "../crm/lib/activeCustomers";

type JobConfig = {
  jobId: string;
  jobTitle: string;
  domain?: string;
  opportunityId?: string;
  customerName?: string;
  requiredSkills?: string[];
  optionalSkills?: string[];
  expMin?: number;
  expMax?: number;
  generatedPrompt?: string;
  editedPrompt?: string;
  weights?: Record<string, unknown>;
  numQ?: number;
  timingMode?: "count" | "time" | string;
  timeLimitSec?: number;
  questionType?: string;
  /** 10 Oct 2026: derived from the linked opportunity — closed / rejected / archived deal. */
  archived?: boolean;
  archived_reason?: string | null;
  opportunity_stage?: string | null;
};

type TemplateTab = "active" | "archive";
type Source = "ours" | "ai" | "list" | "bank";
type SortKey = "title" | "customer" | "opportunity" | "skills";

/** PURE: how many questions a template's skill-wise bank holds (0 when off). */
export function skillBankSize(weights: Record<string, unknown> | undefined): number {
  const bank = (weights || {})["skillBank"] as { enabled?: unknown; questions?: unknown[] } | undefined;
  if (!bank || !(bank.enabled === true || String(bank.enabled) === "true")) return 0;
  return Array.isArray(bank.questions) ? bank.questions.length : 0;
}

/** PURE: where a template's questions come from. */
export function questionSource(j: Pick<JobConfig, "weights" | "questionType">): Source {
  if (skillBankSize(j.weights)) return "ours";
  const qt = String(j.questionType || "").toLowerCase();
  if (qt === "manual") return "list";
  if (qt === "question_bank") return "bank";
  return "ai";
}

const SOURCE_LOOK: Record<Source, { label: string; band: string; chip: string; icon: typeof Bot }> = {
  ours: { label: "We write the questions", band: "from-emerald-500 to-teal-600",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800", icon: ListChecks },
  ai: { label: "AI writes the questions", band: "from-indigo-500 to-purple-600",
    chip: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:ring-indigo-800", icon: Bot },
  list: { label: "Fixed question list", band: "from-sky-500 to-blue-600",
    chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-800", icon: ListChecks },
  bank: { label: "Question Bank", band: "from-amber-500 to-orange-600",
    chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800", icon: ListChecks },
};

/** PURE: "20 min" / "8 questions" / "—". */
export function lengthText(j: Pick<JobConfig, "timingMode" | "timeLimitSec" | "numQ" | "weights">): string {
  const bank = skillBankSize(j.weights);
  if (String(j.timingMode || "") === "time" && Number(j.timeLimitSec) > 0) {
    return `${Math.round(Number(j.timeLimitSec) / 60)} min`;
  }
  if (bank) return `${bank} in bank`;
  if (Number(j.numQ) > 0) return `${Number(j.numQ)} questions`;
  return "—";
}

/** PURE: the search / customer / source filters + sort over the loaded list. */
export function filterTemplates(
  jobs: JobConfig[],
  f: { tab: TemplateTab; q: string; customer: string; source: "" | Source; sort: SortKey },
): JobConfig[] {
  const q = f.q.trim().toLowerCase();
  return (jobs || [])
    .filter((j) => (f.tab === "archive" ? !!j.archived : !j.archived))
    .filter((j) => !f.customer || (j.customerName || "") === f.customer)
    .filter((j) => !f.source || questionSource(j) === f.source)
    .filter((j) => !q || [j.jobTitle, j.opportunityId, j.customerName, j.domain, ...(j.requiredSkills || []), ...(j.optionalSkills || [])]
      .some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => {
      if (f.sort === "customer") return String(a.customerName || "~").localeCompare(String(b.customerName || "~"));
      if (f.sort === "opportunity") return String(b.opportunityId || "").localeCompare(String(a.opportunityId || ""));
      if (f.sort === "skills") return (b.requiredSkills?.length || 0) - (a.requiredSkills?.length || 0);
      return String(a.jobTitle || "").localeCompare(String(b.jobTitle || ""));
    });
}

const CONTROL =
  "h-9 rounded-control border border-subtle bg-surface-1 px-2.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand-500/40";

function TemplateCard({ j, onEdit, onDelete, deleting }: {
  j: JobConfig; onEdit: () => void; onDelete: () => void; deleting: boolean;
}) {
  const src = questionSource(j);
  const look = SOURCE_LOOK[src];
  const Icon = look.icon;
  const required = j.requiredSkills || [];
  const optional = j.optionalSkills || [];
  const conv = (j.weights || {})["conversation"] as { followups?: unknown; maxFollowups?: unknown } | undefined;
  const followups = conv && (conv.followups === true || String(conv.followups) === "true") ? Number(conv.maxFollowups || 0) : 0;
  const custom = Boolean(String(j.editedPrompt || "").trim());
  return (
    <article className={`fx-lift flex h-full flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised ${j.archived ? "opacity-80" : ""}`}>
      <div className={`relative bg-gradient-to-r ${look.band} px-4 py-3 text-white`}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
            <Icon className="h-3.5 w-3.5" aria-hidden /> {look.label}
          </span>
          {j.opportunityId ? (
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-[11px] font-semibold">{j.opportunityId}</span>
          ) : null}
        </div>
        <h3 className="mt-2 line-clamp-2 text-base font-bold leading-snug" title={j.jobTitle}>{j.jobTitle || "Untitled"}</h3>
        <p className="mt-0.5 truncate text-xs opacity-90">{j.customerName || "No customer"}{j.domain ? ` · ${j.domain}` : ""}</p>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-control bg-surface-2 px-2 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Experience</div>
            <div className="text-sm font-bold text-primary">{j.expMin ?? 0}–{j.expMax ?? 0} yrs</div>
          </div>
          <div className="rounded-control bg-surface-2 px-2 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Length</div>
            <div className="inline-flex items-center gap-1 text-sm font-bold text-primary">
              <Clock className="h-3 w-3 text-muted" aria-hidden />{lengthText(j)}
            </div>
          </div>
          <div className="rounded-control bg-surface-2 px-2 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Follow-ups</div>
            <div className="inline-flex items-center gap-1 text-sm font-bold text-primary">
              <MessagesSquare className="h-3 w-3 text-muted" aria-hidden />{followups || "Off"}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Must-have skills {required.length ? `(${required.length})` : ""}
          </div>
          <div className="flex flex-wrap gap-1">
            {required.slice(0, 6).map((s) => (
              <span key={s} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:ring-brand-800">{s}</span>
            ))}
            {required.length > 6 ? <span className="px-1 text-[11px] text-muted">+{required.length - 6} more</span> : null}
            {!required.length ? <span className="text-xs text-muted">None set</span> : null}
          </div>
          {optional.length ? (
            <div className="mt-1.5 truncate text-[11px] text-muted" title={optional.join(", ")}>
              Nice to have: {optional.slice(0, 5).join(", ")}{optional.length > 5 ? ` +${optional.length - 5}` : ""}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.chip}`}>
            {src === "ours" ? `${skillBankSize(j.weights)} questions written` : look.label}
          </span>
          {custom ? (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:ring-purple-800">Custom prompt</span>
          ) : null}
          {(j.weights || {})["adaptiveNextQuestion"] ? (
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">Adaptive</span>
          ) : null}
          {j.archived ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle" title={j.archived_reason || ""}>
              <Archive className="h-3 w-3" aria-hidden /> Archived
            </span>
          ) : null}
        </div>
        {j.archived && j.archived_reason ? (
          <p className="rounded-control bg-surface-2 px-2.5 py-1.5 text-xs text-secondary">{j.archived_reason} — reopen the opportunity to use this template.</p>
        ) : null}

        <div className="mt-auto flex items-center gap-2 border-t border-subtle pt-3">
          <button type="button" onClick={onEdit}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control bg-gradient-to-r from-brand-600 to-indigo-600 px-3 text-sm font-semibold text-[#fff] hover:opacity-90">
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </button>
          {!j.archived ? (
            <a href="/?focus=template" target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-control border border-subtle px-3 text-sm font-semibold text-secondary hover:bg-surface-2">
              HR Setup <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
          <button type="button" onClick={onDelete} disabled={deleting} title="Delete template" aria-label="Delete template"
            className="flex h-9 w-9 items-center justify-center rounded-control border border-subtle text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-60">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="truncate font-mono text-[10px] text-muted" title={j.jobId}>ID {j.jobId}</div>
      </div>
    </article>
  );
}

export function TemplatesPage({
  onCreateTemplate,
  onEditTemplate,
}: {
  onCreateTemplate: () => void;
  onEditTemplate: (jobId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [deletingId, setDeletingId] = useState<string>("");
  const [confirm, setConfirm] = useState<JobConfig | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [tab, setTab] = useState<TemplateTab>("active");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [source, setSource] = useState<"" | Source>("");
  const [sort, setSort] = useState<SortKey>("title");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiGet<{ jobs: JobConfig[] }>("/job/configs", { force: true });
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const archivedCount = useMemo(() => (jobs || []).filter((j) => j.archived).length, [jobs]);
  const activeJobs = useMemo(() => (jobs || []).filter((j) => !j.archived), [jobs]);
  const activeCustomers = useActiveCustomerList();   // the dropdown lists ACTIVE customers (23 Oct 2026)
  const customers = useMemo(
    () => onlyActiveNames(
      Array.from(new Set((jobs || []).map((j) => j.customerName || "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
      activeCustomers, customer),
    [jobs, activeCustomers, customer],
  );
  const shown = useMemo(() => filterTemplates(jobs, { tab, q, customer, source, sort }), [jobs, tab, q, customer, source, sort]);
  const ours = activeJobs.filter((j) => questionSource(j) === "ours").length;
  const filtersOn = [q, customer, source].filter(Boolean).length;

  const doDelete = async () => {
    if (!confirm) return;
    try {
      setDeletingId(confirm.jobId);
      setDeleteError("");
      await apiDelete<{ status: string; jobId: string }>(`/job/config/${encodeURIComponent(confirm.jobId)}`);
      setConfirm(null);
      await load();
    } catch (e: any) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={LayoutTemplate}
        accent="violet"
        eyebrow="Interview Platform"
        title="Interview templates"
        subtitle="One template per position: its skills, how the questions are made and how long the AI interview runs."
        stats={[
          { label: "active", value: loading ? "…" : activeJobs.length },
          { label: "we write the questions", value: loading ? "…" : ours },
          { label: "archived", value: loading ? "…" : archivedCount },
        ]}
        actions={
          <>
            <button type="button" onClick={() => void load()} className={HERO_BTN} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Refresh
            </button>
            <button type="button" onClick={onCreateTemplate} className={HERO_BTN_SOLID}>
              <Plus className="h-4 w-4" aria-hidden /> Create template
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-control border border-subtle bg-surface-2 p-1" role="tablist" aria-label="Templates">
            {([["active", "Active", activeJobs.length], ["archive", "Archive", archivedCount]] as [TemplateTab, string, number][]).map(([key, label, count]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-sm font-semibold transition-colors ${
                  tab === key ? "bg-surface-1 text-primary shadow-raised" : "text-secondary hover:text-primary"}`}>
                {key === "archive" ? <Archive className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                {label}
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-bold text-secondary ring-1 ring-inset ring-subtle">{count}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates"
              placeholder="Title, opportunity, customer or skill…" className={`${CONTROL} w-72 pl-8`} />
          </div>
          <select className={`${CONTROL} w-52`} value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer">
            <option value="">All customers</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={`${CONTROL} w-52`} value={source} onChange={(e) => setSource(e.target.value as "" | Source)} aria-label="Question source">
            <option value="">Any question source</option>
            <option value="ours">We write the questions</option>
            <option value="ai">AI writes the questions</option>
            <option value="list">Fixed question list</option>
            <option value="bank">Question Bank</option>
          </select>
          <select className={`${CONTROL} w-44`} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="title">Title A–Z</option>
            <option value="customer">Customer</option>
            <option value="opportunity">Newest opportunity</option>
            <option value="skills">Most skills</option>
          </select>
          {filtersOn ? (
            <button type="button" onClick={() => { setQ(""); setCustomer(""); setSource(""); }}
              className="inline-flex items-center gap-1 rounded-full border border-subtle px-2.5 py-1 text-xs font-semibold text-secondary hover:bg-surface-2">
              <X className="h-3.5 w-3.5" aria-hidden /> Clear {filtersOn}
            </button>
          ) : null}
          <span className="ml-auto text-xs text-muted">{loading ? "" : `${shown.length} shown`}</span>
        </div>
        {tab === "archive" ? (
          <p className="mt-2 text-xs text-muted">
            Templates of opportunities that are closed, rejected or archived. They cannot be used for a new AI interview and
            return to Active by themselves when Sales reopens the opportunity.
          </p>
        ) : null}
      </PageHeader>

      {error ? (
        <div role="alert" className="rounded-card border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          <span className="font-bold">Templates could not load:</span> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-card border border-subtle bg-surface-1 p-8"><Spinner label="Loading templates…" /></div>
      ) : !shown.length ? (
        <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-purple-600 text-white">
            <LayoutTemplate className="h-6 w-6" aria-hidden />
          </div>
          <p className="mt-3 text-base font-bold text-primary">
            {filtersOn ? "No template matches these filters" : tab === "archive" ? "No archived templates" : "No templates yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtersOn ? "Clear a filter to see more." : tab === "archive"
              ? "Every template's opportunity is still open."
              : "Create a template for a position — RMG / GM choose it when they schedule the AI L1."}
          </p>
          {!filtersOn && tab === "active" ? (
            <button type="button" onClick={onCreateTemplate}
              className="mt-4 inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-brand-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff]">
              <Plus className="h-4 w-4" aria-hidden /> Create template
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((j) => (
            <TemplateCard key={j.jobId} j={j} onEdit={() => onEditTemplate(j.jobId)}
              onDelete={() => { setDeleteError(""); setConfirm(j); }} deleting={deletingId === j.jobId} />
          ))}
        </div>
      )}

      {confirm ? (
        <ConfirmModal
          title="Delete this template?"
          message={<>“{confirm.jobTitle || confirm.jobId}” is removed for good. Interviews already taken on it keep their reports.</>}
          confirmLabel="Delete template"
          danger
          busy={deletingId === confirm.jobId}
          error={deleteError || undefined}
          onConfirm={() => void doDelete()}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}
