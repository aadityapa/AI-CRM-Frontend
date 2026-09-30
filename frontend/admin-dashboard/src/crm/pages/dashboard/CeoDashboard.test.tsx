/**
 * CEO dashboard (28 Sep 2026): four tabs over `/api/dashboard/ceo`, FY by
 * default, one fetch per tab; the Customer tab drills customer → project →
 * person; the Sales tab prints internal vs external per position; the
 * speedometers render as SVG. Every tab reads in the Finance order:
 * alerts → tiles → "How the year unfolded" → dials → four bar charts → table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ThemeProvider } from "../../../theme/ThemeProvider";

// recharts' ResponsiveContainer measures itself; jsdom has no ResizeObserver.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

vi.mock("../../routerHooks", async () => {
  const actual = await vi.importActual<any>("../../routerHooks");
  return { ...actual, crmNavigate: vi.fn() };
});

const crmGet = vi.fn();
vi.mock("../../api", async () => {
  const actual = await vi.importActual<any>("../../api");
  return { ...actual, crmGet: (...a: any[]) => crmGet(...a) };
});

import { CeoDashboard } from "./CeoDashboard";

const PERIOD = {
  kind: "fy", key: "FY2026", label: "FY 2026-27 (Apr 2026 – Mar 2027)", short_label: "FY2026-27", fy_label: "FY 2026-27",
  anchor_month: "2026-09", start: "2026-04-01", end: "2027-03-31", months: 12, is_current: true,
  comparison_label: "FY 2025-26", previous_key: "FY2025",
};
const month = (key: string, extra: object) => ({ key, label: key, future: false, ...extra });

const FINANCE = {
  headline: { billed: 4_600_000, gst: 828_000, billed_incl_gst: 5_428_000, invoices: 12, collected: 2_888_000, collection_rate_pct: 62.8,
    outstanding: 1_360_000, open_invoices: 3, billed_prev: 3_000_000, billed_mom_pct: 53.3, billed_yoy: 3_000_000, billed_yoy_pct: 53.3,
    collected_prev: 2_500_000, collected_mom_pct: 15.5, months_in_period: 12, billed_per_month: 383_333, comparison_label: "FY 2025-26" },
  targets: { month_target: 6_000_000, month_target_is_default: false, month_attainment_pct: 76.7, month_gap: 1_400_000, run_rate: 9_200_000,
    run_rate_attainment_pct: 153, is_current_month: true, fy_label: "FY 2026-27", fy_start: "2026-04-01", fy_end: "2027-03-31", fy_target: 6_000_000,
    fy_billed_to_date: 4_600_000, fy_attainment_pct: 76.7, fy_months_elapsed: 6, fy_months_remaining: 6, fy_projection: 9_000_000,
    fy_projection_pct: 150, fy_required_monthly: 233_333, period_label: "FY 2026-27", months_with_target: 12 },
  margin: { billed: 4_600_000, cost: 1_800_000, gross_margin: 2_800_000, gross_margin_pct: 60.9, heads_without_ctc: 0, loss_making: [] },
  collections: { dso_days: 41, dso_window_days: 90, avg_days_to_pay: 12, receipts: 4, outstanding: 1_360_000 },
  ageing: { buckets: [{ label: "Not yet due", amount: 1_180_000, count: 2 }, { label: "31–60 days", amount: 180_000, count: 1 }],
    overdue_total: 180_000, overdue_90_plus: 0, top_overdue_customers: [{ customer: "APTIV", overdue: 180_000 }] },
  cashflow: { as_of: "2026-09-28", months: [{ month: "2026-10", label: "Oct 2026", expected: 1_000_000, expected_at_pace: 900_000, invoices: 2, people_cost: 300_000, net: 700_000, net_at_pace: 600_000 }],
    horizon_months: 3, slip_days: 4, overdue: { amount: 180_000, count: 1 }, beyond_horizon: { amount: 0, count: 0 }, expected_total: 1_000_000,
    expected_total_at_pace: 900_000, people_cost_total: 900_000, net_total: 100_000, net_total_at_pace: 0, covers_cost: true,
    unbilled_ready: { amount: 150_000, count: 1 }, top_expected: [], heads_costed: 2, heads_without_ctc: 0, assumptions: "" },
  pipeline: { approved_uninvoiced: { count: 1, amount: 150_000 }, active_po_balance: 2_640_000, avg_monthly_billed: 383_333, po_cover_months: 6.9 },
  efficiency: { deployed_heads: 2, revenue_per_head: 2_300_000, revenue_per_head_per_month: 191_666 },
  alerts: [{ key: "behind_target", level: "warn", title: "Behind target", detail: "76.7 % of the FY target" }],
  series: [],
  monthly: [month("2026-04", { billed: 0, collected: 0, cost: 150_000, margin: -150_000 }), month("2026-08", { billed: 360_000, collected: 0, cost: 150_000, margin: 210_000 })],
  by_type: [{ label: "T&M", billed: 4_600_000, invoices: 12, share_pct: 100 }],
  top_customers: [{ customer_id: 1, customer: "HARMAN", billed: 3_600_000, share_pct: 78.3 }, { customer_id: 2, customer: "APTIV", billed: 1_000_000, share_pct: 21.7 }],
  concentration: { top1_share_pct: 78.3, top3_share_pct: 100, risk: true, top_customer: "HARMAN" },
};

const CUSTOMER = {
  summary: { customers: 2, customers_billing: 2, billed: 4_600_000, previous: 3_000_000, change_pct: 53.3, collected: 2_888_000, outstanding: 1_360_000,
    overdue: 180_000, heads: 2, heads_today: 2, top1_share_pct: 78.3, top3_share_pct: 100, concentration_risk: true, top_customer: "HARMAN" },
  donut: [{ label: "HARMAN", value: 3_600_000, customer_id: 1 }, { label: "APTIV", value: 1_000_000, customer_id: 2 }],
  monthly: [month("2026-04", { billed: 0, collected: 0, cost: 150_000, customers: {} }),
            month("2026-08", { billed: 360_000, collected: 0, cost: 150_000, customers: { HARMAN: 360_000 } })],
  monthly_series: ["HARMAN", "APTIV"],
  deployed_trend: {
    month: [month("2026-04", { total: 1, customers: { HARMAN: 1 }, locations: { Unspecified: 1 } }), month("2026-06", { total: 2, customers: { HARMAN: 2 }, locations: { Bengaluru: 2 } })],
    quarter: [month("2025-Q4", { label: "Q4 FY25-26", total: 1, customers: { APTIV: 1 }, locations: { Unspecified: 1 } }), month("2026-Q2", { label: "Q2 FY26-27", total: 2, customers: { HARMAN: 2 }, locations: { Bengaluru: 2 } })],
    fy: [month("FY2025", { label: "FY2025-26", total: 1, customers: { APTIV: 1 }, locations: { Unspecified: 1 } }), month("FY2026", { label: "FY2026-27", total: 2, customers: { HARMAN: 2 }, locations: { Bengaluru: 2 } })],
  },
  deployed_series: { customers: ["HARMAN", "APTIV"], locations: ["Bengaluru", "Unspecified"] },
  alerts: [{ key: "concentration", level: "warn", title: "HARMAN is 78% of billing", detail: "One customer at or above half the billing." }],
  customers: [{
    customer_id: 1, customer: "HARMAN", billed: 3_600_000, previous: 2_000_000, change_pct: 80, share_pct: 78.3, invoices: 10, collected: 2_888_000,
    outstanding: 1_360_000, overdue: 0, cost: 1_500_000, margin: 2_100_000, margin_pct: 58.3, heads: 2, heads_today: 2, internal: 1, external: 1,
    projects_count: 1, po_balance: 2_640_000, monthly_burn: 368_000, po_cover_months: 7.2, open_positions: 1, total_positions: 3, joined_positions: 2,
    projects: [{
      project_id: 11, project: "Infotainment", status: "Active", end_date: null, opportunity: "Infotainment engineers", opp_id: "OPP-1",
      billed: 3_600_000, previous: 2_000_000, change_pct: 80, share_pct: 100, invoices: 10, collected: 2_888_000, outstanding: 1_360_000,
      unlinked_billed: 0, cost: 1_500_000, margin: 2_100_000, margin_pct: 58.3, heads: 2, heads_today: 2, internal: 1, external: 1,
      employees: [
        { pe_id: 1, employee_id: 5, employee: "Asha Rao", employee_code: "K001", rate: 200_000, unit: "Monthly", monthly_rate: 200_000, billed: 2_000_000,
          invoices: 5, cost: 600_000, margin: 1_400_000, has_ctc: true, onboarding: "2026-04-01", exit: null, exited: false, deployed_today: true,
          kind: "internal", kind_reason: "Redeployed — earlier placement ADAS · APTIV" },
        { pe_id: 2, employee_id: 6, employee: "Bala", employee_code: "K002", rate: 1_000, unit: "Hourly", monthly_rate: 168_000, billed: 1_600_000,
          invoices: 5, cost: 300_000, margin: 1_300_000, has_ctc: true, onboarding: "2026-06-01", exit: null, exited: false, deployed_today: true,
          kind: "external", kind_reason: "New hire — joined Karnex 0 day(s) before onboarding" },
      ],
    }],
  }],
};

const PACE = { actual: 3, target: 6, gap: 3, attainment_pct: 50, is_current: true, working_days_total: 260, working_days_elapsed: 128,
  working_days_left: 132, current_per_week: 0.12, required_per_week: 0.11, acceleration: 0.97, state: "ok" };
const SALES = {
  kpis: { pipeline_positions: 3, pipeline_positions_prev: 2, opportunities: 1, opportunities_prev: 1, onboardings: 2, onboardings_prev: 1,
    positions_fulfilled: 0, positions_customer_closed: 0, active_positions: 2, workable_positions: 2, active_customers: 2 },
  pace: { sales: PACE, fulfilment: { ...PACE, actual: 2, current_per_week: 0.08, state: "warn" } },
  targets: { quarter_key: "2026-Q2", quarter_label: "Q2", sales: { quarter: 2, default_quarter: null, period: 6, source: "x" }, ta: { quarter: 2, default_quarter: null, period: 6, source: "x" } },
  series: [], funnel: { pipeline: 4, active_open: 2, workable: 2, awaiting_approval: 0, on_hold: 0, in_progress_joined: 2, fulfilled: 0, customer_closed: 0 },
  customers: { count: 2, total_open_positions: 2, rows: [], others: { count: 0, open_positions: 0 }, largest: { name: "HARMAN", open_positions: 1, share_pct: 50 }, concentration_risk: false },
  stage_delays: { rows: [], warn_days: 3, bad_days: 7, total_waiting: 0 },
  onboarding_mix: { internal: 1, external: 1, unknown: 0, total: 2, internal_pct: 50 },
  onboarding_trend: {
    month: [month("2026-04", { onboardings: 1, positions_in: 3, internal: 1, external: 0, unknown: 0 }), month("2026-06", { onboardings: 1, positions_in: 0, internal: 0, external: 1, unknown: 0 })],
    quarter: [month("2026-Q1", { label: "Q1 FY26-27", onboardings: 2, positions_in: 3, internal: 1, external: 1, unknown: 0 })],
    fy: [month("FY2025", { label: "FY2025-26", onboardings: 0, positions_in: 0, internal: 0, external: 0, unknown: 0 }), month("FY2026", { label: "FY2026-27", onboardings: 2, positions_in: 3, internal: 1, external: 1, unknown: 0 })],
  },
  monthly: [month("2026-04", { positions_in: 3, onboardings: 1, internal: 1, external: 0, unknown: 0 })],
  positions: [{
    requirement_id: 1, opportunity_id: 1, opp_id: "OPP-1", title: "Infotainment engineers", customer_id: 1, customer: "HARMAN", owner: "Sanjana",
    opp_type: "T&M", rfi_value: 5_000_000, status: "In_Progress", opp_stage: "Active", live: true, workable: true, positions: 3, joined: 2, open: 1,
    fill_pct: 66.7, created_on: "2026-04-22", closed_on: null, age_days: 159, created_in_period: true, joined_in_period: 2, internal: 1, external: 1, unknown: 0,
    candidates: [{ profile_id: 9, name: "Asha", joined_on: "2026-04-01", kind: "internal", reason: "Redeployed", in_period: true },
                 { profile_id: 10, name: "Bala", joined_on: "2026-06-01", kind: "external", reason: "New hire", in_period: true }],
    candidates_more: 0,
  }],
  positions_summary: { shown: 1, live: 1, open: 1, total: 3, joined: 2, stale_30: 1 },
  by_owner: [{ owner: "Sanjana", positions: 3, open: 1, joined: 2, opportunities: 1 }],
  by_customer: [{ customer_id: 1, customer: "HARMAN", positions: 3, open: 1, joined: 2, internal: 1, external: 1, opportunities: 1, stale: 1 }],
  alerts: [{ key: "stale_positions", level: "warn", title: "1 position(s) open for 30+ days", detail: "Oldest: Infotainment engineers at HARMAN, 159 days." }],
  rules: { internal: "i", external: "e", unknown: "u" },
};

const person = (employee_id: number, employee: string, extra: object = {}) => ({
  employee_id, employee, employee_code: `K00${employee_id}`, role: "Engineer", doj: "2025-04-01", cost_month: 75_000, has_ctc: true, exit_on: null, projects: [], ...extra,
});
const PEOPLE = {
  headline: { headcount: 3, deployed: 2, bench: 1, utilisation_pct: 66.7, bench_cost_month: 75_000, people_cost_month: 225_000, bench_cost_pct: 33.3,
    heads_without_ctc: 0, joiners: 1, exits: 1, net_change: 0, opening_headcount: 3, attrition_pct: 33.3, on_notice: 1, avg_tenure_years: 1.8,
    billed: 4_600_000, revenue_per_deployed_head: 2_300_000, rolloffs_90d: 1 },
  monthly: [month("2026-04", { joiners: 0, exits: 0, headcount: 3, deployed: 1, bench: 2, cost: 225_000, bench_cost: 150_000 }),
            month("2026-06", { joiners: 1, exits: 1, headcount: 4, deployed: 2, bench: 2, cost: 275_000, bench_cost: 141_666 }),
            { key: "2026-10", label: "2026-10", future: true, joiners: 0, exits: 1, headcount: null, deployed: null, bench: null, cost: null, bench_cost: null }],
  by_role: [{ role: "Engineer", deployed: 2, bench: 1, on_notice: 1, cost: 225_000 }],
  tenure: [{ label: "< 1 yr", deployed: 1, bench: 0 }, { label: "1–2 yrs", deployed: 0, bench: 1 }, { label: "2–4 yrs", deployed: 1, bench: 0 }, { label: "4+ yrs", deployed: 0, bench: 0 }],
  rolloffs_by_month: [{ key: "2026-11", label: "Nov 26", heads: 1, monthly_rate: 200_000 }],
  alerts: [{ key: "bench_cost", level: "bad", title: "Bench costs ₹75,000 a month (33% of people cost)", detail: "1 head(s) with no live assignment today." }],
  bench: [person(3, "Chitra")], on_notice: [person(3, "Chitra", { exit_on: "2026-10-14" })], joiners: [person(2, "Bala", { doj: "2026-06-01" })],
  exits: [person(4, "Dev", { exit_on: "2026-06-30" })],
  rolloffs: [{ project_employee_id: 1, employee_id: 5, employee_name: "Asha Rao", role_title: null, project_id: 11, project_name: "Infotainment",
               customer_name: "HARMAN", po_end_date: "2026-11-30", ends_by: "po_expiry", days_left: 63 }],
};

const payload = (tab: string, data: object) => ({ data: { as_of: "2026-09-28", tab, period: PERIOD, data }, meta: {}, message: "" });

beforeEach(() => {
  crmGet.mockReset();
  crmGet.mockImplementation(async (url: string) => {
    if (url.includes("tab=finance")) return payload("finance", FINANCE);
    if (url.includes("tab=customer")) return payload("customer", CUSTOMER);
    if (url.includes("tab=sales")) return payload("sales", SALES);
    if (url.includes("tab=people")) return payload("people", PEOPLE);
    throw new Error(`unexpected ${url}`);
  });
  try { localStorage.removeItem("crm.ceo.tab"); } catch { /* ignore */ }
});

describe("CEO dashboard", () => {
  it("opens on Finance for the financial year and renders the money", async () => {
    render(<ThemeProvider><CeoDashboard /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText(/FY 2026-27 \(Apr 2026/)).toBeTruthy());
    expect(crmGet.mock.calls[0][0]).toMatch(/period=fy/);
    expect(crmGet.mock.calls[0][0]).toMatch(/tab=finance/);
    expect(screen.getAllByText("₹46.0L").length).toBeGreaterThan(0);   // billed tile
    expect(screen.getByText("Behind target")).toBeTruthy();     // alert chip
    expect(screen.getAllByRole("figure").length).toBeGreaterThanOrEqual(3);   // three speedometers
    expect(screen.getByRole("tab", { name: /Finance/ }).getAttribute("aria-selected")).toBe("true");
    // Money tiles open Reports ▸ Revenue at the SAME anchor + zoom.
    const billed = screen.getByText("Billed (excl. GST)").closest("a");
    expect(billed?.getAttribute("href")).toMatch(/p=reports&tab=revenue&month=2026-09&period=fy/);
    // Bar charts carry tick filters: series chips + a row list with All / None.
    expect(screen.getAllByRole("checkbox", { name: /People cost/ }).length).toBe(2);   // trend + cash flow
    expect(screen.getAllByRole("checkbox", { name: /Outstanding/ }).length).toBeGreaterThan(0);   // ageing is a bar chart too
    // Reading order: trend → dials → the four money panels.
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent || "");
    const at = (t: string) => titles.findIndex((x) => x.startsWith(t));
    expect(at("How the year unfolded")).toBeLessThan(at("Collection rate"));
    expect(at("Collection rate")).toBeLessThan(at("Who we bill"));
    expect(at("Who we bill")).toBeLessThan(at("Billing by engagement type"));
    expect(screen.getAllByRole("group", { name: "Months" }).length).toBeGreaterThan(0);
  });

  it("drills customer → project → person on the Customer tab", async () => {
    render(<ThemeProvider><CeoDashboard /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Customer/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Customer/ }));
    await waitFor(() => expect(screen.getByText("HARMAN", { selector: "a" })).toBeTruthy());
    expect(crmGet.mock.calls.at(-1)?.[0]).toMatch(/tab=customer/);
    expect(screen.queryByText("Infotainment")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand HARMAN" }));
    expect(screen.getByText("Infotainment")).toBeTruthy();
    expect(screen.queryByText("Asha Rao")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Infotainment" }));
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("Bala")).toBeTruthy();
    expect(screen.getAllByText("Internal", { selector: "span" }).length).toBe(1);   // the kind chip (the chart series is a label)
    expect(screen.getAllByText("External", { selector: "span" }).length).toBe(1);
    expect(localStorage.getItem("crm.ceo.tab")).toBe("customer");
    // The Finance reading order: alerts → unfolded (customers as series) → dials → four bar charts → the drill-down.
    expect(screen.getByText("HARMAN is 78% of billing")).toBeTruthy();
    expect(screen.getAllByRole("figure").length).toBe(3);
    expect(screen.getAllByRole("checkbox", { name: "HARMAN" }).length).toBeGreaterThan(0);   // a customer is a series / a row
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent || "");
    const at = (t: string) => titles.findIndex((x) => x.startsWith(t));
    expect(at("How the year unfolded")).toBeLessThan(at("Concentration"));
    expect(at("Concentration")).toBeLessThan(at("Customer billing"));
    expect(at("Customer billing")).toBeLessThan(at("PO runway by customer"));
    expect(at("PO runway by customer")).toBeLessThan(at("Customer → project → person"));
    expect(screen.getByText(/7.2 mo cover/)).toBeTruthy();
    // Deployed on customer sites: by customer / by location, at three zooms.
    expect(at("Deployed on customer sites")).toBeLessThan(at("Concentration"));
    expect(screen.getAllByRole("checkbox", { name: "APTIV" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "By location" }));
    expect(screen.getByRole("checkbox", { name: "Bengaluru" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quarterly" }));
    expect(screen.getByRole("checkbox", { name: "Q4 FY25-26" })).toBeTruthy();
  });

  it("shows positions with internal vs external joiners and the pace dials on the Sales tab", async () => {
    render(<ThemeProvider><CeoDashboard /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Sales/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Sales/ }));
    await waitFor(() => expect(screen.getByText("Infotainment engineers")).toBeTruthy());
    expect(screen.getByText("Sales pace")).toBeTruthy();
    expect(screen.getByText("Fulfilment pace")).toBeTruthy();
    expect(screen.getByText("Asha")).toBeTruthy();
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Live (1)" })).toBeTruthy();
    // Reading order: unfolded (zoomable) → pace dials → four bar charts (customer · funnel · owner · delays) → positions.
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent || "");
    const at = (t: string) => titles.findIndex((x) => x.startsWith(t));
    expect(at("How the year unfolded")).toBeLessThan(at("Sales pace"));
    expect(at("Sales pace")).toBeLessThan(at("Positions by customer"));
    expect(at("Positions by customer")).toBeLessThan(at("Hiring-stage delays"));
    expect(at("Hiring-stage delays")).toBeLessThan(titles.indexOf("Positions"));
    expect(screen.getByText("1 position(s) open for 30+ days")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: "Positions brought in" }).length).toBe(1);
    // Onboarded internal vs external at three zooms — the toggle swaps the rows.
    expect(screen.getAllByRole("group", { name: "Months" }).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("group", { name: "Years" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "FY2026-27" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quarterly" }));
    expect(screen.getByRole("checkbox", { name: "Q1 FY26-27" })).toBeTruthy();
    // Untick a series: its chip goes off (the chart redraws with what is ticked).
    const internal = screen.getAllByRole("checkbox", { name: /^Onboarded — internal$/ })[0] as HTMLInputElement;
    expect(internal.checked).toBe(true);
    fireEvent.click(internal);
    expect(internal.checked).toBe(false);
  });

  it("reads the People tab in the same order — unfolded → dials → four bar charts → names", async () => {
    render(<ThemeProvider><CeoDashboard /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: /People/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    // The directory opens on "On notice" (someone is serving notice) — one list at a time.
    await waitFor(() => expect(screen.getAllByText("Chitra", { selector: "a" }).length).toBe(1));
    expect(crmGet.mock.calls.at(-1)?.[0]).toMatch(/tab=people/);
    expect(screen.getByText("Bench costs ₹75,000 a month (33% of people cost)")).toBeTruthy();   // alert chip
    expect(screen.getAllByRole("figure").length).toBe(3);   // utilisation · attrition · bench cost
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent || "");
    const at = (t: string) => titles.findIndex((x) => x.startsWith(t));
    expect(at("How the year unfolded")).toBeLessThan(at("Utilisation"));
    expect(at("Bench cost")).toBeLessThan(at("People cost by month"));
    expect(at("People cost by month")).toBeLessThan(at("Tenure mix"));
    const directory = screen.getByRole("region", { name: "People" });
    const rolloff = screen.getByRole("heading", { name: /^Rolling off in the next 90 days/ });
    expect(rolloff.compareDocumentPosition(directory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(directory).getByRole("tab", { name: /On the bench/ }));
    expect(within(directory).getByText("Chitra", { selector: "a" })).toBeTruthy();
    fireEvent.change(within(directory).getByRole("textbox", { name: "Search people" }), { target: { value: "zzz" } });
    expect(within(directory).getByText("Nobody matches that search.")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: "On the bench" }).length).toBe(3);   // unfolded · by designation · tenure
    expect(screen.getByRole("checkbox", { name: "Engineer" })).toBeTruthy();            // designation row tick
    expect(screen.getByText("Asha Rao")).toBeTruthy();                                   // roll-off name
    // Tiles deep-link to the Employees list with the deployment filter.
    const benchTile = screen.getAllByText("On the bench", { selector: "div.uppercase" })[0];
    expect(benchTile.closest("a")?.getAttribute("href")).toMatch(/p=employees&deployment=bench/);
  });
});
