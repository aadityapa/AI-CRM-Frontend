/**
 * Candidate Profiles — the directory.
 *
 * The core review surface: where someone decides who advances. The design
 * question it answers is "who do I look at next, and is this person a yes?",
 * so score and pipeline status carry the visual weight and everything else is
 * supporting evidence.
 *
 * What changed from the previous version, and why:
 *  - Score is a ring + numeral + word rather than one of sixteen equal-weight
 *    text cells, and the table arrives sorted by it.
 *  - Column headers sort in one click. Sorting used to require opening the
 *    customiser modal, choosing a field and a direction, and saving.
 *  - Rows are selectable, with a floating bulk bar.
 *  - Filters live in the URL, so a filtered view is a link.
 *  - Nine default columns instead of sixteen. The other seventeen are one
 *    click away in the customiser, which is unchanged.
 *
 * Everything that worked before still works: all 26 columns, the per-user
 * column layout and multi-level sort, role gates, search, pagination, row
 * actions and the create modal.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";

import { crmGet, qs } from "../../api";
import { authFetch } from "../../../api/client";
import type { Meta } from "../../api";
import { useHasRole } from "../../CrmApp";
import { useCanAct } from "../../useAccess";
import { crmNavigate } from "../../routerHooks";
import { DataTable } from "../../components/DataTable";
import type { Column, ColumnFilterDef, ColumnFilterValue } from "../../components/DataTable";
import { RowActions, afterListDelete } from "../../components/RowActions";
import { TableCustomizerButton, sortToQuery, useTableLayout } from "../../components/TableCustomizer";
import { BulkActionBar } from "../../components/BulkActionBar";
import { FilterChips } from "../../components/FilterChips";
import type { ActiveFilter } from "../../components/FilterChips";
import { ErrorBox, btnPrimary, btnSecondary, statusLabel, useToast } from "../../components/ui";

import { DEFAULT_PROFILE_COLUMNS, buildProfileColumns } from "./profileColumns";
import type { ProfileColumnRow } from "./profileColumns";
import { ProfileCardGrid } from "./ProfileCardGrid";
import { ProfileSummaryStrip } from "./ProfileSummaryStrip";
import { ProfileToolbar } from "./ProfileToolbar";
import type { ViewMode } from "./ProfileToolbar";
import { useProfileFilters } from "./useProfileFilters";

const PAGE_SIZE = 20;

/** Score first — the reviewer's question is "is this a yes?". */
const DEFAULT_SORT = "ai_interview:desc";

type Props = {
  title?: string;
  subtitle?: string;
  /** Formatting helpers owned by Profiles.tsx, passed in to avoid duplication. */
  helpers: Parameters<typeof buildProfileColumns>[0];
  statuses: { active: readonly string[]; rejected: readonly string[] };
  /** Rendered when the create button is pressed; owned by Profiles.tsx. */
  renderCreateModal: (close: () => void, onCreated: (id: number) => void) => React.ReactNode;
};

export function ProfilesListPage({
  title = "Candidate Profiles",
  subtitle = "Candidates in the pipeline, per opportunity.",
  helpers,
  statuses,
  renderCreateModal,
}: Props) {
  const canCreate = useCanAct("profiles", "create", useHasRole("TA", "Sales", "RMG"));
  const [toast, showToast] = useToast();

  const { filters, update, clearAll, isFiltered } = useProfileFilters();
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [rows, setRows] = useState<ProfileColumnRow[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<ViewMode>("table");
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<
    { id: number; opp_id?: string | null; title?: string | null; customer_name?: string | null }[]
  >([]);
  const [taOwners, setTaOwners] = useState<{ id: number; name: string }[]>([]);
  /** Header-funnel filters for columns with NO existing toolbar state
   * (AI score, experience, notice, applied date, submitted-by). Columns that
   * mirror a toolbar filter map onto that state instead — one truth per filter. */
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState("");

  const { layout, setLayout, meta: prefMeta } = useTableLayout("candidate_profiles", DEFAULT_PROFILE_COLUMNS);

  // Debounce typing so a search is one request, not one per keystroke. Written
  // to the URL with replaceState so Back does not step through every letter.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchDraft.trim() !== filters.search) {
        update({ search: searchDraft.trim() }, { replace: true });
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchDraft, filters.search, update]);

  useEffect(() => {
    crmGet<any[]>("/api/opportunities?limit=100")
      .then((r) => setOpportunities(r.data || []))
      .catch(() => {
        /* the filter degrades to "All opportunities" — not worth an error state */
      });
    crmGet<{ id: number; name: string }[]>("/api/candidate-profiles/ta-owners")
      .then((r) => setTaOwners(r.data || []))
      .catch(() => { /* degrades to "All TA owners" */ });
  }, []);

  /** Server-side export of the CURRENT filters, in the chosen format. */
  const runExport = async (fmt: string) => {
    setExporting(fmt);
    setExportOpen(false);
    try {
      const url = `/api/candidate-profiles/export${qs({
        format: fmt,
        bucket: filters.bucket,
        pipeline_status: filters.status || undefined,
        opportunity_id: filters.opportunityId || undefined,
        ta_owner_id: filters.taOwnerId || undefined,
        search: filters.search || undefined,
        ai_min: colFilters.ai_interview?.min || undefined,
        ai_max: colFilters.ai_interview?.max || undefined,
        exp_min: colFilters.experience_years?.min || undefined,
        exp_max: colFilters.experience_years?.max || undefined,
        notice: colFilters.notice_period?.text || undefined,
        applied_from: colFilters.applied_on?.from || undefined,
        applied_to: colFilters.applied_on?.to || undefined,
        submitted_by: colFilters.created_by_name?.text || undefined,
      })}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") || "";
      const m = /filename="([^"]+)"/.exec(dispo);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] || `candidate_profiles.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      showToast(e?.message || "Export failed", "err");
    } finally {
      setExporting("");
    }
  };

  const sortParam = sortToQuery(layout.sort) || DEFAULT_SORT;

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<ProfileColumnRow[]>(
      `/api/candidate-profiles${qs({
        bucket: filters.bucket,
        pipeline_status: filters.status,
        opportunity_id: filters.opportunityId || undefined,
        ta_owner_id: filters.taOwnerId || undefined,
        search: filters.search || undefined,
        ai_min: colFilters.ai_interview?.min || undefined,
        ai_max: colFilters.ai_interview?.max || undefined,
        exp_min: colFilters.experience_years?.min || undefined,
        exp_max: colFilters.experience_years?.max || undefined,
        notice: colFilters.notice_period?.text || undefined,
        applied_from: colFilters.applied_on?.from || undefined,
        applied_to: colFilters.applied_on?.to || undefined,
        submitted_by: colFilters.created_by_name?.text || undefined,
        sort: sortParam,
        page: filters.page,
        limit: PAGE_SIZE,
      })}`,
    )
      .then((r) => {
        setRows(r.data || []);
        setMeta(r.meta);
      })
      .catch((e: any) => setError(e?.message || "Failed to load profiles"))
      .finally(() => setLoading(false));
  }, [filters.bucket, filters.status, filters.opportunityId, filters.taOwnerId, filters.search, filters.page, sortParam, colFilters]);

  useEffect(load, [load]);

  // Selection is per-page and clearing it on navigation avoids acting on rows
  // the reviewer can no longer see.
  useEffect(() => setSelected(new Set()), [filters.bucket, filters.status, filters.opportunityId, filters.taOwnerId, filters.search, filters.page, colFilters]);

  const columns = useMemo(() => buildProfileColumns(helpers), [helpers]);
  const columnByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const columnLabels = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c.label])),
    [columns],
  );

  // The saved layout decides which columns show and in what order. Anything it
  // does not mention keeps its natural place, so a column added in a later
  // release still appears once enabled.
  const visibleColumns: Column<ProfileColumnRow>[] = useMemo(() => {
    const keys = layout.columns.filter((c) => c.visible).map((c) => c.key);
    if (keys.length === 0) return columns;
    return keys.map((k) => columnByKey.get(k)).filter(Boolean) as Column<ProfileColumnRow>[];
  }, [layout.columns, columns, columnByKey]);

  /** Per-column header filters (Aug 2026). Every filter narrows the SERVER
   * query. Columns mirroring a toolbar filter reuse its state so the funnel
   * and the toolbar can never disagree. `interview_round`/`interview_status`
   * are computed per-row during enrichment — no server column, no filter. */
  const columnFilterDefs = useMemo<Record<string, ColumnFilterDef>>(() => ({
    candidate_name: { type: "text", placeholder: "Name, email or phone…" },
    opportunity: {
      type: "select",
      options: opportunities.map((o) => ({
        value: String(o.id),
        label: `${o.opp_id || `#${o.id}`}${o.customer_name ? ` · ${o.customer_name}` : ""}`,
      })),
    },
    ai_interview: { type: "number-range", minLabel: "Min %", maxLabel: "Max %" },
    pipeline_status: {
      type: "select",
      options: (filters.bucket === "active" ? statuses.active : statuses.rejected)
        .map((v) => ({ value: v, label: statusLabel(v) })),
    },
    experience_years: { type: "number-range", step: 0.5 },
    notice_period: { type: "text", placeholder: "e.g. 30, immediate" },
    applied_on: { type: "date-range" },
    ta_owner_name: {
      type: "select",
      options: taOwners.map((o) => ({ value: String(o.id), label: o.name })),
    },
    created_by_name: { type: "text", placeholder: "Submitted by…" },
  }), [opportunities, taOwners, filters.bucket, statuses]);

  const columnsWithFilters = useMemo(
    () => visibleColumns.map((c) =>
      columnFilterDefs[c.key] ? { ...c, filter: columnFilterDefs[c.key] } : c),
    [visibleColumns, columnFilterDefs],
  );

  /** What each funnel currently shows — toolbar-backed keys derive from URL state. */
  const columnFilterValues = useMemo<Record<string, ColumnFilterValue>>(() => ({
    ...colFilters,
    candidate_name: filters.search ? { text: filters.search } : {},
    opportunity: filters.opportunityId && !filters.opportunityId.includes(",")
      ? { value: filters.opportunityId } : {},
    pipeline_status: filters.status && !filters.status.includes(",")
      ? { value: filters.status } : {},
    ta_owner_name: filters.taOwnerId ? { value: filters.taOwnerId } : {},
  }), [colFilters, filters.search, filters.opportunityId, filters.status, filters.taOwnerId]);

  const onColumnFilter = (key: string, v: ColumnFilterValue | null) => {
    switch (key) {
      case "candidate_name": {
        const q = v?.text || "";
        setSearchDraft(q);
        update({ search: q });
        return;
      }
      case "opportunity":
        update({ opportunityId: v?.value || "" });
        return;
      case "pipeline_status":
        update({ status: v?.value || "" });
        return;
      case "ta_owner_name":
        update({ taOwnerId: v?.value || "" });
        return;
      default:
        setColFilters((prev) => {
          const next = { ...prev };
          if (v) next[key] = v;
          else delete next[key];
          return next;
        });
        update({ page: 1 }, { replace: true });
    }
  };

  /** Metric tiles narrow the visible rows client-side; they describe this page. */
  const visibleRows = useMemo(() => {
    if (!activeMetric) return rows;
    if (activeMetric === "awaiting") {
      return rows.filter((r) =>
        ["Technical_Screening", "RMG_Review", "Sales_Screening"].includes(r.pipeline_status));
    }
    if (activeMetric === "advanced") {
      return rows.filter((r) =>
        ["Customer_Screening", "Customer_Interview", "Shortlisted", "Customer_Approval", "Preboarding", "Joined"]
          .includes(r.pipeline_status));
    }
    if (activeMetric === "strong") {
      return rows.filter((r) => (r.ai_overall_score_percent ?? -1) >= 85);
    }
    return rows;
  }, [rows, activeMetric]);

  /** One-click header sort, expressed through the existing multi-level model. */
  const currentSort = layout.sort[0]
    ? { by: layout.sort[0].by, dir: layout.sort[0].dir }
    : { by: "ai_interview", dir: "desc" as const };

  const onSort = (key: string) => {
    const flip = currentSort.by === key && currentSort.dir === "desc" ? "asc" : "desc";
    setLayout({ ...layout, sort: [{ by: key, dir: flip }] });
  };

  const activeFilters: ActiveFilter[] = [];
  if (filters.bucket === "rejected") {
    activeFilters.push({ key: "bucket", label: "Closed", onRemove: () => update({ bucket: "active" }) });
  }
  // One chip per selected status, each removable on its own — a single
  // "3 statuses" chip would force an all-or-nothing reset.
  const selectedStatuses = filters.status ? filters.status.split(",").filter(Boolean) : [];
  for (const s of selectedStatuses) {
    activeFilters.push({
      key: `status:${s}`,
      label: statusLabel(s),
      onRemove: () => update({ status: selectedStatuses.filter((x) => x !== s).join(",") }),
    });
  }
  const selectedOpps = filters.opportunityId ? filters.opportunityId.split(",").filter(Boolean) : [];
  for (const oid of selectedOpps) {
    const opp = opportunities.find((o) => String(o.id) === oid);
    activeFilters.push({
      key: `opp:${oid}`,
      label: opp?.opp_id || `Opportunity #${oid}`,
      onRemove: () => update({ opportunityId: selectedOpps.filter((x) => x !== oid).join(",") }),
    });
  }
  if (filters.taOwnerId) {
    const owner = taOwners.find((o) => String(o.id) === filters.taOwnerId);
    activeFilters.push({
      key: "ta",
      label: `TA: ${owner?.name || `#${filters.taOwnerId}`}`,
      onRemove: () => update({ taOwnerId: "" }),
    });
  }
  const COL_CHIP_LABEL: Record<string, string> = {
    ai_interview: "AI score", experience_years: "Exp (yrs)",
    notice_period: "Notice", applied_on: "Applied", created_by_name: "Submitted by",
  };
  for (const [key, v] of Object.entries(colFilters)) {
    const parts: string[] = [];
    if (v.text) parts.push(`"${v.text}"`);
    if (v.min || v.max) parts.push(`${v.min || "…"}–${v.max || "…"}`);
    if (v.from || v.to) parts.push(`${v.from || "…"} → ${v.to || "…"}`);
    if (!parts.length) continue;
    activeFilters.push({
      key: `col:${key}`,
      label: `${COL_CHIP_LABEL[key] || key}: ${parts.join(" ")}`,
      onRemove: () => setColFilters((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    });
  }
  if (filters.search) {
    activeFilters.push({
      key: "search",
      label: `“${filters.search}”`,
      onRemove: () => { setSearchDraft(""); update({ search: "" }); },
    });
  }

  const sortLabel = columnLabels[currentSort.by] || currentSort.by;
  const emptyMessage = isFiltered
    ? "No candidates match these filters. Try widening the status or opportunity, or clear the filters."
    : filters.bucket === "active"
      ? "No candidates in the pipeline yet. Add one, or wait for applications to arrive."
      : "No closed applications.";

  const openProfile = (r: ProfileColumnRow) => crmNavigate(`profiles/${r.id}`);

  return (
    <div>
      {toast}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display text-xl font-bold text-primary">{title}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {meta?.total != null ? (
              <>
                <span className="tnum font-semibold text-secondary">{meta.total}</span>
                {" "}candidate{meta.total === 1 ? "" : "s"}
                {activeFilters.length > 0 && " matching these filters"}
              </>
            ) : (
              subtitle
            )}
          </p>
        </div>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} aria-hidden /> New profile
          </button>
        )}
      </header>

      <ProfileSummaryStrip
        rows={rows}
        total={meta?.total}
        activeMetric={activeMetric}
        onSelectMetric={setActiveMetric}
      />

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <>
          <DataTable<ProfileColumnRow>
            columns={columnsWithFilters}
            rows={view === "table" ? visibleRows : []}
            meta={meta}
            headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "profile" : "profiles"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
            loading={loading}
            search={searchDraft}
            onSearch={setSearchDraft}
            searchPlaceholder="Name, email or phone…"
            sort={currentSort}
            onSort={onSort}
            onPage={(p) => update({ page: p })}
            onRowClick={openProfile}
            selectable
            selectedIds={selected}
            onSelectionChange={setSelected}
            rowLabel={(r) => r.candidate_name || `Profile ${r.id}`}
            columnFilters={columnFilterValues}
            onColumnFilter={onColumnFilter}
            emptyMessage={emptyMessage}
            filters={
              <div className="flex w-full flex-col gap-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ProfileToolbar
                    bucket={filters.bucket}
                    onBucket={(b) => update({ bucket: b, status: "" })}
                    status={filters.status}
                    onStatus={(s) => update({ status: s })}
                    statusOptions={filters.bucket === "active" ? statuses.active : statuses.rejected}
                    opportunityId={filters.opportunityId}
                    onOpportunity={(id) => update({ opportunityId: id })}
                    opportunities={opportunities}
                    taOwners={taOwners}
                    taOwnerId={filters.taOwnerId}
                    onTaOwner={(id) => update({ taOwnerId: id })}
                    view={view}
                    onView={setView}
                    extra={
                      <>
                      <div className="relative">
                        <button
                          type="button"
                          className={`${btnSecondary} !px-3`}
                          onClick={() => setExportOpen((v) => !v)}
                          disabled={!!exporting}
                          aria-haspopup="menu"
                          aria-expanded={exportOpen}
                        >
                          <Download size={14} /> {exporting ? `Exporting ${exporting.toUpperCase()}…` : "Export"}
                        </button>
                        {exportOpen && (
                          <div
                            className="absolute right-0 z-20 mt-1 w-44 rounded-card border border-subtle bg-surface-1 p-1 shadow-overlay"
                            role="menu"
                          >
                            {(["xlsx", "csv", "tsv", "pdf", "html", "json", "xml"] as const).map((fmt) => (
                              <button
                                key={fmt}
                                role="menuitem"
                                className="block w-full rounded-control px-3 py-1.5 text-left text-sm text-secondary hover:bg-surface-2 hover:text-primary"
                                onClick={() => void runExport(fmt)}
                              >
                                {fmt.toUpperCase()}
                                <span className="ml-2 text-xs text-muted">
                                  {fmt === "xlsx" ? "Excel" : fmt === "pdf" ? "Document" : fmt === "html" ? "Web page" : ""}
                                </span>
                              </button>
                            ))}
                            <div className="mx-2 my-1 border-t border-subtle" />
                            <p className="px-3 pb-1 text-[10px] leading-snug text-muted">
                              Exports the current filters (max 5000 rows).
                            </p>
                          </div>
                        )}
                      </div>
                      <TableCustomizerButton
                        tableKey="candidate_profiles"
                        labels={columnLabels}
                        layout={layout}
                        onChange={setLayout}
                        sortable={prefMeta?.sortable || []}
                        maxSortLevels={prefMeta?.max || 4}
                      />
                      </>
                    }
                  />
                </div>
                <FilterChips
                  filters={activeFilters}
                  onClearAll={() => { setSearchDraft(""); setColFilters({}); clearAll(); }}
                  trailing={<>Sorted by <b className="text-secondary">{sortLabel}</b>, {currentSort.dir === "desc" ? "high to low" : "low to high"}</>}
                />
              </div>
            }
            rowActions={
              canCreate
                ? (r) => (
                    <RowActions
                      entity="candidate profile"
                      itemLabel={r.candidate_name || `Profile #${r.id}`}
                      onView={() => openProfile(r)}
                      onEdit={() => openProfile(r)}
                      deleteUrl={`/api/candidate-profiles/${r.id}`}
                      onDeleted={() => afterListDelete(r.id, setRows, load)}
                      notify={showToast}
                      canEdit
                      canDelete
                    colored />
                  )
                : undefined
            }
          />

          {view === "cards" && (
            <div className="mt-3">
              <ProfileCardGrid
                rows={visibleRows}
                loading={loading}
                emptyMessage={emptyMessage}
                onOpen={openProfile}
                selectedIds={selected}
                onToggleSelect={(id) => {
                  const next = new Set(selected);
                  next.has(id) ? next.delete(id) : next.add(id);
                  setSelected(next);
                }}
                fmtDate={helpers.fmtDate}
              />
            </div>
          )}
        </>
      )}

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        {/* Bulk mutations are deliberately not wired yet — there is no bulk
            endpoint, and firing N sequential requests would be a slow lie.
            Export works today because it is client-side. */}
        <button
          className="rounded-control px-2 py-1 text-sm font-semibold text-secondary transition-colors
                     duration-micro hover:bg-surface-2 hover:text-primary"
          onClick={() => {
            const chosen = rows.filter((r) => selected.has(r.id));
            showToast(`${chosen.length} selected — bulk actions need a server endpoint`, "err");
          }}
        >
          Export selection
        </button>
      </BulkActionBar>

      {showCreate &&
        renderCreateModal(
          () => setShowCreate(false),
          (id) => {
            setShowCreate(false);
            showToast("Candidate profile created");
            crmNavigate(`profiles/${id}`);
          },
        )}
    </div>
  );
}
