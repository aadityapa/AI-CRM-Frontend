import { memo } from "react";
import { ClipboardList, LayoutTemplate, Search, Users } from "lucide-react";
import type { Session } from "../types";

function SessionSidebarImpl({
  sessions,
  searchTerm,
  onSearchTerm,
  selectedId,
  onSelect,
}: {
  sessions: Session[];
  searchTerm: string;
  onSearchTerm: (v: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="glass rounded-card shadow-raised overflow-hidden flex flex-col">
      <div className="fx-hairline-b p-4 bg-surface-2">
        <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Templates</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search templates..."
            className="input-recessed w-full rounded-control py-2 pl-10 pr-4 text-sm text-primary"
            value={searchTerm}
            onChange={(e) => onSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="max-h-96 flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((session) => {
          const count = Number(session.candidate_count ?? 0);
          const isSelected = selectedId === session.id;
          return (
            <button
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`w-full text-left p-3 rounded-card flex items-center justify-between gap-3 transition-colors duration-micro ease-smooth ${
                isSelected ? "nav-pill-gradient text-white" : "row-hover text-secondary"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={`w-8 h-8 rounded-control flex items-center justify-center text-xs shrink-0 ${
                    isSelected ? "bg-white/20 text-white" : "bg-surface-2 text-brand-500"
                  }`}
                >
                  <LayoutTemplate className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm leading-tight truncate">{session.name}</h3>
                  <p className="text-xs uppercase font-bold tracking-tighter opacity-70 truncate">
                    {session.opportunityId ? `Opp: ${session.opportunityId}` : session.customerName ? session.customerName : `Latest • ${session.date || "—"}`}
                  </p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                  isSelected ? "bg-white/20 text-white" : "bg-brand-50 text-brand-600 dark:bg-brand-900 dark:text-brand-200"
                }`}
                title="Candidates who took this template"
              >
                <Users className="w-3 h-3" />
                {count}
              </span>
            </button>
          );
        })}
        {!sessions.length ? (
          <div className="p-6 text-muted text-sm flex items-center gap-2">
            <ClipboardList className="w-4 h-4" /> No templates found.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const SessionSidebar = memo(SessionSidebarImpl);
