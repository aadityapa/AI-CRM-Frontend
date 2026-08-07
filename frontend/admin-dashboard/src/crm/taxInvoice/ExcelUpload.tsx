import React, { useState } from "react";
import { Download, Upload } from "lucide-react";
import { authFetch } from "../../api/client";
import { btnPrimary, btnSecondary } from "../components/ui";

type Props = {
  onStatus?: (msg: string, kind?: "ok" | "warn" | "err") => void;
};

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export function ExcelUpload({ onStatus }: Props) {
  const [busy, setBusy] = useState(false);

  const downloadTemplate = async () => {
    setBusy(true);
    try {
      const res = await authFetch("/api/invoice/template");
      if (!res.ok) throw new Error(`Template download failed (${res.status})`);
      const blob = await res.blob();
      triggerDownload(blob, "TaxInvoice_Template.xlsx");
      onStatus?.("Template downloaded");
    } catch (e: any) {
      onStatus?.(e?.message || "Template failed", "err");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch("/api/invoice/bulk", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Bulk failed (${res.status})`;
        try {
          const j = await res.json();
          msg = j?.detail || j?.message || msg;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const name = m?.[1] || `Invoices_${new Date().toISOString().slice(0, 10)}.zip`;
      triggerDownload(blob, name);
      onStatus?.(
        "Bulk ZIP downloaded. If any buyer state_code ≠ 27, those invoices use IGST @ 18%.",
        "warn",
      );
    } catch (e: any) {
      onStatus?.(e?.message || "Bulk upload failed", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface-1/40 p-3">
      <button type="button" className={btnSecondary} disabled={busy} onClick={() => void downloadTemplate()}>
        <Download size={15} /> Download template
      </button>
      <label className={`${btnPrimary} cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        <Upload size={15} /> {busy ? "Working…" : "Upload Excel → ZIP"}
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
      </label>
    </div>
  );
}
