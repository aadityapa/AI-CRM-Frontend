import { Search, Users, ChevronRight } from "lucide-react";
import type { Candidate } from "../types";

export function CandidateSidebar({
  candidates,
  searchTerm,
  onSearchTerm,
  selectedId,
  onSelect,
}: {
  candidates: Candidate[];
  searchTerm: string;
  onSearchTerm: (v: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="glass rounded-card shadow-raised overflow-hidden flex flex-col">
      <div className="fx-hairline-b p-4 bg-surface-2">
        <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Candidate Directory</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search candidates..."
            className="input-recessed w-full rounded-control py-2 pl-10 pr-4 text-sm text-primary"
            value={searchTerm}
            onChange={(e) => onSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="max-h-96 flex-1 overflow-y-auto p-2 space-y-1">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            onClick={() => onSelect(candidate.id)}
            className={`w-full text-left p-3 rounded-card flex items-center justify-between transition-colors duration-micro ease-smooth ${
              selectedId === candidate.id ? "nav-pill-gradient text-white" : "row-hover text-secondary"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-8 h-8 rounded-control flex items-center justify-center font-bold text-xs ${
                  selectedId === candidate.id ? "bg-white/20 text-white" : "bg-surface-2 text-secondary"
                }`}
              >
                {candidate.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm leading-tight truncate">{candidate.name}</h3>
                <p className="text-xs uppercase font-bold tracking-tighter opacity-70 truncate">{candidate.role}</p>
              </div>
            </div>
            <ChevronRight className={`w-4 h-4 opacity-40 ${selectedId === candidate.id ? "translate-x-1 opacity-100" : ""}`} />
          </button>
        ))}
        {!candidates.length ? (
          <div className="p-6 text-muted text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> No candidates found.
          </div>
        ) : null}
      </div>
    </div>
  );
}
