/** The customer ledger's period (20 Nov 2026, Finance ask: "custom date /
 *  financial year / monthly"). PURE — every mode becomes a From / To pair the
 *  ledger endpoint already takes. Indian FY: April → March. */
export type LedgerMode = "fy" | "month" | "custom" | "all";

export type LedgerPeriod = {
  mode: LedgerMode;
  /** FY start year, e.g. 2026 = FY 2026-27. */
  fy: number;
  /** "YYYY-MM". */
  month: string;
  from: string;
  to: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's FY start year (April = new year). */
export function currentFyStart(today: Date = new Date()): number {
  return today.getMonth() + 1 >= 4 ? today.getFullYear() : today.getFullYear() - 1;
}

export function thisMonth(today: Date = new Date()): string {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

export function defaultLedgerPeriod(today: Date = new Date()): LedgerPeriod {
  return { mode: "fy", fy: currentFyStart(today), month: thisMonth(today), from: "", to: "" };
}

export const fyName = (start: number) => `FY ${start}-${pad((start + 1) % 100)}`;

/** Last day of a month, local (never via toISOString — that is UTC). */
function monthEnd(y: number, m: number): string {
  const d = new Date(y, m, 0).getDate();
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** {from, to} for the ledger call ("" = open end) + a label for the header. */
export function ledgerRange(p: LedgerPeriod): { from: string; to: string; label: string } {
  if (p.mode === "fy") {
    return { from: `${p.fy}-04-01`, to: `${p.fy + 1}-03-31`, label: fyName(p.fy) };
  }
  if (p.mode === "month") {
    const [y, m] = p.month.split("-").map(Number);
    if (!y || !m) return { from: "", to: "", label: "All time" };
    const label = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return { from: `${y}-${pad(m)}-01`, to: monthEnd(y, m), label };
  }
  if (p.mode === "custom") {
    const label = p.from || p.to ? `${p.from || "start"} → ${p.to || "today"}` : "All time";
    return { from: p.from, to: p.to, label };
  }
  return { from: "", to: "", label: "All time" };
}

/** Problem with a custom range ("" = fine). */
export function ledgerRangeProblem(p: LedgerPeriod): string {
  if (p.mode === "custom" && p.from && p.to && p.from > p.to) return "From is after To";
  return "";
}

/** The FYs the picker offers: current and the five before it. */
export function fyChoices(today: Date = new Date(), years = 6): number[] {
  const cur = currentFyStart(today);
  return Array.from({ length: years }, (_, i) => cur - i);
}
