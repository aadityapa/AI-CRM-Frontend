/** Shared Edit + Delete icon actions for CRM DataTable rows.
 * Delete opens ConfirmModal; on confirm calls crmDelete then onDeleted.
 * Clicks stopPropagation so they never trigger DataTable onRowClick.
 * After a dependency 409, Delete stays disabled (Close to dismiss);
 * optional onDeactivate exposes a secondary action when hard-delete is blocked. */
import React, { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { crmDelete } from "../api";
import { ConfirmModal, focusRing } from "./ui";

const iconBtn =
  `inline-flex items-center justify-center rounded-control p-1.5 text-muted ` +
  `transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary ` +
  `disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

export type NotifyFn = (msg: string, kind?: "ok" | "err") => void;

export function RowActions({
  entity,
  itemLabel,
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
  onEdit?: () => void;
  /** Absolute CRM path, e.g. `/api/projects/12`. */
  deleteUrl: string;
  onDeleted: () => void;
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

  if (!canEdit && !canDelete) return null;

  const doDelete = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await crmDelete(deleteUrl);
      notify(res.message || deleteSuccessMessage || `${entity[0].toUpperCase()}${entity.slice(1)} deleted`);
      setConfirming(false);
      onDeleted();
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
      onDeleted();
    } catch (e: any) {
      const msg = e?.message || `Failed to deactivate ${entity}`;
      setDeleteError(msg);
      notify(msg, "err");
    } finally {
      setSecondaryBusy(false);
    }
  };

  return (
    <>
      <span
        className="inline-flex justify-end gap-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
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
      </span>
      {confirming && (
        <ConfirmModal
          title={`Delete ${entity}?`}
          message={
            itemLabel
              ? <>Are you sure you want to delete <b>{itemLabel}</b>? This cannot be undone.</>
              : "Are you sure you want to delete this? This cannot be undone."
          }
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
    </>
  );
}
