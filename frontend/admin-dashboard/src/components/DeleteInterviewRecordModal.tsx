import { useEffect } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";

export function DeleteInterviewRecordModal({
  open,
  busy,
  error,
  targetLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error?: string;
  targetLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="delete-interview-record-title">
      <div className="absolute inset-0 bg-backdrop backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-md px-4">
        <div className="overflow-hidden rounded-modal border border-subtle bg-surface-1 shadow-modal">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                <TriangleAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 id="delete-interview-record-title" className="text-lg font-extrabold text-primary">Delete Interview Record</h2>
                <p className="mt-2 text-sm text-secondary">
                  Are you sure you want to permanently delete this interview/report?
                </p>
                {targetLabel ? (
                  <p className="mt-2 truncate text-xs font-bold text-muted">{targetLabel}</p>
                ) : null}
                <p className="mt-3 text-xs font-semibold text-danger">This action cannot be undone.</p>
                {error ? <p className="mt-3 text-xs font-semibold text-danger">{error}</p> : null}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-10 rounded-control border border-subtle bg-surface-1 px-4 text-sm font-semibold text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="inline-flex h-10 items-center gap-2 rounded-control bg-danger-solid px-4 text-sm font-semibold text-white shadow-raised transition-colors duration-micro ease-smooth hover:bg-danger-solid-hover disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
