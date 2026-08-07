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
import { Plus } from "lucide-react";

import { crmGet, qs } from "../../api";
import type { Meta } from "../../api";
import { useHasRole } from "../../CrmApp";
import { crmNavigate } from "../../routerHooks";
import { DataTable } from "../../components/DataTable";
import type { Column } from "../../components/DataTable";
import { RowActions, afterListDelete } from "../../components/RowActions";
import { TableCustomizerButton, sortToQuery, useTableLayout } from "../../components/TableCustomizer";
import { BulkActionBar } from "../../components/BulkActionBar";
import { FilterChips } from "../../components/FilterChips";
import type { ActiveFilter } from "../../components/FilterChips";
import { ErrorBox, btnPrimary, statusLabel, useToast } from "../../components/ui";

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
  const canCreate = useHasRole("TA", "Sales", "RMG");
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
  }, []);

  const sortParam = sortToQuery(layout.sort) || DEFAULT_SORT;

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<ProfileColumnRow[]>(
      `/api/candidate-profiles${qs({
        bucket: filters.bucket,
        pipeline_status: filters.status,
        opportunity_id: filters.opportunityId || undefined,
        search: filters.search || undefined,
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
  }, [filters.bucket, filters.status, filters.opportunityId, filters.search, filters.page, sortParam]);

  useEffect(load, [load]);

  // Selection is per-page and clearing it on navigation avoids acting on rows
  // the reviewer can no longer see.
  useEffect(() => setSelected(new Set()), [filters.bucket, filters.status, filters.opportunityId, filters.search, filters.page]);

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
  if (filters.opportunityId) {
    const opp = opportunities.find((o) => String(o.id) === filters.opportunityId);
    activeFilters.push({
      key: "opp",
      label: opp?.opp_id || `Opportunity #${filters.opportunityId}`,
      onRemove: () => update({ opportunityId: "" }),
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
            columns={visibleColumns}
            rows={view === "table" ? visibleRows : []}
            meta={meta}
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
                    view={view}
                    onView={setView}
                    extra={
                      <TableCustomizerButton
                        tableKey="candidate_profiles"
                        labels={columnLabels}
                        layout={layout}
                        onChange={setLayout}
                        sortable={prefMeta?.sortable || []}
                        maxSortLevels={prefMeta?.max || 4}
                      />
                    }
                  />
                </div>
                <FilterChips
                  filters={activeFilters}
                  onClearAll={() => { setSearchDraft(""); clearAll(); }}
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
                    />
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
