/**
 * Expenses (4 Nov 2026; server: routers/crm/expenses.py, services/expenses.py).
 *
 * Finance records every company expense — rent, software, travel, portals… —
 * with the bill attached. The CEO dashboard turns them into **net revenue =
 * billed − expenses** and net profit (also minus people cost), month / quarter /
 * year. Amounts are before GST; the GST paid is kept beside and never counted
 * as an expense. Finance + Admin / CEO only (the server's gate).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Pencil, Plus, ReceiptIndianRupee, Trash2, Upload, X } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, crmUpload, qs, type Meta } from "../api";
import { DataTable, type Column } from "../components/DataTable";
import { DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks } from "../components/dialogKit";
import { HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
import { CONTROL, FilteredBars, Panel, inr, inrCompact } from "../components/controlTower";
import { ConfirmModal, ErrorBox, Modal, inputCls, useToast } from "../components/ui";
import { useSessionState } from "../lib/pageState";
import { fileViewHref } from "./FileView";

export type Expense = {
  id: number; expense_date: string; category: string; description: string; vendor: string | null;
  amount: number; tax_amount: number; total: number; paid_via: string | null; reference: string | null;
  proof_url: string | null; proof_name: string | null; notes: string | null;
  created_by_name: string | null; created_at: string | null;
};
type Summary = {
  period: { key: string; label: string; start: string; end: string };
  total: number;
  monthly: { key: string; label: string; amount: number }[];
  by_category: { category: string; amount: number; share_pct: number }[];
};

const fmtDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What stops an expense from saving, in words (the server's rules). PURE. */
export function expenseProblem(f: { expense_date: string; category: string; description: string; amount: string }): string | null {
  if (!f.expense_date) return "Pick the date";
  if (f.expense_date > todayIso()) return "The date is in the future";
  if (!f.category.trim()) return "Choose a category";
  if (!f.description.trim()) return "Say what it was for";
  const a = Number(f.amount);
  if (!f.amount || !Number.isFinite(a) || a <= 0) return "Enter the amount (before GST)";
  return null;
}

/** The FY (Apr–Mar) holding a date, as "YYYY-MM" anchor. PURE. */
export function fyAnchor(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ExpensesPage() {
  const [toast, notify] = useToast();
  const [rows, setRows] = useState<Expense[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [totals, setTotals] = useState<{ amount: number; tax_amount: number; count: number } | null>(null);
  const [byCat, setByCat] = useState<Summary["by_category"]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [paidVia, setPaidVia] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useSessionState("expenses.page", 1);
  const [search, setSearch] = useSessionState("expenses.search", "");
  const [category, setCategory] = useSessionState("expenses.category", "");
  const [from, setFrom] = useSessionState("expenses.from", "");
  const [to, setTo] = useSessionState("expenses.to", "");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "date", dir: "desc" });
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await crmGet<Expense[]>(`/api/expenses${qs({
        page, limit: 25, search: search || undefined, category: category || undefined,
        date_from: from || undefined, date_to: to || undefined, sort_by: sort.by, sort_dir: sort.dir,
      })}`);
      setRows(res.data || []);
      const m = res.meta as any;
      setMeta(m);
      setTotals(m?.totals ?? null);
      setByCat(m?.by_category ?? []);
    } catch (e: any) {
      setError(e?.message || "Could not load expenses");
    } finally {
      setLoading(false);
    }
  }, [page, search, category, from, to, sort]);

  const loadSummary = useCallback(() => {
    crmGet<Summary>(`/api/expenses/summary${qs({ period: "fy", month: fyAnchor() })}`)
      .then((r) => setSummary(r.data ?? null)).catch(() => setSummary(null));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => {
    crmGet<{ categories: string[]; paid_via: string[] }>("/api/expenses/meta")
      .then((r) => { setCategories(r.data?.categories || []); setPaidVia(r.data?.paid_via || []); })
      .catch(() => { /* the form still takes free text */ });
  }, []);

  const changed = (msg: string) => { notify(msg); load(); loadSummary(); };
  const del = async () => {
    if (!deleting) return;
    setDelBusy(true);
    try {
      const res = await crmDelete(`/api/expenses/${deleting.id}`);
      setDeleting(null);
      changed(res.message || "Deleted");
    } catch (e: any) {
      notify(e?.message || "Could not delete", "err");
    } finally {
      setDelBusy(false);
    }
  };

  const columns: Column<Expense>[] = [
    { key: "date", label: "Date", sortable: true, render: (r) => <span className="whitespace-nowrap">{fmtDay(r.expense_date)}</span> },
    { key: "category", label: "Category", sortable: true, render: (r) => (
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-subtle">{r.category}</span>
    ) },
    { key: "description", label: "For", render: (r) => (
      <div>
        <div className="font-medium text-primary">{r.description}</div>
        <div className="text-xs text-muted">{[r.vendor, r.paid_via, r.reference].filter(Boolean).join(" · ") || "—"}</div>
      </div>
    ) },
    { key: "amount", label: "Amount (excl. GST)", sortable: true, align: "right", render: (r) => inr(r.amount) },
    { key: "tax", label: "GST", align: "right", render: (r) => (r.tax_amount ? inr(r.tax_amount) : "—") },
    { key: "proof", label: "Bill", render: (r) => {
      const href = fileViewHref(r.proof_url, r.proof_name);
      return href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
          <Paperclip className="h-3.5 w-3.5" aria-hidden /> {r.proof_name || "Bill"}
        </a>
      ) : <span className="text-xs text-muted">No bill</span>;
    } },
    { key: "by", label: "Recorded by", render: (r) => <span className="text-xs text-secondary">{r.created_by_name || "—"}</span> },
  ];

  const top = byCat[0];
  const monthly = summary?.monthly ?? [];
  const fyTotal = summary?.total ?? 0;

  return (
    <div className="space-y-4">
      {toast}
      <PageHeader icon={ReceiptIndianRupee} accent="rose" eyebrow="Finance" title="Expenses"
        subtitle="Every company expense with its bill — the CEO dashboard shows net revenue = billed − expenses"
        stats={[
          { label: summary ? `This FY (${summary.period.label.split(" (")[0]})` : "This FY", value: inrCompact(fyTotal) },
          { label: "Shown", value: totals ? `${inrCompact(totals.amount)} · ${totals.count}` : "—", title: "Before GST, for the filters below" },
          { label: "GST paid", value: totals ? inrCompact(totals.tax_amount) : "—", title: "Kept beside; not counted as an expense" },
          ...(top ? [{ label: "Biggest", value: `${top.category} · ${top.share_pct}%` }] : []),
        ]}
        actions={<button type="button" className={HERO_BTN_SOLID} onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden /> Add expense
        </button>}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <select className={CONTROL} value={category} aria-label="Category"
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-secondary">From
            <input type="date" className={CONTROL} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-secondary">To
            <input type="date" className={CONTROL} value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </label>
          {(category || from || to) && (
            <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
              onClick={() => { setCategory(""); setFrom(""); setTo(""); setPage(1); }}>
              <X className="h-3.5 w-3.5" aria-hidden /> Clear
            </button>
          )}
        </div>
      </PageHeader>

      {monthly.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="This financial year, month by month" hint="before GST">
            <FilteredBars data={monthly} rowFilter rowLabel="Months" format={inrCompact} height={200}
              onBarClick={(r) => {
                const k = String(r.key);
                const [y, m] = k.split("-").map(Number);
                const last = new Date(y, m, 0).getDate();
                setFrom(`${k}-01`); setTo(`${k}-${String(last).padStart(2, "0")}`); setPage(1);
              }}
              clickHint="Click a month: list its expenses"
              series={[{ key: "amount", label: "Expenses", color: 5 }]} />
          </Panel>
          <Panel title="By category" hint={summary ? summary.period.label : ""}>
            {summary && summary.by_category.length ? (
              <FilteredBars data={summary.by_category.map((c) => ({ label: c.category, amount: c.amount, share: c.share_pct }))}
                rowFilter rowLabel="Categories" format={inrCompact} height={200}
                onBarClick={(r) => { setCategory(String(r.label)); setPage(1); }}
                clickHint="Click a category: list its expenses"
                series={[{ key: "amount", label: "Spent", color: 5 }, { key: "share", label: "Share %", color: 3, defaultOff: true }]} />
            ) : <p className="text-sm text-muted">Nothing recorded this financial year yet.</p>}
          </Panel>
        </div>
      )}

      {error ? <ErrorBox error={error} onRetry={load} /> : (
        <DataTable columns={columns} rows={rows} meta={meta} loading={loading}
          search={search} onSearch={(q) => { setSearch(q); setPage(1); }} searchPlaceholder="Search description, vendor, reference…"
          sort={sort} onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }))}
          onPage={setPage} onRowClick={(r) => setEditing(r)}
          rowActionsLabel="Actions"
          rowActions={(r) => (
            <div className="flex gap-1">
              <button type="button" className="rounded-control p-1.5 text-secondary hover:bg-surface-2 hover:text-primary" aria-label="Edit"
                onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
              <button type="button" className="rounded-control p-1.5 text-danger hover:bg-danger-soft" aria-label="Delete"
                onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
          emptyMessage="No expenses yet — add the first one with its bill." />
      )}

      {editing && (
        <ExpenseDialog expense={editing === "new" ? null : editing} categories={categories} paidVia={paidVia}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); changed(msg); }} />
      )}
      {deleting && (
        <ConfirmModal title="Delete this expense?" danger confirmLabel="Delete" busy={delBusy}
          message={`${deleting.description} — ${inr(deleting.amount)} on ${fmtDay(deleting.expense_date)}. Net revenue on the dashboard goes up by this amount.`}
          onConfirm={del} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

type FormState = {
  expense_date: string; category: string; description: string; vendor: string; amount: string;
  tax_amount: string; paid_via: string; reference: string; notes: string;
  proof_url: string | null; proof_name: string | null;
};

function ExpenseDialog({ expense, categories, paidVia, onClose, onSaved }: {
  expense: Expense | null; categories: string[]; paidVia: string[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const initial = useMemo<FormState>(() => ({
    expense_date: expense?.expense_date?.slice(0, 10) || todayIso(),
    category: expense?.category || "", description: expense?.description || "",
    vendor: expense?.vendor || "", amount: expense ? String(expense.amount) : "",
    tax_amount: expense?.tax_amount ? String(expense.tax_amount) : "",
    paid_via: expense?.paid_via || "", reference: expense?.reference || "", notes: expense?.notes || "",
    proof_url: expense?.proof_url || null, proof_name: expense?.proof_name || null,
  }), [expense]);
  const [f, setF] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const problem = expenseProblem(f);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const amount = Number(f.amount) || 0;
  const gst = Number(f.tax_amount) || 0;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setErr("The bill is larger than 15 MB"); return; }
    setUploading(true); setErr(null);
    try {
      const res = await crmUpload<{ url: string; name: string }>("/api/expenses/proof", file);
      set("proof_url", res.data?.url || null); set("proof_name", res.data?.name || file.name);
    } catch (e: any) {
      setErr(e?.message || "Could not upload the bill");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (problem || busy) return;
    setBusy(true); setErr(null);
    const body = {
      expense_date: f.expense_date, category: f.category.trim(), description: f.description.trim(),
      vendor: f.vendor.trim() || null, amount: Number(f.amount), tax_amount: f.tax_amount ? Number(f.tax_amount) : 0,
      paid_via: f.paid_via || null, reference: f.reference.trim() || null, notes: f.notes.trim() || null,
      proof_url: f.proof_url, proof_name: f.proof_name,
    };
    try {
      const res = expense ? await crmPut(`/api/expenses/${expense.id}`, body) : await crmPost("/api/expenses", body);
      onSaved(res.message || "Saved");
    } catch (e: any) {
      setErr(e?.message || "Could not save");
      setBusy(false);
    }
  };

  const today = new Date();
  const datePicks: Record<string, string> = {
    Today: todayIso(),
    Yesterday: (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })(),
    "1st of this month": `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`,
  };

  return (
    <Modal medium title={expense ? "Edit expense" : "Add expense"} onClose={onClose} dirty={dirty}
      hero={<DialogHero tone="rose" icon={ReceiptIndianRupee} eyebrow="Finance · Expenses"
        title={expense ? "Edit expense" : "Add an expense"}
        subtitle="Before GST — the GST paid is kept beside and is not an expense" />}
      footer={<DialogActions onCancel={onClose} busy={busy} tone="rose" label={expense ? "Save changes" : "Save expense"}
        disabled={!!problem || uploading || (!!expense && !dirty)} onConfirm={save}
        hint={problem || (amount ? `${inr(amount)}${gst ? ` + ${inr(gst)} GST` : ""} — net revenue goes down by ${inr(amount)}` : undefined)} />}>
      <div className="space-y-4">
        <DialogSection n={1} tone="rose" title="When and what" done={!!(f.expense_date && f.category && f.description)}>
          <QuickPicks tone="rose" label="Date" options={Object.keys(datePicks)}
            active={Object.keys(datePicks).find((k) => datePicks[k] === f.expense_date) || null}
            onPick={(k) => set("expense_date", datePicks[k])} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input type="date" className={inputCls} value={f.expense_date} max={todayIso()} aria-label="Expense date"
              onChange={(e) => set("expense_date", e.target.value)} />
            <input className={inputCls} list="expense-categories" value={f.category} placeholder="Category"
              aria-label="Category" onChange={(e) => set("category", e.target.value)} />
            <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <input className={`${inputCls} sm:col-span-2`} value={f.description} placeholder="What was it for? e.g. October office rent"
              aria-label="Description" onChange={(e) => set("description", e.target.value)} />
            <input className={`${inputCls} sm:col-span-2`} value={f.vendor} placeholder="Paid to (vendor) — optional"
              aria-label="Vendor" onChange={(e) => set("vendor", e.target.value)} />
          </div>
        </DialogSection>
        <DialogSection n={2} tone="rose" title="How much" done={amount > 0}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-secondary">Amount before GST (₹)
              <input type="number" min={0} step="0.01" className={`${inputCls} mt-1 text-lg font-bold`} value={f.amount}
                onChange={(e) => set("amount", e.target.value)} />
            </label>
            <label className="text-xs text-secondary">GST paid (₹, optional)
              <input type="number" min={0} step="0.01" className={`${inputCls} mt-1`} value={f.tax_amount}
                onChange={(e) => set("tax_amount", e.target.value)} />
            </label>
            <select className={inputCls} value={f.paid_via} aria-label="Paid via" onChange={(e) => set("paid_via", e.target.value)}>
              <option value="">Paid via…</option>
              {paidVia.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className={inputCls} value={f.reference} placeholder="Reference / UTR (optional)"
              aria-label="Reference" onChange={(e) => set("reference", e.target.value)} />
          </div>
        </DialogSection>
        <DialogSection n={3} tone="rose" title="The bill" optional done={!!f.proof_url}>
          {f.proof_url ? (
            <div className="flex items-center gap-2 text-sm">
              <Paperclip className="h-4 w-4 text-muted" aria-hidden />
              <a href={fileViewHref(f.proof_url, f.proof_name) || "#"} target="_blank" rel="noreferrer"
                className="font-semibold text-brand-600 hover:underline dark:text-brand-300">{f.proof_name || "Bill"}</a>
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => { set("proof_url", null); set("proof_name", null); }}>Remove</button>
            </div>
          ) : (
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-subtle px-4 py-5 text-sm text-secondary hover:border-rose-400 hover:text-primary">
              <Upload className="h-4 w-4" aria-hidden /> {uploading ? "Uploading…" : "Attach the bill (image, PDF, Excel, Word · ≤ 15 MB)"}
            </button>
          )}
          <input ref={fileRef} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.xlsx,.xls,.csv,.doc,.docx"
            onChange={(e) => upload(e.target.files?.[0])} />
        </DialogSection>
        <textarea className={inputCls} rows={2} value={f.notes} placeholder="Notes (optional)" aria-label="Notes"
          onChange={(e) => set("notes", e.target.value)} />
        <DialogFailure message={err} />
      </div>
    </Modal>
  );
}
