/** Shared Edit + Delete icon actions for CRM DataTable rows.
 * Delete opens ConfirmModal; on confirm calls crmDelete then onDeleted.
 * Clicks stopPropagation so they never trigger DataTable onRowClick.
 * After a dependency 409, Delete stays disabled (Close to dismiss);
 * optional onDeactivate exposes a secondary action when hard-delete is blocked.
 *
 * Callers should update list UI immediately in onDeleted (filter out the row,
 * then soft-refresh) so the item disappears without navigating away. */
import React, { useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { crmDelete } from "../api";
import { ConfirmModal, focusRing } from "./ui";

const iconBtn =
  `inline-flex items-center justify-center rounded-control p-1.5 text-muted ` +
  `transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary ` +
  `disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

export type NotifyFn = (msg: string, kind?: "ok" | "err") => void;

/** Drop a row from list state immediately, then soft-refresh from the server. */
export function afterListDelete<T extends { id?: number | string }>(
  id: number | string,
  setRows: React.Dispatch<React.SetStateAction<T[]>>,
  reload?: () => void | Promise<void>,
): void {
  setRows((prev) => prev.filter((r) => r.id !== id));
  if (reload) void reload();
}

export function RowActions({
  entity,
  itemLabel,
  onView,
  onEdit,
  deleteUrl,
  onDeleted,
  notify,
  canEdit = true,
  canDelete = true,
  deleteSuccessMessage,
  onDeactivate,
  deactivateLabel = "Deactivate",
  deactivateSuccessMessage,
}: {
  /** Human entity name for the confirm title, e.g. "project". */
  entity: string;
  /** Optional display name shown in the confirm message. */
  itemLabel?: string | null;
  /** Opens the record's detail view. Rendered as the first (eye) action. */
  onView?: () => void;
  onEdit?: () => void;
  /** Absolute CRM path, e.g. `/api/projects/12`. */
  deleteUrl: string;
  /** Called after a successful DELETE — update list state immediately here. */
  onDeleted: () => void | Promise<void>;
  notify: NotifyFn;
  canEdit?: boolean;
  canDelete?: boolean;
  deleteSuccessMessage?: string;
  /** When delete is blocked (409), show this secondary action in ConfirmModal. */
  onDeactivate?: () => Promise<void>;
  deactivateLabel?: string;
  deactivateSuccessMessage?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secondaryBusy, setSecondaryBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!canEdit && !canDelete && !onView) return null;

  const article = /^[aeiou]/i.test(entity) ? "an" : "a";
  const confirmMessage = itemLabel
    ? <>Do you want to delete this {entity} (<b>{itemLabel}</b>)? This cannot be undone.</>
    : <>Do you want to delete this {entity}? This cannot be undone.</>;

  const doDelete = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await crmDelete(deleteUrl);
      notify(res.message || deleteSuccessMessage || `${entity[0].toUpperCase()}${entity.slice(1)} deleted`);
      setConfirming(false);
      await Promise.resolve(onDeleted());
    } catch (e: any) {
      const msg = e?.message || `Failed to delete ${entity}`;
      setDeleteError(msg);
      notify(msg, "err");
    } finally {
      setBusy(false);
    }
  };

  const doDeactivate = async () => {
    if (!onDeactivate) return;
    setSecondaryBusy(true);
    try {
      await onDeactivate();
      notify(deactivateSuccessMessage || `${entity[0].toUpperCase()}${entity.slice(1)} deactivated`);
      setConfirming(false);
      setDeleteError(null);
      await Promise.resolve(onDeleted());
    } catch (e: any) {
      const msg = e?.message || `Failed to deactivate ${entity}`;
      setDeleteError(msg);
      notify(msg, "err");
    } finally {
      setSecondaryBusy(false);
    }
  };

  return (
    // A single stopPropagation wrapper around BOTH the icons AND the confirm
    // modal. The modal is portaled, but React events still bubble through the
    // component tree — without this, confirming inside a table whose rows have
    // onRowClick (e.g. Opportunities) bubbles to the row and navigates away
    // instead of deleting.
    <span
      className="inline-flex justify-end gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
        {onView && (
          <button
            type="button"
            className={iconBtn}
            title={`View ${entity}`}
            aria-label={`View ${entity}`}
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
          >
            <Eye size={15} />
          </button>
        )}
        {canEdit && onEdit && (
          <button
            type="button"
            className={iconBtn}
            title={`Edit ${entity}`}
            aria-label={`Edit ${entity}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={15} />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className={`${iconBtn} hover:!text-rose-600`}
            title={`Delete ${entity}`}
            aria-label={`Delete ${entity}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteError(null);
              setConfirming(true);
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      {confirming && (
        <ConfirmModal
          title={`Delete ${article} ${entity}?`}
          message={confirmMessage}
          confirmLabel="Delete"
          danger
          busy={busy}
          secondaryBusy={secondaryBusy}
          error={deleteError}
          secondaryLabel={onDeactivate ? deactivateLabel : undefined}
          onSecondary={onDeactivate ? () => { void doDeactivate(); } : undefined}
          onConfirm={() => { void doDelete(); }}
          onClose={() => {
            if (!busy && !secondaryBusy) {
              setConfirming(false);
              setDeleteError(null);
            }
          }}
        />
      )}
    </span>
  );
}
