import { ChevronRight, Search, Users } from "lucide-react";
import type { GroupedReportBucket, ReportSortMode } from "../utils/reportGrouping";

const SORT_OPTIONS: { value: ReportSortMode; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "highestScore", label: "Highest Score" },
  { value: "mostCandidates", label: "Most Candidates" },
  { value: "alphabetical", label: "Alphabetical" },
];

export function ReportGroupSidebar({
  title,
  searchPlaceholder,
  groups,
  searchTerm,
  onSearchTerm,
  sortMode,
  onSortMode,
  selectedId,
  onSelect,
}: {
  title: string;
  searchPlaceholder: string;
  groups: GroupedReportBucket[];
  searchTerm: string;
  onSearchTerm: (v: string) => void;
  sortMode: ReportSortMode;
  onSortMode: (v: ReportSortMode) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="glass rounded-card shadow-raised overflow-hidden flex flex-col">
      <div className="fx-hairline-b p-4 bg-surface-2 space-y-3">
        <h3 className="text-xs font-bold text-muted uppercase tracking-widest">{title}</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            className="input-recessed w-full rounded-control py-2 pl-10 pr-4 text-sm text-primary"
            value={searchTerm}
            onChange={(e) => onSearchTerm(e.target.value)}
          />
        </div>
        <select
          value={sortMode}
          onChange={(e) => onSortMode(e.target.value as ReportSortMode)}
          className="input-recessed w-full rounded-control px-3 py-2 text-sm text-primary"
          aria-label={`Sort ${title}`}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-96 flex-1 overflow-y-auto p-2 space-y-1">
        {groups.map((group) => {
          const isSelected = selectedId === group.id;
          return (
            <button
              key={group.id}
              onClick={() => onSelect(group.id)}
              className={`w-full text-left p-3 rounded-card transition-colors duration-micro ease-smooth ${
                isSelected ? "nav-pill-gradient text-white" : "row-hover text-secondary"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-sm leading-tight truncate">{group.label}</h3>
                  <p className={`text-xs uppercase font-bold tracking-widest mt-1 ${isSelected ? "text-white/80" : "text-muted"}`}>
                    {group.totalInterviews} interviews
                  </p>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 opacity-60 ${isSelected ? "translate-x-1 opacity-100" : ""}`} />
              </div>
              <div className={`mt-2 inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-brand-50 text-brand-600 dark:bg-brand-900 dark:text-brand-200"}`}>
                <Users className="w-3 h-3" />
                {group.totalCandidates}
              </div>
            </button>
          );
        })}
        {!groups.length ? (
          <div className="p-6 text-muted text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> No grouped reports found.
          </div>
        ) : null}
      </div>
    </div>
  );
}
